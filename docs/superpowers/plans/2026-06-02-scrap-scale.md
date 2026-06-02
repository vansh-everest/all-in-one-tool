# Scrap Scale (Accounting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Google OAuth connection module (Phase A) and the Scrap Scale reconciliation tool (Phase B): paste a Google Sheet URL → detect columns → OCR linked payment screenshots with Gemini Flash → sum/compare/flag per row → write a new dated results tab → save the run as an instance with history + comparison.

**Architecture:** Next.js 16 App Router route handlers do all Google/Gemini I/O (no creds in client). Phase A stores an AES-GCM-encrypted refresh token per department in `google_connections` and mints fresh access tokens on demand. Phase B persists each run as a job (`scrap_scale_runs` + `scrap_scale_run_rows`) and a browser-driven chunk loop calls a `process-chunk` route that OCRs the next N images (concurrency-limited, backoff, OCR cache), making runs resumable and Vercel-time-safe.

**Tech Stack:** Next.js 16, TypeScript, Supabase (RLS via `auth.uid()`), Google REST APIs (Sheets v4, Drive v3, OAuth2) via `fetch`, Gemini `generativelanguage` API via `fetch`, `exceljs`, Vitest.

**Conventions from the shell (reuse, don't rebuild):** user-scoped server client `@/utils/supabase/server` (`createClient()`), guards `@/lib/auth/guards` (`requireDepartmentAccess('accounting')`), `SECURITY DEFINER` RLS helpers `is_member_of`/`is_super_admin`, migration runner `node --env-file=.env.local supabase/migrate.mjs`, route group `app/(app)/`.

---

## File Structure

```
lib/google/
  crypto.ts            # AES-256-GCM encrypt/decrypt (Phase A)
  scopes.ts            # scope constants + SCRAP_SCALE_SCOPES
  oauth.ts             # buildConsentUrl, exchangeCode, refreshAccessToken (pure-ish fetch wrappers)
  connection.ts        # getConnection, saveConnection, getAccessToken, ReconsentRequired
  sheets.ts            # getSpreadsheetMeta, readValues, addResultsTab, writeValues
  drive.ts             # downloadFile (media + mime)
lib/scrap-scale/
  links.ts             # parseDriveLinks (multi-link, both URL forms)  [TDD]
  compute.ts           # rowExtracted, difference, flag, rowStatus      [TDD]
  duplicates.ts        # markDuplicates by normalized txn_id            [TDD]
  queue.ts             # mapWithConcurrency + backoff(429)              [TDD]
  columns.ts           # normalizeHeader, detectColumns                 [TDD]
  ocr.ts               # geminiExtract(image) -> structured JSON
  prompt.ts            # the Gemini OCR prompt text
app/api/google/oauth/start/route.ts
app/api/google/oauth/callback/route.ts
app/api/tools/scrap-scale/detect-columns/route.ts
app/api/tools/scrap-scale/run/route.ts            # create run + read sheet -> rows (pending)
app/api/tools/scrap-scale/run/[runId]/route.ts    # GET status/results
app/api/tools/scrap-scale/run/[runId]/process-chunk/route.ts
app/api/tools/scrap-scale/run/[runId]/write-back/route.ts
app/api/tools/scrap-scale/run/[runId]/export/route.ts   # ?format=csv|xlsx
app/api/tools/scrap-scale/image/route.ts          # ?file=<id> server image proxy (drill-down)
app/(app)/accounting/scrap-scale/page.tsx         # server: guard + connection state + history
components/scrap-scale/
  ScrapScaleApp.tsx    # client: paste URL, detect, override, run, progress
  ResultsTable.tsx     # client: table + row drill-down
  ReconSummary.tsx     # summary cards
  RunHistory.tsx       # list instances + compare two
supabase/migrations/0002_google_connections.sql
supabase/migrations/0003_scrap_scale.sql
```

**Testing note:** Pure logic (`links`, `compute`, `duplicates`, `queue`, `columns`, `crypto`) is TDD with Vitest. Google/Gemini I/O and routes are verified end-to-end against the real APIs in the final task (real Gemini key + real sheet provided by the user). No network mocks — they'd test the mock.

---

## PHASE A — Google connection module

### Task 1: Env vars + deps

**Files:**
- Modify: `.env.example`, `.env.local`
- Modify: `package.json` (add `exceljs`)

- [ ] **Step 1: Add Google + Gemini + crypto vars to `.env.example`**

Append to `.env.example` (replace the commented "Reserved" block):
```bash
# Google OAuth (Web client). Values from the OAuth client JSON.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/oauth/callback

# 32-byte base64 key for encrypting stored refresh tokens at rest
TOKEN_ENCRYPTION_KEY=

# Gemini (Google AI Studio, free tier)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

- [ ] **Step 2: Populate `.env.local` from the OAuth client JSON + a generated key**

Read `client_id` / `client_secret` from `Stuff_needed/OAuth Client ID Everest Tool.json` and generate a key:
```bash
cd /Users/vanshsood/Projects/everest
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
node -e '
const fs=require("fs");
const j=require("./Stuff_needed/OAuth Client ID Everest Tool.json").web;
const add=`\n# Google OAuth\nGOOGLE_CLIENT_ID=${j.client_id}\nGOOGLE_CLIENT_SECRET=${j.client_secret}\nGOOGLE_REDIRECT_URI=http://localhost:3000/api/google/oauth/callback\nTOKEN_ENCRYPTION_KEY='"$KEY"'\nGEMINI_MODEL=gemini-2.5-flash\n`;
fs.appendFileSync(".env.local", add);
console.log("appended google+crypto vars");
'
```
(`GEMINI_API_KEY` is already present in `.env.local`.)

- [ ] **Step 3: Install exceljs**

```bash
npm install exceljs
```

- [ ] **Step 4: Verify env loads**

```bash
node --env-file=.env.local -e "console.log('client_id set:', !!process.env.GOOGLE_CLIENT_ID, '| key len bytes:', Buffer.from(process.env.TOKEN_ENCRYPTION_KEY,'base64').length, '| gemini key set:', !!process.env.GEMINI_API_KEY)"
```
Expected: `client_id set: true | key len bytes: 32 | gemini key set: true`

- [ ] **Step 5: Commit**

```bash
git add .env.example package.json package-lock.json && git commit -m "chore: add Google/Gemini env vars and exceljs"
```

---

### Task 2: AES-256-GCM crypto (TDD)

**Files:**
- Create: `lib/google/crypto.ts`
- Test: `lib/google/__tests__/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/google/__tests__/crypto.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "../crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("crypto", () => {
  it("round-trips a token", () => {
    const enc = encryptToken("1//refresh-token-value");
    expect(enc).not.toContain("refresh-token-value");
    expect(decryptToken(enc)).toBe("1//refresh-token-value");
  });
  it("produces different ciphertext each call (random IV)", () => {
    expect(encryptToken("x")).not.toBe(encryptToken("x"));
  });
  it("throws on tampered ciphertext", () => {
    const enc = encryptToken("secret");
    const parts = enc.split(".");
    const tampered = [parts[0], parts[1], Buffer.from("garbage").toString("base64")].join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- crypto`
Expected: FAIL — cannot find module `../crypto`.

- [ ] **Step 3: Implement**

Create `lib/google/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const b = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (b.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)");
  return b;
}

/** Returns "base64(iv).base64(tag).base64(ciphertext)". */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(enc: string): string {
  const [ivB, tagB, ctB] = enc.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- crypto`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/google/crypto.ts lib/google/__tests__/crypto.test.ts && git commit -m "feat: AES-256-GCM token encryption"
```

---

### Task 3: `google_connections` migration

**Files:**
- Create: `supabase/migrations/0002_google_connections.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0002_google_connections.sql`:
```sql
create table if not exists public.google_connections (
  id                      uuid primary key default gen_random_uuid(),
  department_id           uuid not null references public.departments(id) on delete cascade,
  connected_by            uuid references public.profiles(id) on delete set null,
  google_email            text,
  refresh_token_encrypted text not null,
  scopes                  text[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (department_id)
);

alter table public.google_connections enable row level security;

drop policy if exists google_connections_rw on public.google_connections;
create policy google_connections_rw on public.google_connections for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()))
  with check (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()));
```

- [ ] **Step 2: Apply + verify**

```bash
node --env-file=.env.local supabase/migrate.mjs
node --env-file=.env.local -e '
const pg=require("pg");const c=new pg.Client({connectionString:process.env.DIRECT_URL,ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();console.log((await c.query("select rowsecurity from pg_tables where tablename=$1",["google_connections"])).rows);await c.end();})();
'
```
Expected: migration applies; `rowsecurity: true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_google_connections.sql && git commit -m "feat: google_connections table with department-scoped RLS"
```

---

### Task 4: Scopes config + OAuth fetch wrappers + start route

**Files:**
- Create: `lib/google/scopes.ts`, `lib/google/oauth.ts`, `app/api/google/oauth/start/route.ts`

- [ ] **Step 1: Scopes config**

Create `lib/google/scopes.ts`:
```ts
export const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  driveReadonly: "https://www.googleapis.com/auth/drive.readonly",
  // gmail tools (later) add their scope here
} as const;

export const SCRAP_SCALE_SCOPES = [SCOPES.sheets, SCOPES.driveReadonly];

export function hasAllScopes(granted: string[], required: string[]): boolean {
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}
```

- [ ] **Step 2: OAuth fetch wrappers**

Create `lib/google/oauth.ts`:
```ts
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function buildConsentUrl(scopes: string[], state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: scopes.join(" "),
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  expires_in: number;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Decodes the email claim from a Google id_token (no signature verification needed; server trusts the token endpoint response). */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8"));
    return payload.email ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Start route**

Create `app/api/google/oauth/start/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireDepartmentAccess } from "@/lib/auth/guards";
import { buildConsentUrl, } from "@/lib/google/oauth";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";

export async function GET(req: NextRequest) {
  const dept = req.nextUrl.searchParams.get("department") ?? "accounting";
  await requireDepartmentAccess(dept); // 403/redirect if not a member
  const nonce = randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ dept, nonce })).toString("base64url");

  const url = buildConsentUrl(SCRAP_SCALE_SCOPES, state);
  const res = NextResponse.redirect(url);
  res.cookies.set("g_oauth_state", nonce, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully.

- [ ] **Step 5: Commit**

```bash
git add lib/google/scopes.ts lib/google/oauth.ts app/api/google/oauth/start && git commit -m "feat: Google scopes config, OAuth wrappers, consent start route"
```

---

### Task 5: OAuth callback + connection.ts

**Files:**
- Create: `app/api/google/oauth/callback/route.ts`, `lib/google/connection.ts`

- [ ] **Step 1: connection.ts**

Create `lib/google/connection.ts`:
```ts
import { createClient } from "@/utils/supabase/server";
import { encryptToken, decryptToken } from "./crypto";
import { refreshAccessToken } from "./oauth";
import { hasAllScopes } from "./scopes";

export class ReconsentRequired extends Error {
  constructor(msg = "Google re-consent required") {
    super(msg);
    this.name = "ReconsentRequired";
  }
}

export type GoogleConnection = {
  id: string;
  department_id: string;
  google_email: string | null;
  scopes: string[];
};

export async function getConnection(departmentId: string): Promise<GoogleConnection | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("google_connections")
    .select("id, department_id, google_email, scopes")
    .eq("department_id", departmentId)
    .maybeSingle();
  return data ?? null;
}

export async function saveConnection(args: {
  departmentId: string;
  connectedBy: string;
  googleEmail: string | null;
  refreshToken: string;
  scopes: string[];
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("google_connections").upsert(
    {
      department_id: args.departmentId,
      connected_by: args.connectedBy,
      google_email: args.googleEmail,
      refresh_token_encrypted: encryptToken(args.refreshToken),
      scopes: args.scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "department_id" },
  );
  if (error) throw error;
}

/** Mints a fresh access token from the stored refresh token. Throws ReconsentRequired if missing/insufficient scopes. */
export async function getAccessToken(
  departmentId: string,
  requiredScopes: string[],
): Promise<{ accessToken: string; scopes: string[] }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("google_connections")
    .select("refresh_token_encrypted, scopes")
    .eq("department_id", departmentId)
    .maybeSingle();
  if (!data) throw new ReconsentRequired("No Google connection for this department");
  if (!hasAllScopes(data.scopes ?? [], requiredScopes)) throw new ReconsentRequired("Missing required scopes");

  const refreshToken = decryptToken(data.refresh_token_encrypted);
  const token = await refreshAccessToken(refreshToken);
  return { accessToken: token.access_token, scopes: (token.scope ?? "").split(" ").filter(Boolean) };
}
```

- [ ] **Step 2: callback route**

Create `app/api/google/oauth/callback/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { exchangeCode, emailFromIdToken } from "@/lib/google/oauth";
import { saveConnection } from "@/lib/google/connection";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const back = (qs: string) => NextResponse.redirect(new URL(`/accounting/scrap-scale?${qs}`, url.origin));

  if (err) return back(`connected=0&reason=${encodeURIComponent(err)}`);
  if (!code || !state) return back("connected=0&reason=missing_code");

  // Verify state nonce against cookie
  let dept = "accounting";
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    dept = parsed.dept;
    const cookieNonce = req.cookies.get("g_oauth_state")?.value;
    if (!cookieNonce || cookieNonce !== parsed.nonce) return back("connected=0&reason=bad_state");
  } catch {
    return back("connected=0&reason=bad_state");
  }

  // Current platform user (must be signed in)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", url.origin));

  const { data: deptRow } = await supabase.from("departments").select("id").eq("slug", dept).single();
  if (!deptRow) return back("connected=0&reason=bad_department");

  const token = await exchangeCode(code);
  if (!token.refresh_token) return back("connected=0&reason=no_refresh_token");

  await saveConnection({
    departmentId: deptRow.id,
    connectedBy: user.id,
    googleEmail: emailFromIdToken(token.id_token),
    refreshToken: token.refresh_token,
    scopes: (token.scope ?? "").split(" ").filter(Boolean),
  });

  const res = back("connected=1");
  res.cookies.delete("g_oauth_state");
  return res;
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully.

- [ ] **Step 4: Commit**

```bash
git add lib/google/connection.ts app/api/google/oauth/callback && git commit -m "feat: Google OAuth callback + connection token module"
```

---

### ✅ PHASE A CHECKPOINT

After Task 5, Phase A is independently verifiable (deferred to the temporary connect UI in Task 16, then fully in Task 21). The connect flow, token storage, and `getAccessToken` form the reusable module the later tools share.

---

## PHASE B — Scrap Scale

### Task 6: Scrap Scale migrations

**Files:**
- Create: `supabase/migrations/0003_scrap_scale.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_scrap_scale.sql`:
```sql
create table if not exists public.ocr_cache (
  file_id       text primary key,
  department_id uuid not null references public.departments(id) on delete cascade,
  amount        numeric,
  currency      text,
  txn_id        text,
  date          text,
  confidence    numeric,
  raw_json      jsonb,
  fetched_at    timestamptz not null default now()
);

create table if not exists public.scrap_scale_runs (
  id               uuid primary key default gen_random_uuid(),
  department_id    uuid not null references public.departments(id) on delete cascade,
  created_by       uuid references public.profiles(id) on delete set null,
  spreadsheet_id   text not null,
  sheet_title      text,
  detected_columns jsonb,
  status           text not null default 'pending'
                     check (status in ('pending','reading','processing','writing','done','error')),
  total_rows       int not null default 0,
  processed_rows   int not null default 0,
  summary          jsonb,
  results_tab_name text,
  error            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.scrap_scale_run_rows (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.scrap_scale_runs(id) on delete cascade,
  row_index        int not null,
  submitted_by     text,
  links            text[] not null default '{}',
  expected_amount  numeric,
  extracted_amount numeric,
  difference       numeric,
  flagged          boolean,
  duplicate        boolean not null default false,
  status           text not null default 'pending'
                     check (status in ('ok','needs-review','note-row','pending')),
  ocr_details      jsonb,
  unique (run_id, row_index)
);
create index if not exists scrap_scale_run_rows_run_idx on public.scrap_scale_run_rows(run_id);
create index if not exists scrap_scale_runs_sheet_idx on public.scrap_scale_runs(spreadsheet_id);

alter table public.ocr_cache            enable row level security;
alter table public.scrap_scale_runs     enable row level security;
alter table public.scrap_scale_run_rows enable row level security;

drop policy if exists ocr_cache_rw on public.ocr_cache;
create policy ocr_cache_rw on public.ocr_cache for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()))
  with check (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()));

drop policy if exists runs_rw on public.scrap_scale_runs;
create policy runs_rw on public.scrap_scale_runs for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()))
  with check (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()));

-- run_rows inherit access from their parent run's department
drop policy if exists run_rows_rw on public.scrap_scale_run_rows;
create policy run_rows_rw on public.scrap_scale_run_rows for all to authenticated
  using (exists (
    select 1 from public.scrap_scale_runs r
    where r.id = run_id and (public.is_super_admin(auth.uid()) or public.is_member_of(r.department_id, auth.uid()))
  ))
  with check (exists (
    select 1 from public.scrap_scale_runs r
    where r.id = run_id and (public.is_super_admin(auth.uid()) or public.is_member_of(r.department_id, auth.uid()))
  ));
```

- [ ] **Step 2: Apply + verify**

```bash
node --env-file=.env.local supabase/migrate.mjs
node --env-file=.env.local -e '
const pg=require("pg");const c=new pg.Client({connectionString:process.env.DIRECT_URL,ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();console.table((await c.query("select tablename,rowsecurity from pg_tables where tablename in ($1,$2,$3) order by tablename",["ocr_cache","scrap_scale_run_rows","scrap_scale_runs"])).rows);await c.end();})();
'
```
Expected: 3 tables, `rowsecurity = true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_scrap_scale.sql && git commit -m "feat: scrap scale tables (ocr_cache, runs, run_rows) with RLS"
```

---

### Task 7: Drive link parsing (TDD)

**Files:**
- Create: `lib/scrap-scale/links.ts`
- Test: `lib/scrap-scale/__tests__/links.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/scrap-scale/__tests__/links.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseDriveFileIds, extractSpreadsheetId } from "../links";

describe("parseDriveFileIds", () => {
  it("parses open?id= form", () => {
    expect(parseDriveFileIds("https://drive.google.com/open?id=ABC123")).toEqual(["ABC123"]);
  });
  it("parses /file/d/<id>/ form", () => {
    expect(parseDriveFileIds("https://drive.google.com/file/d/XYZ_789/view?usp=sharing")).toEqual(["XYZ_789"]);
  });
  it("splits multiple links on comma/newline/space", () => {
    const cell = "https://drive.google.com/open?id=A1 , https://drive.google.com/file/d/B2/view\nhttps://drive.google.com/open?id=C3";
    expect(parseDriveFileIds(cell)).toEqual(["A1", "B2", "C3"]);
  });
  it("dedupes repeated ids", () => {
    expect(parseDriveFileIds("https://drive.google.com/open?id=A1 https://drive.google.com/open?id=A1")).toEqual(["A1"]);
  });
  it("returns [] for free text with no drive link", () => {
    expect(parseDriveFileIds("Scrap sale belongs to Nov 2025")).toEqual([]);
  });
});

describe("extractSpreadsheetId", () => {
  it("extracts id from a sheet url", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbC-dEf/edit#gid=0")).toBe("1AbC-dEf");
  });
  it("returns null for a non-sheet url", () => {
    expect(extractSpreadsheetId("https://example.com")).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- links`
Expected: FAIL — cannot find module `../links`.

- [ ] **Step 3: Implement**

Create `lib/scrap-scale/links.ts`:
```ts
const ID_PATTERNS = [/[?&]id=([a-zA-Z0-9_-]+)/, /\/file\/d\/([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/];

export function parseDriveFileIds(cell: string): string[] {
  if (!cell) return [];
  const tokens = cell.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const token of tokens) {
    for (const re of ID_PATTERNS) {
      const m = token.match(re);
      if (m) {
        if (!ids.includes(m[1])) ids.push(m[1]);
        break;
      }
    }
  }
  return ids;
}

export function extractSpreadsheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- links`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scrap-scale/links.ts lib/scrap-scale/__tests__/links.test.ts && git commit -m "feat: drive link + spreadsheet id parsing"
```

---

### Task 8: Per-row computation (TDD)

**Files:**
- Create: `lib/scrap-scale/compute.ts`
- Test: `lib/scrap-scale/__tests__/compute.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/scrap-scale/__tests__/compute.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { round2, computeRow } from "../compute";

describe("round2", () => {
  it("rounds float noise", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(100.005)).toBe(100.01);
  });
});

describe("computeRow", () => {
  const ok = [{ amount: 100, readable: true }, { amount: 50, readable: true }];
  it("sums valid amounts and flags zero difference as not flagged", () => {
    const r = computeRow({ expected: 150, ocr: ok, hasLinks: true });
    expect(r.extracted).toBe(150);
    expect(r.difference).toBe(0);
    expect(r.flagged).toBe(false);
    expect(r.status).toBe("ok");
  });
  it("flags non-zero difference (strict, no tolerance)", () => {
    const r = computeRow({ expected: 150, ocr: [{ amount: 149.99, readable: true }], hasLinks: true });
    expect(r.difference).toBe(-0.01);
    expect(r.flagged).toBe(true);
  });
  it("marks needs-review when any link is unreadable", () => {
    const r = computeRow({ expected: 100, ocr: [{ amount: 100, readable: true }, { amount: null, readable: false }], hasLinks: true });
    expect(r.status).toBe("needs-review");
  });
  it("marks note-row when there are no links", () => {
    const r = computeRow({ expected: null, ocr: [], hasLinks: false });
    expect(r.status).toBe("note-row");
    expect(r.flagged).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- compute`
Expected: FAIL — cannot find module `../compute`.

- [ ] **Step 3: Implement**

Create `lib/scrap-scale/compute.ts`:
```ts
export type OcrUnit = { amount: number | null; readable: boolean };
export type RowStatus = "ok" | "needs-review" | "note-row";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeRow(input: {
  expected: number | null;
  ocr: OcrUnit[];
  hasLinks: boolean;
}): { extracted: number; difference: number; flagged: boolean; status: RowStatus } {
  if (!input.hasLinks) {
    return { extracted: 0, difference: 0, flagged: false, status: "note-row" };
  }
  const valid = input.ocr.filter((u) => u.readable && typeof u.amount === "number");
  const extracted = round2(valid.reduce((s, u) => s + (u.amount as number), 0));
  const expected = input.expected ?? 0;
  const difference = round2(extracted - expected);
  const anyUnreadable = input.ocr.some((u) => !u.readable || u.amount === null);
  const status: RowStatus = anyUnreadable ? "needs-review" : "ok";
  const flagged = difference !== 0;
  return { extracted, difference, flagged, status };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- compute`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scrap-scale/compute.ts lib/scrap-scale/__tests__/compute.test.ts && git commit -m "feat: per-row reconciliation computation"
```

---

### Task 9: Duplicate detection (TDD)

**Files:**
- Create: `lib/scrap-scale/duplicates.ts`
- Test: `lib/scrap-scale/__tests__/duplicates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/scrap-scale/__tests__/duplicates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { markDuplicates } from "../duplicates";

describe("markDuplicates", () => {
  it("flags rows sharing a normalized txn_id", () => {
    const rows = [
      { row_index: 1, txnIds: ["TXN 123"] },
      { row_index: 2, txnIds: ["txn123"] },
      { row_index: 3, txnIds: ["OTHER"] },
    ];
    const dups = markDuplicates(rows);
    expect(dups.get(1)).toBe(true);
    expect(dups.get(2)).toBe(true);
    expect(dups.get(3)).toBe(false);
  });
  it("ignores null/empty txn ids", () => {
    const rows = [
      { row_index: 1, txnIds: [] },
      { row_index: 2, txnIds: [] },
    ];
    const dups = markDuplicates(rows);
    expect(dups.get(1)).toBe(false);
    expect(dups.get(2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- duplicates`
Expected: FAIL — cannot find module `../duplicates`.

- [ ] **Step 3: Implement**

Create `lib/scrap-scale/duplicates.ts`:
```ts
function normalize(txn: string): string {
  return txn.replace(/\s+/g, "").toUpperCase();
}

export function markDuplicates(
  rows: { row_index: number; txnIds: string[] }[],
): Map<number, boolean> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.txnIds) {
      if (!t) continue;
      const key = normalize(t);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const result = new Map<number, boolean>();
  for (const r of rows) {
    const dup = r.txnIds.some((t) => t && (counts.get(normalize(t)) ?? 0) > 1);
    result.set(r.row_index, dup);
  }
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- duplicates`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scrap-scale/duplicates.ts lib/scrap-scale/__tests__/duplicates.test.ts && git commit -m "feat: duplicate txn_id detection"
```

---

### Task 10: Concurrency queue + backoff (TDD)

**Files:**
- Create: `lib/scrap-scale/queue.ts`
- Test: `lib/scrap-scale/__tests__/queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/scrap-scale/__tests__/queue.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapWithConcurrency, backoffDelays } from "../queue";

describe("mapWithConcurrency", () => {
  it("processes all items and preserves order", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });
  it("never exceeds the concurrency limit", async () => {
    let active = 0, maxActive = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return null;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

describe("backoffDelays", () => {
  it("produces exponential delays", () => {
    expect(backoffDelays(3, 100)).toEqual([100, 200, 400]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- queue`
Expected: FAIL — cannot find module `../queue`.

- [ ] **Step 3: Implement**

Create `lib/scrap-scale/queue.ts`:
```ts
/** Runs `fn` over items with a bounded number of concurrent executions, preserving input order in the output. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function backoffDelays(retries: number, baseMs: number): number[] {
  return Array.from({ length: retries }, (_, i) => baseMs * 2 ** i);
}

/** Calls `fn`; on a thrown error whose `.status === 429` (or message includes 429/quota), retries with exponential backoff. */
export async function withRetry<R>(fn: () => Promise<R>, retries = 4, baseMs = 1000): Promise<R> {
  const delays = backoffDelays(retries, baseMs);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const is429 = /\b429\b|quota|rate/i.test(msg);
      if (!is429 || attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- queue`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scrap-scale/queue.ts lib/scrap-scale/__tests__/queue.test.ts && git commit -m "feat: concurrency-limited queue with exponential backoff"
```

---

### Task 11: Column detection (TDD pure + route)

**Files:**
- Create: `lib/scrap-scale/columns.ts`
- Test: `lib/scrap-scale/__tests__/columns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/scrap-scale/__tests__/columns.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeHeader, detectColumns } from "../columns";

describe("normalizeHeader", () => {
  it("strips case, spaces, punctuation", () => {
    expect(normalizeHeader("Upload Transaction Details ")).toBe("uploadtransactiondetails");
    expect(normalizeHeader("Total_Fund (Collection)")).toBe("totalfundcollection");
  });
});

describe("detectColumns", () => {
  const headers = ["Timestamp", "Name", "Upload Transaction Details", "Total Fund Collection", "Upload Transaction Details"];
  // sample rows: index 2 has drive links, index 4 is empty
  const sample = [
    ["2025-11-01", "Asha", "https://drive.google.com/open?id=A1", "150", ""],
    ["2025-11-02", "Ravi", "https://drive.google.com/file/d/B2/view", "200", "note"],
  ];
  it("detects expected + name + the link column that actually has drive links", () => {
    const d = detectColumns(headers, sample);
    expect(d.expected?.index).toBe(3);
    expect(d.name?.index).toBe(1);
    expect(d.link?.index).toBe(2);
    expect(d.ambiguous).toBe(false);
  });
  it("flags ambiguous when two header-matching columns both contain links", () => {
    const sample2 = [["t", "n", "https://drive.google.com/open?id=A1", "150", "https://drive.google.com/open?id=Z9"]];
    const d = detectColumns(headers, sample2);
    expect(d.ambiguous).toBe(true);
    expect(d.linkCandidates).toEqual([2, 4]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- columns`
Expected: FAIL — cannot find module `../columns`.

- [ ] **Step 3: Implement**

Create `lib/scrap-scale/columns.ts`:
```ts
import { parseDriveFileIds } from "./links";

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type DetectedColumn = { index: number; header: string };
export type ColumnDetection = {
  link: DetectedColumn | null;
  expected: DetectedColumn | null;
  name: DetectedColumn | null;
  ambiguous: boolean;
  linkCandidates: number[];
  headers: string[];
};

const LINK_KEY = "uploadtransactiondetails";
const EXPECTED_KEY = "totalfundcollection";
const NAME_KEYS = ["name", "submittedby", "fullname"];

function colHasLinks(sample: string[][], index: number): boolean {
  return sample.some((row) => parseDriveFileIds(row[index] ?? "").length > 0);
}

export function detectColumns(headers: string[], sample: string[][]): ColumnDetection {
  const norm = headers.map(normalizeHeader);

  const expectedIdx = norm.findIndex((h) => h.includes(EXPECTED_KEY));
  const nameIdx = norm.findIndex((h) => NAME_KEYS.some((k) => h.includes(k)));

  const linkHeaderMatches = norm.flatMap((h, i) => (h.includes(LINK_KEY) ? [i] : []));
  const linkWithData = linkHeaderMatches.filter((i) => colHasLinks(sample, i));

  let link: DetectedColumn | null = null;
  let ambiguous = false;
  if (linkWithData.length === 1) link = { index: linkWithData[0], header: headers[linkWithData[0]] };
  else if (linkWithData.length > 1) ambiguous = true;
  else if (linkHeaderMatches.length === 1) link = { index: linkHeaderMatches[0], header: headers[linkHeaderMatches[0]] };
  else if (linkHeaderMatches.length > 1) ambiguous = true;

  return {
    link,
    expected: expectedIdx >= 0 ? { index: expectedIdx, header: headers[expectedIdx] } : null,
    name: nameIdx >= 0 ? { index: nameIdx, header: headers[nameIdx] } : null,
    ambiguous,
    linkCandidates: (linkWithData.length > 1 ? linkWithData : linkHeaderMatches),
    headers,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- columns`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scrap-scale/columns.ts lib/scrap-scale/__tests__/columns.test.ts && git commit -m "feat: fuzzy column detection with link-content heuristic"
```

---

### Task 12: Sheets + Drive REST layer

**Files:**
- Create: `lib/google/sheets.ts`, `lib/google/drive.ts`

- [ ] **Step 1: Sheets client**

Create `lib/google/sheets.ts`:
```ts
const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

async function gfetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = new Error(`Sheets ${res.status}: ${await res.text()}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export async function getSpreadsheetMeta(id: string, accessToken: string): Promise<{ title: string; sheets: string[] }> {
  const data = await gfetch(`${BASE}/${id}?fields=properties.title,sheets.properties.title`, accessToken);
  return {
    title: data.properties?.title ?? "",
    sheets: (data.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title),
  };
}

/** Reads all values for a tab. Returns a 2D string array (rows of cells). */
export async function readValues(id: string, tab: string, accessToken: string): Promise<string[][]> {
  const range = encodeURIComponent(`${tab}`);
  const data = await gfetch(`${BASE}/${id}/values/${range}?valueRenderOption=FORMATTED_VALUE`, accessToken);
  return (data.values ?? []) as string[][];
}

/** Adds a new sheet/tab and returns its title. */
export async function addResultsTab(id: string, title: string, accessToken: string): Promise<string> {
  await gfetch(`${BASE}/${id}:batchUpdate`, accessToken, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  return title;
}

/** Writes a 2D array starting at A1 of the given tab. */
export async function writeValues(id: string, tab: string, values: (string | number | null)[][], accessToken: string): Promise<void> {
  const range = encodeURIComponent(`${tab}!A1`);
  await gfetch(`${BASE}/${id}/values/${range}?valueInputOption=RAW`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
}
```

- [ ] **Step 2: Drive client**

Create `lib/google/drive.ts`:
```ts
/** Downloads a Drive file's bytes + mime type via files.get?alt=media. */
export async function downloadFile(
  fileId: string,
  accessToken: string,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const err = new Error(`Drive ${res.status}: ${await res.text()}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType };
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully.

- [ ] **Step 4: Commit**

```bash
git add lib/google/sheets.ts lib/google/drive.ts && git commit -m "feat: Google Sheets + Drive REST clients"
```

---

### Task 13: Gemini OCR client

**Files:**
- Create: `lib/scrap-scale/prompt.ts`, `lib/scrap-scale/ocr.ts`

- [ ] **Step 1: Prompt**

Create `lib/scrap-scale/prompt.ts`:
```ts
export const OCR_PROMPT = `You are reading a screenshot of an Indian digital payment confirmation (Google Pay, PhonePe, Paytm, BHIM/UPI, or a bank app).
Return ONLY a JSON object, no markdown, with exactly these keys:
{"amount": number|null, "currency": string, "txn_id": string|null, "date": string|null, "confidence": number, "notes": string}
Rules:
- "amount": the actual amount PAID/transferred in this transaction as a number (no currency symbol, no commas). If several numbers appear (balance, cashback, fee), return the transaction amount that was paid.
- "currency": e.g. "INR". 
- "txn_id": the UPI transaction id / reference no / UTR if visible, else null.
- "date": transaction date as shown (string) or null.
- "confidence": 0..1, your confidence in the amount.
- "notes": short note; if the amount is unreadable, set "amount": null and explain why here.
Return null for any field you cannot read. Output the JSON object and nothing else.`;
```

- [ ] **Step 2: OCR client**

Create `lib/scrap-scale/ocr.ts`:
```ts
import { OCR_PROMPT } from "./prompt";

export type OcrResult = {
  amount: number | null;
  currency: string;
  txn_id: string | null;
  date: string | null;
  confidence: number;
  notes: string;
};

function parseJsonLoose(text: string): OcrResult {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
  const obj = JSON.parse(slice);
  return {
    amount: typeof obj.amount === "number" ? obj.amount : obj.amount == null ? null : Number(obj.amount) || null,
    currency: typeof obj.currency === "string" ? obj.currency : "INR",
    txn_id: obj.txn_id ?? null,
    date: obj.date ?? null,
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    notes: typeof obj.notes === "string" ? obj.notes : "",
  };
}

/** Calls Gemini with an inline image. Throws on HTTP error (status attached for backoff). */
export async function geminiExtract(base64: string, mimeType: string): Promise<OcrResult> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: OCR_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini ${res.status}: ${await res.text()}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    return parseJsonLoose(text);
  } catch {
    return { amount: null, currency: "INR", txn_id: null, date: null, confidence: 0, notes: `unparseable model output: ${text.slice(0, 120)}` };
  }
}
```

- [ ] **Step 3: Smoke-test Gemini connectivity (real key)**

Create a throwaway check (delete after):
```bash
cat > /Users/vanshsood/Projects/everest/gemini-smoke.mjs <<'EOF'
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
const res = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({ contents:[{ parts:[{ text:"Reply with the single word OK." }]}] }) });
console.log("status", res.status);
console.log((await res.text()).slice(0, 300));
EOF
node --env-file=.env.local gemini-smoke.mjs; rm -f gemini-smoke.mjs
```
Expected: status 200 and a response containing "OK". **If 400/403/API-key error:** stop — the `GEMINI_API_KEY` is wrong/format-mismatched; tell the user (the provided key prefix `AQ.` is not the usual AI Studio `AIza…` format, so confirm it's a Generative Language API key).

- [ ] **Step 4: Commit**

```bash
git add lib/scrap-scale/prompt.ts lib/scrap-scale/ocr.ts && git commit -m "feat: Gemini Flash OCR client with defensive JSON parsing"
```

---

### Task 14: Run creation route (read sheet → pending rows)

**Files:**
- Create: `app/api/tools/scrap-scale/detect-columns/route.ts`, `app/api/tools/scrap-scale/run/route.ts`
- Create: `lib/scrap-scale/access.ts` (shared dept-id + guard helper)

- [ ] **Step 1: Shared access helper**

Create `lib/scrap-scale/access.ts`:
```ts
import { requireDepartmentAccess } from "@/lib/auth/guards";

export const DEPT_SLUG = "accounting";

/** Guards the Accounting department and returns its id. */
export async function requireAccounting(): Promise<{ departmentId: string; userId: string }> {
  const { user, department } = await requireDepartmentAccess(DEPT_SLUG);
  return { departmentId: department.id, userId: user.id };
}
```

- [ ] **Step 2: detect-columns route**

Create `app/api/tools/scrap-scale/detect-columns/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { extractSpreadsheetId } from "@/lib/scrap-scale/links";
import { getSpreadsheetMeta, readValues } from "@/lib/google/sheets";
import { detectColumns } from "@/lib/scrap-scale/columns";

export async function POST(req: NextRequest) {
  const { departmentId } = await requireAccounting();
  const { url, tab } = await req.json();
  const spreadsheetId = extractSpreadsheetId(url ?? "");
  if (!spreadsheetId) return NextResponse.json({ error: "Could not find a spreadsheet id in that URL." }, { status: 400 });

  let accessToken: string;
  try {
    ({ accessToken } = await getAccessToken(departmentId, SCRAP_SCALE_SCOPES));
  } catch (e) {
    if (e instanceof ReconsentRequired) return NextResponse.json({ error: "reconsent_required" }, { status: 409 });
    throw e;
  }

  const meta = await getSpreadsheetMeta(spreadsheetId, accessToken);
  const sheetTab = tab && meta.sheets.includes(tab) ? tab : meta.sheets[0];
  const values = await readValues(spreadsheetId, sheetTab, accessToken);
  const headers = values[0] ?? [];
  const sample = values.slice(1, 21);
  const detection = detectColumns(headers, sample);

  return NextResponse.json({ spreadsheetId, sheetTab, sheets: meta.sheets, headers, detection, rowCount: Math.max(values.length - 1, 0) });
}
```

- [ ] **Step 3: run creation route**

Create `app/api/tools/scrap-scale/run/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { readValues } from "@/lib/google/sheets";
import { parseDriveFileIds } from "@/lib/scrap-scale/links";

export async function POST(req: NextRequest) {
  const { departmentId, userId } = await requireAccounting();
  const { spreadsheetId, sheetTab, columns } = await req.json();
  // columns = { link:{index}, expected:{index}, name:{index|null} }
  if (!spreadsheetId || !columns?.link) return NextResponse.json({ error: "Missing spreadsheet or link column." }, { status: 400 });

  let accessToken: string;
  try {
    ({ accessToken } = await getAccessToken(departmentId, SCRAP_SCALE_SCOPES));
  } catch (e) {
    if (e instanceof ReconsentRequired) return NextResponse.json({ error: "reconsent_required" }, { status: 409 });
    throw e;
  }

  const values = await readValues(spreadsheetId, sheetTab, accessToken);
  const dataRows = values.slice(1);
  const supabase = await createClient();

  const { data: run, error: runErr } = await supabase
    .from("scrap_scale_runs")
    .insert({
      department_id: departmentId, created_by: userId, spreadsheet_id: spreadsheetId,
      sheet_title: sheetTab, detected_columns: columns, status: "processing", total_rows: dataRows.length,
    })
    .select("id").single();
  if (runErr) throw runErr;

  const rows = dataRows.map((row, i) => {
    const links = parseDriveFileIds(row[columns.link.index] ?? "");
    const expectedRaw = columns.expected ? (row[columns.expected.index] ?? "") : "";
    const expected = expectedRaw === "" ? null : Number(String(expectedRaw).replace(/[^0-9.\-]/g, "")) || null;
    return {
      run_id: run.id, row_index: i + 1,
      submitted_by: columns.name ? (row[columns.name.index] ?? null) : null,
      links, expected_amount: expected,
      status: links.length === 0 ? "note-row" : "pending",
    };
  });
  // chunk insert (Supabase caps payloads)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("scrap_scale_run_rows").insert(rows.slice(i, i + 500));
    if (error) throw error;
  }

  const noteRows = rows.filter((r) => r.status === "note-row").length;
  await supabase.from("scrap_scale_runs").update({ processed_rows: noteRows }).eq("id", run.id);

  return NextResponse.json({ runId: run.id, totalRows: dataRows.length });
}
```

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully.

- [ ] **Step 5: Commit**

```bash
git add lib/scrap-scale/access.ts "app/api/tools/scrap-scale/detect-columns" "app/api/tools/scrap-scale/run/route.ts" && git commit -m "feat: detect-columns and run-creation routes"
```

---

### Task 15: process-chunk engine + status route

**Files:**
- Create: `app/api/tools/scrap-scale/run/[runId]/process-chunk/route.ts`, `app/api/tools/scrap-scale/run/[runId]/route.ts`

- [ ] **Step 1: process-chunk route**

Create `app/api/tools/scrap-scale/run/[runId]/process-chunk/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { downloadFile } from "@/lib/google/drive";
import { geminiExtract } from "@/lib/scrap-scale/ocr";
import { computeRow, type OcrUnit } from "@/lib/scrap-scale/compute";
import { markDuplicates } from "@/lib/scrap-scale/duplicates";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";

const CHUNK = 8;       // rows per invocation (keeps under serverless time limit)
const CONCURRENCY = 5; // simultaneous OCR/Drive ops

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireAccounting();
  const supabase = await createClient();
  const force = req.nextUrl.searchParams.get("force") === "1";

  const { data: run } = await supabase.from("scrap_scale_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const { data: pending } = await supabase
    .from("scrap_scale_run_rows").select("*").eq("run_id", runId).eq("status", "pending")
    .order("row_index").limit(CHUNK);

  if (!pending || pending.length === 0) {
    return await finalize(supabase, runId, departmentId);
  }

  const { accessToken } = await getAccessToken(departmentId, SCRAP_SCALE_SCOPES);

  for (const row of pending) {
    const units: (OcrUnit & { file_id: string; txn_id: string | null; detail: unknown })[] = await mapWithConcurrency(
      row.links as string[], CONCURRENCY, async (fileId) => {
        // cache check
        if (!force) {
          const { data: cached } = await supabase.from("ocr_cache").select("*").eq("file_id", fileId).maybeSingle();
          if (cached) return { amount: cached.amount, readable: cached.amount !== null, file_id: fileId, txn_id: cached.txn_id, detail: cached.raw_json };
        }
        try {
          const { base64, mimeType } = await withRetry(() => downloadFile(fileId, accessToken));
          const ocr = await withRetry(() => geminiExtract(base64, mimeType));
          await supabase.from("ocr_cache").upsert({
            file_id: fileId, department_id: departmentId, amount: ocr.amount, currency: ocr.currency,
            txn_id: ocr.txn_id, date: ocr.date, confidence: ocr.confidence, raw_json: ocr, fetched_at: new Date().toISOString(),
          });
          return { amount: ocr.amount, readable: ocr.amount !== null, file_id: fileId, txn_id: ocr.txn_id, detail: ocr };
        } catch (e) {
          return { amount: null, readable: false, file_id: fileId, txn_id: null, detail: { error: String(e) } };
        }
      });

    const c = computeRow({ expected: row.expected_amount, ocr: units.map((u) => ({ amount: u.amount, readable: u.readable })), hasLinks: row.links.length > 0 });
    await supabase.from("scrap_scale_run_rows").update({
      extracted_amount: c.extracted, difference: c.difference, flagged: c.flagged, status: c.status,
      ocr_details: units.map((u) => ({ file_id: u.file_id, amount: u.amount, txn_id: u.txn_id, detail: u.detail })),
    }).eq("id", row.id);
  }

  const { count } = await supabase.from("scrap_scale_run_rows").select("id", { count: "exact", head: true }).eq("run_id", runId).neq("status", "pending");
  await supabase.from("scrap_scale_runs").update({ processed_rows: count ?? 0 }).eq("id", runId);

  const { data: subtotalRows } = await supabase.from("scrap_scale_run_rows").select("extracted_amount").eq("run_id", runId);
  const subtotal = (subtotalRows ?? []).reduce((s, r) => s + (Number(r.extracted_amount) || 0), 0);

  return NextResponse.json({ processed: count ?? 0, total: run.total_rows, subtotal, done: false });
}

async function finalize(supabase: Awaited<ReturnType<typeof createClient>>, runId: string, _departmentId: string) {
  // duplicate detection across all rows
  const { data: rows } = await supabase.from("scrap_scale_run_rows").select("id, row_index, ocr_details, extracted_amount, difference, flagged, status").eq("run_id", runId);
  const all = rows ?? [];
  const dups = markDuplicates(all.map((r) => ({
    row_index: r.row_index,
    txnIds: ((r.ocr_details as { txn_id: string | null }[]) ?? []).map((d) => d.txn_id ?? "").filter(Boolean),
  })));
  for (const r of all) {
    const isDup = dups.get(r.row_index) ?? false;
    if (isDup !== r.duplicate) await supabase.from("scrap_scale_run_rows").update({ duplicate: isDup }).eq("id", r.id);
  }

  const summary = {
    totalRows: all.length,
    reconciled: all.filter((r) => r.status !== "note-row" && Number(r.difference) === 0).length,
    flagged: all.filter((r) => r.flagged).length,
    duplicates: [...dups.values()].filter(Boolean).length,
    needsReview: all.filter((r) => r.status === "needs-review").length,
    noteRows: all.filter((r) => r.status === "note-row").length,
    sumExtracted: all.reduce((s, r) => s + (Number(r.extracted_amount) || 0), 0),
  };
  await supabase.from("scrap_scale_runs").update({ status: "done", summary }).eq("id", runId);
  return NextResponse.json({ processed: all.length, total: all.length, subtotal: summary.sumExtracted, done: true, summary });
}
```
**Note:** `duplicate` defaults to false in the schema, so the `isDup !== r.duplicate` comparison reads the DB default correctly on first finalize.

- [ ] **Step 2: status/results route**

Create `app/api/tools/scrap-scale/run/[runId]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAccounting();
  const supabase = await createClient();
  const { data: run } = await supabase.from("scrap_scale_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: rows } = await supabase.from("scrap_scale_run_rows").select("*").eq("run_id", runId).order("row_index");
  return NextResponse.json({ run, rows: rows ?? [] });
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully.

- [ ] **Step 4: Commit**

```bash
git add "app/api/tools/scrap-scale/run/[runId]" && git commit -m "feat: chunked OCR processing engine + run status route"
```

---

### Task 16: Write-back tab + temporary connect verification

**Files:**
- Create: `app/api/tools/scrap-scale/run/[runId]/write-back/route.ts`

- [ ] **Step 1: write-back route**

Create `app/api/tools/scrap-scale/run/[runId]/write-back/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { readValues, addResultsTab, writeValues } from "@/lib/google/sheets";

function tabName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `ScrapScale ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireAccounting();
  const supabase = await createClient();
  const { data: run } = await supabase.from("scrap_scale_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { accessToken } = await getAccessToken(departmentId, SCRAP_SCALE_SCOPES);

  // Read the original tab, append 3 columns onto a copy.
  const original = await readValues(run.spreadsheet_id, run.sheet_title, accessToken);
  const { data: rows } = await supabase.from("scrap_scale_run_rows").select("row_index, extracted_amount, difference, flagged").eq("run_id", runId).order("row_index");
  const byIndex = new Map((rows ?? []).map((r) => [r.row_index, r]));

  const out: (string | number | null)[][] = original.map((row, i) => {
    if (i === 0) return [...row, "Extracted Values", "Difference", "Flag"];
    const r = byIndex.get(i); // data row i corresponds to row_index i
    return [...row, r?.extracted_amount ?? "", r?.difference ?? "", r?.flagged ? "FLAGGED" : "OK"];
  });

  const name = tabName(new Date());
  await addResultsTab(run.spreadsheet_id, name, accessToken);
  await writeValues(run.spreadsheet_id, name, out, accessToken);
  await supabase.from("scrap_scale_runs").update({ results_tab_name: name }).eq("id", runId);

  return NextResponse.json({ resultsTab: name });
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully.

- [ ] **Step 3: Manual connect test (real Google)**

Start the dev server, sign in as super_admin, then in the browser visit `http://localhost:3000/api/google/oauth/start?department=accounting`. Consent as `vansh.sood@everestfleet.in`. Expected: redirect back to `/accounting/scrap-scale?connected=1`, and a row in `google_connections`:
```bash
node --env-file=.env.local -e '
const pg=require("pg");const c=new pg.Client({connectionString:process.env.DIRECT_URL,ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();console.log((await c.query("select google_email, scopes, length(refresh_token_encrypted) enc_len from google_connections")).rows);await c.end();})();
'
```
Expected: one row with `google_email`, both scopes, non-zero `enc_len`. **If no refresh token saved:** re-consent (the `prompt=consent` should force it).

- [ ] **Step 4: Commit**

```bash
git add "app/api/tools/scrap-scale/run/[runId]/write-back" && git commit -m "feat: write results to a new dated tab (original untouched)"
```

---

### Task 17: Image proxy + export routes

**Files:**
- Create: `app/api/tools/scrap-scale/image/route.ts`, `app/api/tools/scrap-scale/run/[runId]/export/route.ts`

- [ ] **Step 1: image proxy (drill-down screenshots)**

Create `app/api/tools/scrap-scale/image/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { downloadFile } from "@/lib/google/drive";

export async function GET(req: NextRequest) {
  const { departmentId } = await requireAccounting();
  const fileId = req.nextUrl.searchParams.get("file");
  if (!fileId) return NextResponse.json({ error: "missing file" }, { status: 400 });
  const { accessToken } = await getAccessToken(departmentId, SCRAP_SCALE_SCOPES);
  const { base64, mimeType } = await downloadFile(fileId, accessToken);
  return new NextResponse(Buffer.from(base64, "base64"), {
    headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=300" },
  });
}
```

- [ ] **Step 2: export route (CSV + Excel)**

Create `app/api/tools/scrap-scale/run/[runId]/export/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";

const HEADERS = ["Row", "Submitted By", "Links", "Expected", "Extracted", "Difference", "Flag", "Duplicate", "Status"];

function toRow(r: Record<string, unknown>): (string | number)[] {
  return [
    r.row_index as number, (r.submitted_by as string) ?? "", ((r.links as string[]) ?? []).join(" | "),
    Number(r.expected_amount ?? 0), Number(r.extracted_amount ?? 0), Number(r.difference ?? 0),
    r.flagged ? "FLAGGED" : "OK", r.duplicate ? "DUPLICATE" : "", r.status as string,
  ];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAccounting();
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const supabase = await createClient();
  const { data: rows } = await supabase.from("scrap_scale_run_rows").select("*").eq("run_id", runId).order("row_index");
  const data = (rows ?? []).map(toRow);

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Scrap Scale");
    ws.addRow(HEADERS); data.forEach((d) => ws.addRow(d));
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="scrap-scale-${runId}.xlsx"`,
      },
    });
  }

  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [HEADERS, ...data].map((r) => r.map(esc).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="scrap-scale-${runId}.csv"` },
  });
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully.

- [ ] **Step 4: Commit**

```bash
git add "app/api/tools/scrap-scale/image" "app/api/tools/scrap-scale/run/[runId]/export" && git commit -m "feat: image proxy + CSV/Excel export"
```

---

### Task 18: UI — ScrapScaleApp (connect, detect, override, run, progress)

**Files:**
- Create: `components/scrap-scale/ScrapScaleApp.tsx`, `components/scrap-scale/ReconSummary.tsx`, `components/scrap-scale/ResultsTable.tsx`
- Replace: `app/(app)/[department]/[tool]/page.tsx` is generic; create dedicated `app/(app)/accounting/scrap-scale/page.tsx`

- [ ] **Step 1: ReconSummary**

Create `components/scrap-scale/ReconSummary.tsx`:
```tsx
export type Summary = {
  totalRows: number; reconciled: number; flagged: number; duplicates: number;
  needsReview: number; noteRows: number; sumExtracted: number;
};

export function ReconSummary({ summary, sumExpected }: { summary: Summary; sumExpected: number }) {
  const net = Math.round((summary.sumExtracted - sumExpected) * 100) / 100;
  const cell = (label: string, value: string | number, tone = "text-gray-900") => (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {cell("Total rows", summary.totalRows)}
      {cell("Reconciled", summary.reconciled, "text-green-700")}
      {cell("Flagged", summary.flagged, summary.flagged ? "text-red-600" : "text-gray-900")}
      {cell("Duplicates", summary.duplicates, summary.duplicates ? "text-amber-600" : "text-gray-900")}
      {cell("Needs review", summary.needsReview, summary.needsReview ? "text-amber-600" : "text-gray-900")}
      {cell("Note rows", summary.noteRows)}
      {cell("Net difference", net, net === 0 ? "text-green-700" : "text-red-600")}
    </div>
  );
}
```

- [ ] **Step 2: ResultsTable (with drill-down)**

Create `components/scrap-scale/ResultsTable.tsx`:
```tsx
"use client";
import { useState } from "react";

type Row = {
  id: string; row_index: number; submitted_by: string | null; links: string[];
  expected_amount: number | null; extracted_amount: number | null; difference: number | null;
  flagged: boolean | null; duplicate: boolean; status: string;
  ocr_details: { file_id: string; amount: number | null; txn_id: string | null }[] | null;
};

export function ResultsTable({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const badge = (r: Row) => {
    if (r.status === "note-row") return <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">note</span>;
    if (r.status === "needs-review") return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">needs review</span>;
    if (r.flagged) return <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">flagged</span>;
    return <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">ok</span>;
  };
  return (
    <table className="min-w-full text-sm">
      <thead><tr className="text-left text-gray-500">
        <th className="px-2 py-2">#</th><th className="px-2 py-2">Submitted by</th>
        <th className="px-2 py-2">Expected</th><th className="px-2 py-2">Extracted</th>
        <th className="px-2 py-2">Difference</th><th className="px-2 py-2">Dup?</th><th className="px-2 py-2">Status</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <>
            <tr key={r.id} className="border-t hover:bg-gray-50">
              <td className="px-2 py-2 text-gray-900">{r.row_index}</td>
              <td className="px-2 py-2 text-gray-900">{r.submitted_by ?? "—"}</td>
              <td className="px-2 py-2 text-gray-900">{r.expected_amount ?? "—"}</td>
              <td className="px-2 py-2">
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="font-medium text-indigo-700 hover:underline disabled:text-gray-400" disabled={!r.links.length}>
                  {r.extracted_amount ?? "—"}
                </button>
              </td>
              <td className={`px-2 py-2 ${Number(r.difference) !== 0 ? "text-red-600" : "text-gray-900"}`}>{r.difference ?? "—"}</td>
              <td className="px-2 py-2">{r.duplicate ? "⚠️" : ""}</td>
              <td className="px-2 py-2">{badge(r)}</td>
            </tr>
            {open === r.id && (
              <tr className="bg-gray-50"><td colSpan={7} className="px-4 py-3">
                <div className="flex flex-wrap gap-4">
                  {(r.ocr_details ?? []).map((d) => (
                    <div key={d.file_id} className="w-48">
                      <img src={`/api/tools/scrap-scale/image?file=${d.file_id}`} alt="screenshot" className="rounded border" />
                      <div className="mt-1 text-xs text-gray-600">amount: <b>{d.amount ?? "unreadable"}</b>{d.txn_id ? ` · txn ${d.txn_id}` : ""}</div>
                    </div>
                  ))}
                </div>
              </td></tr>
            )}
          </>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: ScrapScaleApp (the main client flow)**

Create `components/scrap-scale/ScrapScaleApp.tsx`:
```tsx
"use client";
import { useState } from "react";
import { ReconSummary, type Summary } from "./ReconSummary";
import { ResultsTable } from "./ResultsTable";

type Detection = {
  link: { index: number; header: string } | null;
  expected: { index: number; header: string } | null;
  name: { index: number; header: string } | null;
  ambiguous: boolean; linkCandidates: number[]; headers: string[];
};

export function ScrapScaleApp({ connected, connectedEmail }: { connected: boolean; connectedEmail: string | null }) {
  const [url, setUrl] = useState("");
  const [detect, setDetect] = useState<{ spreadsheetId: string; sheetTab: string; headers: string[]; detection: Detection; rowCount: number } | null>(null);
  const [cols, setCols] = useState<{ link: number; expected: number; name: number }>({ link: -1, expected: -1, name: -1 });
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; subtotal: number } | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sumExpected, setSumExpected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDetect() {
    setError(null); setBusy(true);
    const res = await fetch("/api/tools/scrap-scale/detect-columns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    setBusy(false);
    if (res.status === 409) { setError("Google access needs re-consent. Click Connect Google."); return; }
    if (!res.ok) { setError((await res.json()).error ?? "Detection failed"); return; }
    const d = await res.json();
    setDetect(d);
    setCols({ link: d.detection.link?.index ?? -1, expected: d.detection.expected?.index ?? -1, name: d.detection.name?.index ?? -1 });
  }

  async function doRun() {
    if (!detect || cols.link < 0) { setError("Pick the link column."); return; }
    setError(null); setBusy(true); setSummary(null); setRows([]);
    const res = await fetch("/api/tools/scrap-scale/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spreadsheetId: detect.spreadsheetId, sheetTab: detect.sheetTab,
        columns: { link: { index: cols.link }, expected: cols.expected >= 0 ? { index: cols.expected } : null, name: cols.name >= 0 ? { index: cols.name } : null } }),
    });
    if (!res.ok) { setBusy(false); setError((await res.json()).error ?? "Run failed"); return; }
    const { runId: id, totalRows } = await res.json();
    setRunId(id); setProgress({ processed: 0, total: totalRows, subtotal: 0 });

    // chunk loop
    let done = false;
    while (!done) {
      const cr = await fetch(`/api/tools/scrap-scale/run/${id}/process-chunk`, { method: "POST" });
      if (!cr.ok) { setError("Processing error"); break; }
      const p = await cr.json();
      setProgress({ processed: p.processed, total: p.total, subtotal: p.subtotal });
      done = p.done;
      if (p.done && p.summary) setSummary(p.summary);
    }
    // load final rows
    const final = await fetch(`/api/tools/scrap-scale/run/${id}`).then((r) => r.json());
    setRows(final.rows);
    setSumExpected(final.rows.reduce((s: number, r: any) => s + (Number(r.expected_amount) || 0), 0));
    setBusy(false);
  }

  async function writeBack() {
    if (!runId) return;
    setBusy(true);
    const res = await fetch(`/api/tools/scrap-scale/run/${runId}/write-back`, { method: "POST" });
    setBusy(false);
    if (res.ok) { const { resultsTab } = await res.json(); alert(`Wrote results tab: ${resultsTab}`); }
    else setError("Write-back failed");
  }

  if (!connected) {
    return (
      <div className="rounded-xl border bg-white p-8">
        <p className="mb-4 text-sm text-gray-600">Connect a Google account (with access to the source sheet + Drive) to use Scrap Scale.</p>
        <a href="/api/google/oauth/start?department=accounting" className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm text-white">Connect Google</a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Connected as {connectedEmail ?? "Google account"}</span>
        <a href="/api/google/oauth/start?department=accounting" className="text-indigo-600 hover:underline">Reconnect</a>
      </div>

      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste Google Sheet URL"
          className="flex-1 rounded-md border px-3 py-2 text-sm text-gray-900" />
        <button onClick={doDetect} disabled={busy || !url} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">Detect columns</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {detect && (
        <div className="rounded-xl border bg-white p-4">
          {detect.detection.ambiguous && <p className="mb-2 text-sm text-amber-700">Two link columns matched — pick the correct one.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["link", "expected", "name"] as const).map((field) => (
              <label key={field} className="text-sm">
                <span className="mb-1 block text-gray-600">{field === "link" ? "Link column" : field === "expected" ? "Total Fund Collection" : "Name (optional)"}</span>
                <select value={cols[field]} onChange={(e) => setCols({ ...cols, [field]: Number(e.target.value) })} className="w-full rounded border px-2 py-1 text-gray-900">
                  <option value={-1}>—</option>
                  {detect.headers.map((h, i) => <option key={i} value={i}>{h || `(col ${i + 1})`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={doRun} disabled={busy || cols.link < 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">Run ({detect.rowCount} rows)</button>
            {progress && <span className="text-sm text-gray-600">{progress.processed}/{progress.total} · subtotal ₹{progress.subtotal.toLocaleString("en-IN")}</span>}
          </div>
          {progress && progress.total > 0 && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-100">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {summary && (
        <>
          <ReconSummary summary={summary} sumExpected={sumExpected} />
          <div className="flex gap-2">
            <button onClick={writeBack} disabled={busy} className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50">Write results tab to sheet</button>
            {runId && <a href={`/api/tools/scrap-scale/run/${runId}/export?format=csv`} className="rounded-md border px-3 py-2 text-sm">Download CSV</a>}
            {runId && <a href={`/api/tools/scrap-scale/run/${runId}/export?format=xlsx`} className="rounded-md border px-3 py-2 text-sm">Download Excel</a>}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-white p-2"><ResultsTable rows={rows} /></div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: dedicated page**

Create `app/(app)/accounting/scrap-scale/page.tsx`:
```tsx
import { requireDepartmentAccess } from "@/lib/auth/guards";
import { getConnection } from "@/lib/google/connection";
import { ScrapScaleApp } from "@/components/scrap-scale/ScrapScaleApp";
import { RunHistory } from "@/components/scrap-scale/RunHistory";
import { createClient } from "@/utils/supabase/server";

export default async function ScrapScalePage() {
  const { department } = await requireDepartmentAccess("accounting");
  const conn = await getConnection(department.id);
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("scrap_scale_runs")
    .select("id, spreadsheet_id, sheet_title, status, total_rows, summary, results_tab_name, created_at")
    .eq("department_id", department.id).order("created_at", { ascending: false }).limit(25);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">Scrap Scale</h1>
        <p className="mb-6 text-sm text-gray-500">Reconcile payment screenshots against Total Fund Collection.</p>
        <ScrapScaleApp connected={!!conn} connectedEmail={conn?.google_email ?? null} />
      </div>
      <RunHistory runs={runs ?? []} />
    </div>
  );
}
```

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully (RunHistory created next task; if build runs before Task 19, temporarily stub the import).

- [ ] **Step 6: Commit**

```bash
git add components/scrap-scale "app/(app)/accounting/scrap-scale" && git commit -m "feat: Scrap Scale UI — detect, override, run, progress, results"
```

---

### Task 19: Run history + comparison

**Files:**
- Create: `components/scrap-scale/RunHistory.tsx`

- [ ] **Step 1: RunHistory component**

Create `components/scrap-scale/RunHistory.tsx`:
```tsx
"use client";
import { useState } from "react";

type Run = {
  id: string; spreadsheet_id: string; sheet_title: string | null; status: string;
  total_rows: number; summary: { flagged?: number; duplicates?: number; sumExtracted?: number } | null;
  results_tab_name: string | null; created_at: string;
};

export function RunHistory({ runs }: { runs: Run[] }) {
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const runA = runs.find((r) => r.id === a);
  const runB = runs.find((r) => r.id === b);

  if (!runs.length) return null;
  return (
    <div>
      <h2 className="mb-3 text-lg font-medium text-gray-900">Run history</h2>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-gray-500">
            <th className="px-3 py-2">When</th><th className="px-3 py-2">Sheet/tab</th><th className="px-3 py-2">Rows</th>
            <th className="px-3 py-2">Flagged</th><th className="px-3 py-2">Duplicates</th><th className="px-3 py-2">Σ Extracted</th>
            <th className="px-3 py-2">Results tab</th><th className="px-3 py-2">Compare</th>
          </tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-gray-900">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-gray-600">{r.sheet_title ?? r.spreadsheet_id.slice(0, 8)}</td>
                <td className="px-3 py-2">{r.total_rows}</td>
                <td className="px-3 py-2">{r.summary?.flagged ?? "—"}</td>
                <td className="px-3 py-2">{r.summary?.duplicates ?? "—"}</td>
                <td className="px-3 py-2">{r.summary?.sumExtracted != null ? `₹${r.summary.sumExtracted.toLocaleString("en-IN")}` : "—"}</td>
                <td className="px-3 py-2 text-gray-600">{r.results_tab_name ?? "—"}</td>
                <td className="px-3 py-2">
                  <button onClick={() => (a === r.id ? setA(null) : b === r.id ? setB(null) : !a ? setA(r.id) : setB(r.id))}
                    className={`rounded border px-2 py-0.5 text-xs ${a === r.id ? "bg-indigo-600 text-white" : b === r.id ? "bg-indigo-400 text-white" : ""}`}>
                    {a === r.id ? "A" : b === r.id ? "B" : "pick"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {runA && runB && (
        <div className="mt-4 rounded-xl border bg-white p-4 text-sm">
          <h3 className="mb-2 font-medium text-gray-900">Compare A vs B</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-gray-500">Metric</div><div className="text-gray-500">A ({new Date(runA.created_at).toLocaleDateString()})</div><div className="text-gray-500">B</div>
            {([["Rows", "total_rows"], ["Flagged", "flagged"], ["Duplicates", "duplicates"], ["Σ Extracted", "sumExtracted"]] as const).map(([label, key]) => {
              const av = key === "total_rows" ? runA.total_rows : (runA.summary as any)?.[key] ?? 0;
              const bv = key === "total_rows" ? runB.total_rows : (runB.summary as any)?.[key] ?? 0;
              return (<><div key={label} className="text-gray-900">{label}</div><div>{av}</div><div className={av !== bv ? "font-semibold text-indigo-700" : ""}>{bv} {av !== bv ? `(Δ ${Number(bv) - Number(av)})` : ""}</div></>);
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep -E "Compiled|Failed|error" | head
```
Expected: compiled successfully.

- [ ] **Step 3: Commit**

```bash
git add components/scrap-scale/RunHistory.tsx && git commit -m "feat: run history with two-instance comparison"
```

---

### Task 20: Registry, README, env.example

**Files:**
- Modify: `lib/tools/registry.ts`, `README.md`, `.env.example` (already done in Task 1)

- [ ] **Step 1: Registry description stays; route already correct**

The registry entry already points at `/accounting/scrap-scale`, which now resolves to the dedicated page (it takes precedence over the generic `[department]/[tool]` route). No change needed beyond confirming the route renders the real component. Verify:
```bash
grep -n "scrap-scale" lib/tools/registry.ts
```

- [ ] **Step 2: README — add a Scrap Scale section**

Append to `README.md` a "## Scrap Scale (Accounting)" section covering: connect Google (Internal app; use an account with access to the source sheet + Drive folder), required scopes (`spreadsheets` read+write, `drive.readonly`), paste sheet URL → detect/override columns → Run → progress → results + write-back tab (`ScrapScale <date>`, original untouched) → CSV/Excel export → run history/compare; and the env vars (`GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`).

- [ ] **Step 3: Commit**

```bash
git add lib/tools/registry.ts README.md && git commit -m "docs: Scrap Scale usage + scopes; confirm registry route"
```

---

### Task 21: End-to-end verification (real Google + Gemini)

**Files:** none (verification)

- [ ] **Step 1: Run unit suite**

```bash
npm test 2>&1 | grep -E "Test Files|Tests "
```
Expected: all pure-logic tests pass.

- [ ] **Step 2: Drive the real flow**

With the dev server running and signed in as super_admin (member access to Accounting is automatic for super_admin):
1. Open `/accounting/scrap-scale` → "Connect Google" → consent as `vansh.sood@everestfleet.in`.
2. Paste the user-provided sheet URL → **Detect columns** → confirm link col (the one with Drive links), Total Fund Collection, Name → adjust if needed.
3. **Run** → watch progress bar + subtotal advance → results table populates.
4. Verify: flagged rows have non-zero difference; duplicate txns marked; note rows excluded; a row's extracted value expands to show the screenshot(s) + OCR amount.
5. **Write results tab** → open the sheet in Google → confirm a new `ScrapScale <date>` tab with 3 appended columns, original tab unchanged.
6. **Download CSV** and **Excel**; open them.
7. Re-run the same sheet → confirm it's faster (OCR cache hits; check `ocr_cache` row count is stable).
8. Confirm the run appears in **Run history**; pick two and compare.

Capture screenshots of the results table + the new sheet tab as evidence.

- [ ] **Step 3: Final commit (if any docs tweaks)**

```bash
git add -A && git commit -m "chore: scrap scale end-to-end verified" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Phase A OAuth module (table, crypto, scopes, start/callback, token mint, ReconsentRequired) → Tasks 1–5. ✓
- OCR cache / runs / run_rows tables + RLS → Task 6. ✓
- Multi-link parsing, both URL forms, note rows → Task 7 + run route (Task 14). ✓
- Per-row compute (sum, round2, strict flag, needs-review) → Task 8. ✓
- Duplicate detection (normalized txn_id) → Task 9 + finalize (Task 15). ✓
- Throttle + backoff + concurrency → Task 10 + process-chunk (Task 15). ✓
- Fuzzy column detection + link-content heuristic + ambiguity + override → Task 11 (logic), Task 14 (route), Task 18 (override UI). ✓
- Sheets/Drive read, Gemini OCR (structured JSON, defensive parse) → Tasks 12, 13. ✓
- Chunked/resumable processing + live progress + subtotal → Task 15 + Task 18 chunk loop. ✓
- Results table + drill-down + recon summary → Task 18. ✓
- Write-back new dated tab (original untouched) → Task 16. ✓
- CSV + Excel export → Task 17. ✓
- Instances + history + compare → page load (Task 18) + Task 19. ✓
- All Google/Gemini server-side; reuse guard + connection → access helper (Task 14), all routes. ✓
- `.env.example`, registry, README → Tasks 1, 20. ✓

**Placeholder scan:** No TBD/TODO. README step (Task 20) lists concrete required sections (prose written by engineer) — acceptable for a docs step. Task 18 Step 5 notes a temporary stub only if building before Task 19; the real component lands in Task 19 within the same plan.

**Type consistency:** `OcrUnit {amount,readable}` (Task 8) consumed in process-chunk (Task 15). `computeRow` return `{extracted,difference,flagged,status}` used in process-chunk + UI. `ColumnDetection` shape (Task 11) returned by detect-columns route (Task 14) and consumed by `Detection` type in ScrapScaleApp (Task 18) — fields `link/expected/name/ambiguous/linkCandidates/headers` match. `getAccessToken(departmentId, scopes)` signature consistent across detect/run/process-chunk/write-back/image routes. `Summary` shape (Task 18) matches the `summary` object built in `finalize` (Task 15): `totalRows, reconciled, flagged, duplicates, needsReview, noteRows, sumExtracted`. ✓

**Known follow-ups (not blockers):** the `<>` fragment with `key` in ResultsTable (Task 18) should use `<React.Fragment key=…>`; fix during implementation if the linter flags it. The provided `GEMINI_API_KEY` prefix is unusual — Task 13 Step 3 smoke-tests it before relying on it.
