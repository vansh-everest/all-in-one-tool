# Lender Follow-up Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Finance-department tool that reads UNREAD Gmail, matches each email to a lender (deterministic first, AI on-demand), extracts open pending items per lender via Gemini, and presents a per-lender tracker with a self-teaching review queue, saved instances, and CSV/Excel export — never marking mail read.

**Architecture:** Pure logic modules (`lib/lender/*`) are TDD-unit-tested; a chunked/resumable run pipeline (API routes mirroring Scrap Scale's `process-chunk` loop) lists unread ids, fetches metadata, deterministically matches by sender, and for matched threads fetches full content + Gemini-extracts (cached by message id). Gmail uses Clerk's per-user OAuth token with the `gmail.readonly` scope; Gemini calls reuse the existing key-rotation + backoff helpers. Supabase service-role only (RLS on, no policies).

**Tech Stack:** Next.js 16 (App Router, TS), Clerk auth, Supabase (`@supabase/supabase-js` service role), Gmail REST API, Gemini 2.5 Flash REST, ExcelJS, Vitest.

---

## Reference patterns (read before coding)

- **Chunked run loop:** `app/api/tools/scrap-scale/run/[runId]/process-chunk/route.ts` (CHUNK const, finalize on empty, `mapWithConcurrency`).
- **Concurrency/backoff:** `lib/scrap-scale/queue.ts` — `mapWithConcurrency(items, limit, fn)`, `withRetry(fn, retries, baseMs)`, `backoffDelays`.
- **Gemini key rotation:** `lib/scrap-scale/gemini-keys.ts` — `parseGeminiKeys()`, `isRateLimitStatus(status)`, `nextStartIndex(poolSize)`. The rotate-on-429 fetch loop is in `lib/scrap-scale/ocr.ts` `geminiExtract`.
- **Activity log:** `lib/scrap-scale/activity.ts` — `appendActivity(db, runId, message)` (read-modify-write of an `activities` jsonb column on a specific table; we'll write a lender-specific copy because the table name differs).
- **Export with ExcelJS:** `app/api/tools/scrap-scale/run/[runId]/export/route.ts`.
- **Admin client:** `utils/supabase/admin.ts` — `createAdminClient()` (sync).
- **Auth guard:** `lib/auth/guards.ts` — `requireDepartmentAccess(slug)` returns `{ user, role, department }` where `role` is `"admin" | "member" | "super"`.
- **Connection:** `lib/google/connection.ts` — `getConnection`, `getAccessToken(userId, scopes)`, `ReconsentRequired`.
- **Migration tooling:** `supabase/migrate.mjs` runs ALL files and is NOT re-runnable after destructive migrations; we apply `0006` via a one-off idempotent script (`supabase/apply-0006.mjs`) using `DIRECT_URL`, matching how `0004`/`0005` were applied.

---

## File Structure

**Create:**
- `supabase/migrations/0006_lender_followup.sql` — tables (idempotent).
- `supabase/apply-0006.mjs` — one-off applier (DIRECT_URL).
- `lib/lender/types.ts` — shared TS types.
- `lib/lender/match.ts` — deterministic sender→lender matching (pure).
- `lib/lender/extract.ts` — parse Gemini extraction JSON (pure).
- `lib/lender/classify.ts` — parse Gemini classification + threshold (pure).
- `lib/lender/ignore.ts` — filter ignored senders (pure).
- `lib/lender/aggregate.ts` — group extractions by lender + counts (pure).
- `lib/lender/exportRows.ts` — CSV/xlsx row building (pure).
- `lib/lender/activity.ts` — `appendLenderActivity(db, runId, message)`.
- `lib/lender/access.ts` — `requireFinance()`, `requireFinanceAdmin()`.
- `lib/gemini/client.ts` — `geminiJson(prompt)` with key rotation + backoff (shared, text-in/JSON-out).
- `lib/google/gmail.ts` — Gmail REST client (list ids, metadata, full).
- `app/api/tools/lender-followup/lenders/route.ts` — list/create lenders.
- `app/api/tools/lender-followup/lenders/[id]/route.ts` — patch/delete lender.
- `app/api/tools/lender-followup/run/route.ts` — create run + list unread ids.
- `app/api/tools/lender-followup/run/[runId]/route.ts` — GET run + tracker + queue.
- `app/api/tools/lender-followup/run/[runId]/process-chunk/route.ts` — chunk processor.
- `app/api/tools/lender-followup/run/[runId]/classify-queue/route.ts` — on-demand AI classify.
- `app/api/tools/lender-followup/run/[runId]/assign/route.ts` — assign/ignore.
- `app/api/tools/lender-followup/run/[runId]/export/route.ts` — CSV/xlsx.
- `app/api/tools/lender-followup/message/[messageId]/route.ts` — cached full content.
- `app/(app)/finance/lender-followup/page.tsx` — server page.
- `components/lender/LenderFollowupApp.tsx` — main client app.
- `components/lender/LenderManager.tsx` — lender CRUD UI.
- `components/lender/LenderRunHistory.tsx` — instance list.
- `lib/lender/__tests__/*.test.ts` — unit tests.

**Modify:**
- `lib/google/scopes.ts` — add `gmailReadonly` + `LENDER_FOLLOWUP_SCOPES`.
- `lib/google/connection.ts` — generalize `getConnection(userId, scopes)`.
- `app/(app)/accounting/scrap-scale/page.tsx` — pass `SCRAP_SCALE_SCOPES` to the generalized `getConnection`.
- `lib/tools/registry.ts` — add `lender-followup` under `finance`.
- `supabase/seed.mjs` — seed the 9 lenders into the finance department.
- `.env.example`, `README.md`.

---

## Task 1: Database migration + apply script

**Files:**
- Create: `supabase/migrations/0006_lender_followup.sql`
- Create: `supabase/apply-0006.mjs`

- [ ] **Step 1: Write the migration (idempotent)**

```sql
-- 0006_lender_followup.sql — Lender Follow-up Tracker (Finance). Idempotent.

create table if not exists public.lenders (
  id                  uuid primary key default gen_random_uuid(),
  department_id       uuid not null references public.departments(id) on delete cascade,
  name                text not null,
  aliases             text[] not null default '{}',
  sender_domains      text[] not null default '{}',
  known_sender_emails text[] not null default '{}',
  owner               text,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);
create unique index if not exists lenders_dept_name_idx on public.lenders(department_id, name);

create table if not exists public.lender_ignored_senders (
  id               uuid primary key default gen_random_uuid(),
  department_id    uuid not null references public.departments(id) on delete cascade,
  email            text not null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  unique (department_id, email)
);

create table if not exists public.lender_message_cache (
  department_id  uuid not null references public.departments(id) on delete cascade,
  message_id     text not null,
  lender_id      uuid references public.lenders(id) on delete set null,
  thread_id      text,
  from_email     text,
  subject        text,
  internal_date  timestamptz,
  snippet        text,
  extraction     jsonb,
  extracted_at   timestamptz not null default now(),
  primary key (department_id, message_id)
);

create table if not exists public.lender_runs (
  id                 uuid primary key default gen_random_uuid(),
  department_id      uuid not null references public.departments(id) on delete cascade,
  created_by_email   text,
  status             text not null default 'running',
  worklist           jsonb not null default '[]'::jsonb,
  cursor             int not null default 0,
  counts             jsonb not null default '{}'::jsonb,
  summary            jsonb,
  activities         jsonb not null default '[]'::jsonb,
  last_internal_date timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists public.lender_run_items (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.lender_runs(id) on delete cascade,
  lender_id         uuid,
  lender_name       text,
  owner             text,
  item              text,
  status            text,
  last_update_date  text,
  direction         text,
  source_message_id text,
  thread_id         text
);
create index if not exists lender_run_items_run_idx on public.lender_run_items(run_id);

alter table public.lenders                enable row level security;
alter table public.lender_ignored_senders enable row level security;
alter table public.lender_message_cache   enable row level security;
alter table public.lender_runs            enable row level security;
alter table public.lender_run_items       enable row level security;
```

- [ ] **Step 2: Write the one-off applier**

```js
// supabase/apply-0006.mjs — applies ONLY 0006 (migrate.mjs is not re-runnable after 0004).
// Usage: node --env-file=.env.local supabase/apply-0006.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const sql = await readFile(join(here, "migrations", "0006_lender_followup.sql"), "utf8");
const connectionString = process.env.DIRECT_URL;
if (!connectionString) {
  console.error("Missing DIRECT_URL env var.");
  process.exit(1);
}
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
await client.end();
console.log("0006 applied.");
```

- [ ] **Step 3: Apply the migration**

Run: `node --env-file=.env.local supabase/apply-0006.mjs`
Expected: `0006 applied.`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_lender_followup.sql supabase/apply-0006.mjs
git commit -m "feat(lender): migration 0006 — lender follow-up tables"
```

---

## Task 2: Shared types

**Files:**
- Create: `lib/lender/types.ts`

- [ ] **Step 1: Write the types**

```ts
export type Lender = {
  id: string;
  department_id: string;
  name: string;
  aliases: string[];
  sender_domains: string[];
  known_sender_emails: string[];
  owner: string | null;
  active: boolean;
  created_at: string;
};

export type EmailMeta = {
  id: string;
  threadId: string;
  from: string;       // raw "Name <addr@x.com>"
  fromEmail: string;  // lowercased addr@x.com
  subject: string;
  date: string;       // RFC date header
  internalDate: string | null; // ISO, from Gmail internalDate (ms epoch)
  snippet: string;
};

export type Direction = "awaiting_lender" | "action_on_us" | "unclear";

export type PendencyItem = {
  item: string;
  status: string;
  last_update_date: string | null;
  direction: Direction;
  source_message_id: string;
};

export type Extraction = {
  items: PendencyItem[];
  last_contact_date: string | null;
};

export type TrackerLender = {
  lender_id: string | null;
  lender_name: string;
  owner: string | null;
  items: PendencyItem[];
};

export type RunCounts = {
  unread_total: number;
  matched: number;
  queued: number;
  lenders_with_items: number;
  open_items: number;
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/lender/types.ts
git commit -m "feat(lender): shared types"
```

---

## Task 3: Deterministic matching (`match.ts`)

**Files:**
- Create: `lib/lender/match.ts`
- Test: `lib/lender/__tests__/match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, emailDomain, matchLender } from "../match";
import type { Lender } from "../types";

const lender = (over: Partial<Lender>): Lender => ({
  id: "l1", department_id: "d1", name: "Axis", aliases: [], sender_domains: [],
  known_sender_emails: [], owner: null, active: true, created_at: "", ...over,
});

describe("normalizeEmail / emailDomain", () => {
  it("extracts and lowercases the address from a display-name header", () => {
    expect(normalizeEmail("Axis Bank <Alerts@AxisBank.com>")).toBe("alerts@axisbank.com");
    expect(emailDomain("Alerts@AxisBank.com")).toBe("axisbank.com");
  });
  it("returns empty string for junk", () => {
    expect(normalizeEmail("")).toBe("");
    expect(emailDomain("not-an-email")).toBe("");
  });
});

describe("matchLender", () => {
  const lenders = [
    lender({ id: "axis", known_sender_emails: ["alerts@axisbank.com"], sender_domains: ["axisbank.com"] }),
    lender({ id: "bob", sender_domains: ["bankofbaroda.com"] }),
    lender({ id: "inactive", sender_domains: ["x.com"], active: false }),
  ];
  it("matches a known sender email exactly (highest priority)", () => {
    expect(matchLender("alerts@axisbank.com", lenders)).toBe("axis");
  });
  it("matches by sender domain suffix", () => {
    expect(matchLender("noreply@bankofbaroda.com", lenders)).toBe("bob");
  });
  it("ignores inactive lenders", () => {
    expect(matchLender("a@x.com", lenders)).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(matchLender("someone@gmail.com", lenders)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/lender/__tests__/match.test.ts`
Expected: FAIL — `Cannot find module '../match'`.

- [ ] **Step 3: Implement**

```ts
import type { Lender } from "./types";

/** Pull the bare address out of a possibly "Name <addr>" header and lowercase it. */
export function normalizeEmail(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/);
  const addr = (m ? m[1] : raw).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(addr) ? addr : "";
}

export function emailDomain(raw: string): string {
  const addr = normalizeEmail(raw);
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1) : "";
}

/**
 * Deterministic match: exact known_sender_emails first, then sender_domains suffix.
 * Only active lenders participate. Returns the lender id or null.
 */
export function matchLender(fromEmail: string, lenders: Lender[]): string | null {
  const addr = normalizeEmail(fromEmail);
  if (!addr) return null;
  const domain = emailDomain(addr);
  const active = lenders.filter((l) => l.active);
  for (const l of active) {
    if (l.known_sender_emails.map((e) => e.toLowerCase()).includes(addr)) return l.id;
  }
  for (const l of active) {
    if (l.sender_domains.some((d) => d && (domain === d.toLowerCase() || domain.endsWith("." + d.toLowerCase())))) {
      return l.id;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/lender/__tests__/match.test.ts`
Expected: PASS (4 + 2 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/lender/match.ts lib/lender/__tests__/match.test.ts
git commit -m "feat(lender): deterministic sender→lender matching"
```

---

## Task 4: Extraction JSON parsing (`extract.ts`)

**Files:**
- Create: `lib/lender/extract.ts`
- Test: `lib/lender/__tests__/extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseExtraction } from "../extract";

describe("parseExtraction", () => {
  it("parses a clean object with items", () => {
    const r = parseExtraction(JSON.stringify({
      items: [{ item: "NACH revision", status: "submitted", last_update_date: "2026-05-01",
                direction: "awaiting_lender", source_message_id: "m1" }],
      last_contact_date: "2026-05-02",
    }), "m1");
    expect(r.items).toHaveLength(1);
    expect(r.items[0].direction).toBe("awaiting_lender");
    expect(r.last_contact_date).toBe("2026-05-02");
  });
  it("strips ```json fences", () => {
    const r = parseExtraction("```json\n{\"items\":[],\"last_contact_date\":null}\n```", "m1");
    expect(r.items).toEqual([]);
    expect(r.last_contact_date).toBeNull();
  });
  it("defaults missing fields and forces source_message_id + valid direction", () => {
    const r = parseExtraction(JSON.stringify({ items: [{ item: "x" }] }), "msgX");
    expect(r.items[0].status).toBe("");
    expect(r.items[0].source_message_id).toBe("msgX");
    expect(r.items[0].direction).toBe("unclear");
    expect(r.items[0].last_update_date).toBeNull();
  });
  it("returns empty extraction for unparseable output", () => {
    const r = parseExtraction("the bank says hi", "m1");
    expect(r.items).toEqual([]);
    expect(r.last_contact_date).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/lender/__tests__/extract.test.ts`
Expected: FAIL — `Cannot find module '../extract'`.

- [ ] **Step 3: Implement**

```ts
import type { Direction, Extraction, PendencyItem } from "./types";

const DIRECTIONS: Direction[] = ["awaiting_lender", "action_on_us", "unclear"];

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim();
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function toStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Parse Gemini extraction output for a thread. `messageId` is the fallback source id. */
export function parseExtraction(text: string, messageId: string): Extraction {
  const empty: Extraction = { items: [], last_contact_date: null };
  const candidate = firstJsonObject(stripFences(text ?? ""));
  if (!candidate) return empty;
  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return empty;
  }
  if (!obj || typeof obj !== "object") return empty;
  const o = obj as Record<string, unknown>;
  const rawItems = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
  const items: PendencyItem[] = rawItems
    .filter((it) => it && typeof it === "object")
    .map((it) => {
      const dir = toStr(it.direction) as Direction;
      const last = it.last_update_date;
      return {
        item: toStr(it.item),
        status: toStr(it.status),
        last_update_date: last == null || last === "" ? null : toStr(last),
        direction: DIRECTIONS.includes(dir) ? dir : "unclear",
        source_message_id: toStr(it.source_message_id) || messageId,
      };
    })
    .filter((it) => it.item.trim() !== "");
  const lcd = o.last_contact_date;
  return { items, last_contact_date: lcd == null || lcd === "" ? null : toStr(lcd) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/lender/__tests__/extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lender/extract.ts lib/lender/__tests__/extract.test.ts
git commit -m "feat(lender): tolerant extraction JSON parsing"
```

---

## Task 5: Classification parsing + threshold (`classify.ts`)

**Files:**
- Create: `lib/lender/classify.ts`
- Test: `lib/lender/__tests__/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseClassification } from "../classify";

describe("parseClassification", () => {
  it("returns lenderId when confidence >= threshold", () => {
    const r = parseClassification(JSON.stringify({ lender_id: "axis", confidence: 0.9 }), 0.7);
    expect(r).toEqual({ lenderId: "axis", confidence: 0.9 });
  });
  it("nulls the lenderId when below threshold", () => {
    const r = parseClassification(JSON.stringify({ lender_id: "axis", confidence: 0.4 }), 0.7);
    expect(r).toEqual({ lenderId: null, confidence: 0.4 });
  });
  it("treats explicit none / missing id as no match", () => {
    expect(parseClassification(JSON.stringify({ lender_id: "none", confidence: 0.99 }), 0.7).lenderId).toBeNull();
    expect(parseClassification(JSON.stringify({ confidence: 0.99 }), 0.7).lenderId).toBeNull();
  });
  it("returns confidence 0 / null on garbage", () => {
    expect(parseClassification("nonsense", 0.7)).toEqual({ lenderId: null, confidence: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/lender/__tests__/classify.test.ts`
Expected: FAIL — `Cannot find module '../classify'`.

- [ ] **Step 3: Implement**

```ts
function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim();
}
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parse a Gemini classification {lender_id, confidence}. Returns lenderId only when
 * confidence >= threshold and the id is a real lender id (not "none"/empty).
 */
export function parseClassification(
  text: string,
  threshold: number,
): { lenderId: string | null; confidence: number } {
  const candidate = firstJsonObject(stripFences(text ?? ""));
  if (!candidate) return { lenderId: null, confidence: 0 };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return { lenderId: null, confidence: 0 };
  }
  const conf = typeof obj.confidence === "number" ? obj.confidence : 0;
  const idRaw = typeof obj.lender_id === "string" ? obj.lender_id.trim() : "";
  const valid = idRaw && idRaw.toLowerCase() !== "none";
  return { lenderId: valid && conf >= threshold ? idRaw : null, confidence: conf };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/lender/__tests__/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lender/classify.ts lib/lender/__tests__/classify.test.ts
git commit -m "feat(lender): classification parsing + threshold gating"
```

---

## Task 6: Ignored-sender filtering (`ignore.ts`)

**Files:**
- Create: `lib/lender/ignore.ts`
- Test: `lib/lender/__tests__/ignore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { filterIgnored } from "../ignore";
import type { EmailMeta } from "../types";

const meta = (fromEmail: string): EmailMeta => ({
  id: fromEmail, threadId: "t", from: fromEmail, fromEmail, subject: "", date: "",
  internalDate: null, snippet: "",
});

describe("filterIgnored", () => {
  it("drops emails whose sender is on the ignore set (case-insensitive)", () => {
    const out = filterIgnored([meta("a@x.com"), meta("B@Y.com")], new Set(["b@y.com"]));
    expect(out.map((m) => m.fromEmail)).toEqual(["a@x.com"]);
  });
  it("returns all when ignore set is empty", () => {
    expect(filterIgnored([meta("a@x.com")], new Set())).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/lender/__tests__/ignore.test.ts`
Expected: FAIL — `Cannot find module '../ignore'`.

- [ ] **Step 3: Implement**

```ts
import type { EmailMeta } from "./types";

/** Remove emails whose sender address is in the ignore set (set values must be lowercased). */
export function filterIgnored(emails: EmailMeta[], ignored: Set<string>): EmailMeta[] {
  if (ignored.size === 0) return emails;
  return emails.filter((m) => !ignored.has(m.fromEmail.toLowerCase()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/lender/__tests__/ignore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lender/ignore.ts lib/lender/__tests__/ignore.test.ts
git commit -m "feat(lender): ignored-sender filter"
```

---

## Task 7: Aggregation + counts (`aggregate.ts`)

**Files:**
- Create: `lib/lender/aggregate.ts`
- Test: `lib/lender/__tests__/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { aggregateTracker, computeCounts } from "../aggregate";
import type { Extraction, Lender } from "../types";

const lender = (id: string, name: string, owner: string | null): Lender => ({
  id, department_id: "d", name, aliases: [], sender_domains: [], known_sender_emails: [],
  owner, active: true, created_at: "",
});
const item = (s: string) => ({
  item: s, status: "open", last_update_date: null, direction: "awaiting_lender" as const,
  source_message_id: "m",
});

describe("aggregateTracker", () => {
  const lenders = [lender("axis", "Axis", "Jaisen"), lender("bob", "BoB", "Purvi")];
  const byMessage: { lenderId: string; extraction: Extraction }[] = [
    { lenderId: "axis", extraction: { items: [item("NACH"), item("Sanction")], last_contact_date: null } },
    { lenderId: "axis", extraction: { items: [item("Statement")], last_contact_date: null } },
    { lenderId: "bob", extraction: { items: [], last_contact_date: null } },
  ];
  it("groups items under each matched lender, carrying owner", () => {
    const t = aggregateTracker(lenders, byMessage);
    const axis = t.find((x) => x.lender_id === "axis")!;
    expect(axis.owner).toBe("Jaisen");
    expect(axis.items.map((i) => i.item)).toEqual(["NACH", "Sanction", "Statement"]);
  });
  it("omits lenders with zero items", () => {
    const t = aggregateTracker(lenders, byMessage);
    expect(t.find((x) => x.lender_id === "bob")).toBeUndefined();
  });
});

describe("computeCounts", () => {
  it("counts lenders-with-items, open items, matched, queued", () => {
    const lenders = [lender("axis", "Axis", null)];
    const tracker = aggregateTracker(lenders, [
      { lenderId: "axis", extraction: { items: [item("a"), item("b")], last_contact_date: null } },
    ]);
    const c = computeCounts(tracker, { unreadTotal: 100, matched: 5, queued: 12 });
    expect(c).toEqual({ unread_total: 100, matched: 5, queued: 12, lenders_with_items: 1, open_items: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/lender/__tests__/aggregate.test.ts`
Expected: FAIL — `Cannot find module '../aggregate'`.

- [ ] **Step 3: Implement**

```ts
import type { Extraction, Lender, RunCounts, TrackerLender } from "./types";

/** Group extracted items by matched lender. Lenders with no items are omitted. */
export function aggregateTracker(
  lenders: Lender[],
  byMessage: { lenderId: string; extraction: Extraction }[],
): TrackerLender[] {
  const byId = new Map<string, Lender>(lenders.map((l) => [l.id, l]));
  const groups = new Map<string, TrackerLender>();
  for (const { lenderId, extraction } of byMessage) {
    if (!extraction.items.length) continue;
    const l = byId.get(lenderId);
    let g = groups.get(lenderId);
    if (!g) {
      g = { lender_id: lenderId, lender_name: l?.name ?? "(unknown)", owner: l?.owner ?? null, items: [] };
      groups.set(lenderId, g);
    }
    g.items.push(...extraction.items);
  }
  return [...groups.values()].sort((a, b) => a.lender_name.localeCompare(b.lender_name));
}

export function computeCounts(
  tracker: TrackerLender[],
  raw: { unreadTotal: number; matched: number; queued: number },
): RunCounts {
  return {
    unread_total: raw.unreadTotal,
    matched: raw.matched,
    queued: raw.queued,
    lenders_with_items: tracker.length,
    open_items: tracker.reduce((s, t) => s + t.items.length, 0),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/lender/__tests__/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lender/aggregate.ts lib/lender/__tests__/aggregate.test.ts
git commit -m "feat(lender): tracker aggregation + counts"
```

---

## Task 8: Export rows (`exportRows.ts`)

**Files:**
- Create: `lib/lender/exportRows.ts`
- Test: `lib/lender/__tests__/exportRows.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { EXPORT_HEADERS, trackerToRows, rowsToCsv } from "../exportRows";
import type { TrackerLender } from "../types";

const tracker: TrackerLender[] = [
  {
    lender_id: "axis", lender_name: "Axis", owner: "Jaisen",
    items: [{ item: "NACH revision", status: "submitted", last_update_date: "2026-05-01",
              direction: "awaiting_lender", source_message_id: "m1" }],
  },
];

describe("trackerToRows", () => {
  it("emits one row per item with lender + owner columns", () => {
    const rows = trackerToRows(tracker);
    expect(rows[0]).toEqual(["Axis", "Jaisen", "NACH revision", "submitted", "2026-05-01", "awaiting_lender", "m1"]);
  });
});

describe("rowsToCsv", () => {
  it("prepends headers and quotes fields with commas", () => {
    const csv = rowsToCsv(EXPORT_HEADERS, [["a,b", "c"]]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(EXPORT_HEADERS.join(","));
    expect(lines[1]).toBe('"a,b",c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/lender/__tests__/exportRows.test.ts`
Expected: FAIL — `Cannot find module '../exportRows'`.

- [ ] **Step 3: Implement**

```ts
import type { TrackerLender } from "./types";

export const EXPORT_HEADERS = [
  "Lender", "Owner", "Item", "Status", "Last Update", "Direction", "Source Message",
];

export function trackerToRows(tracker: TrackerLender[]): string[][] {
  const rows: string[][] = [];
  for (const t of tracker) {
    for (const it of t.items) {
      rows.push([
        t.lender_name,
        t.owner ?? "",
        it.item,
        it.status,
        it.last_update_date ?? "",
        it.direction,
        it.source_message_id,
      ]);
    }
  }
  return rows;
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function rowsToCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/lender/__tests__/exportRows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lender/exportRows.ts lib/lender/__tests__/exportRows.test.ts
git commit -m "feat(lender): export row + CSV building"
```

---

## Task 9: Shared Gemini JSON client (`lib/gemini/client.ts`)

**Files:**
- Create: `lib/gemini/client.ts`
- Test: `lib/gemini/__tests__/client.test.ts`

This wraps a text prompt → model text response with key rotation (reusing `lib/scrap-scale/gemini-keys.ts`) and 429 failover. The pure, testable part is `pickKeyOrder`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pickKeyOrder } from "../client";

describe("pickKeyOrder", () => {
  it("rotates the starting key then continues round-robin", () => {
    expect(pickKeyOrder(["a", "b", "c"], 1)).toEqual(["b", "c", "a"]);
    expect(pickKeyOrder(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
  });
  it("handles a single key", () => {
    expect(pickKeyOrder(["a"], 0)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/gemini/__tests__/client.test.ts`
Expected: FAIL — `Cannot find module '../client'`.

- [ ] **Step 3: Implement**

```ts
import { parseGeminiKeys, isRateLimitStatus, nextStartIndex } from "@/lib/scrap-scale/gemini-keys";

/** Rotate the key pool so attempts start at `start` then continue round-robin. */
export function pickKeyOrder(keys: string[], start: number): string[] {
  return keys.map((_, i) => keys[(start + i) % keys.length]);
}

/**
 * Send a text-only prompt to Gemini and return the model's text. Rotates across all
 * configured keys on 429 (one attempt per key per call); throws a 429-tagged error if
 * every key is rate-limited so the caller's withRetry/backoff can wait and retry.
 */
export async function geminiJson(prompt: string): Promise<string> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const keys = parseGeminiKeys();
  const order = pickKeyOrder(keys, nextStartIndex(keys.length));
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });

  let lastRateLimit: Error | null = null;
  for (const key of order) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const json = await res.json();
      const text: string =
        json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      return text;
    }
    const text = await res.text();
    if (isRateLimitStatus(res.status)) {
      lastRateLimit = Object.assign(new Error(`Gemini 429: ${text}`), { status: 429 });
      continue;
    }
    throw Object.assign(new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  }
  throw lastRateLimit ?? Object.assign(new Error("Gemini: all keys exhausted"), { status: 429 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/gemini/__tests__/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/gemini/client.ts lib/gemini/__tests__/client.test.ts
git commit -m "feat(gemini): shared text→JSON client with key rotation"
```

---

## Task 10: Prompts (`lib/lender/prompts.ts`)

**Files:**
- Create: `lib/lender/prompts.ts`
- Test: `lib/lender/__tests__/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildClassifyPrompt, buildExtractPrompt } from "../prompts";

describe("buildClassifyPrompt", () => {
  it("includes each active lender id+name and the email subject/snippet", () => {
    const p = buildClassifyPrompt(
      [{ id: "axis", name: "Axis Bank" }, { id: "bob", name: "Bank of Baroda" }],
      { subject: "EMI bounce", snippet: "your nach failed" },
    );
    expect(p).toContain("axis");
    expect(p).toContain("Axis Bank");
    expect(p).toContain("EMI bounce");
    expect(p).toContain("lender_id");
    expect(p).toContain("confidence");
  });
});

describe("buildExtractPrompt", () => {
  it("asks for the documented JSON shape and embeds the messages", () => {
    const p = buildExtractPrompt("Axis Bank", [{ id: "m1", date: "2026-05-01", body: "NACH to be revised" }]);
    expect(p).toContain("awaiting_lender");
    expect(p).toContain("last_contact_date");
    expect(p).toContain("NACH to be revised");
    expect(p).toContain("m1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/lender/__tests__/prompts.test.ts`
Expected: FAIL — `Cannot find module '../prompts'`.

- [ ] **Step 3: Implement**

```ts
export function buildClassifyPrompt(
  lenders: { id: string; name: string }[],
  email: { subject: string; snippet: string },
): string {
  const list = lenders.map((l) => `- ${l.id}: ${l.name}`).join("\n");
  return [
    "You classify an email as being from one of these lenders/banks, or none.",
    "Lenders (id: name):",
    list,
    "",
    `Email subject: ${email.subject}`,
    `Email snippet: ${email.snippet}`,
    "",
    'Respond with JSON only: {"lender_id": "<one of the ids above, or \\"none\\">", "confidence": <0..1>}.',
  ].join("\n");
}

export function buildExtractPrompt(
  lenderName: string,
  messages: { id: string; date: string; body: string }[],
): string {
  const blocks = messages
    .map((m) => `--- message_id: ${m.id} (date: ${m.date}) ---\n${m.body}`)
    .join("\n\n");
  return [
    `These are the latest email(s) in a thread with the lender "${lenderName}".`,
    "Extract the list of OPEN pending items (things still to be done or awaited).",
    "Be concise and factual, matching short status-note style (e.g. \"NACH to be revised to new EMI - submitted\").",
    "",
    "Respond with JSON only in exactly this shape:",
    "{",
    '  "items": [',
    '    { "item": string, "status": string, "last_update_date": string|null,',
    '      "direction": "awaiting_lender" | "action_on_us" | "unclear", "source_message_id": string }',
    "  ],",
    '  "last_contact_date": string|null',
    "}",
    "Use the message_id values shown below for source_message_id. If there are no open items, return an empty items array.",
    "",
    blocks,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/lender/__tests__/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lender/prompts.ts lib/lender/__tests__/prompts.test.ts
git commit -m "feat(lender): Gemini classify + extract prompts"
```

---

## Task 11: Scopes + generalize getConnection

**Files:**
- Modify: `lib/google/scopes.ts`
- Modify: `lib/google/connection.ts`
- Modify: `app/(app)/accounting/scrap-scale/page.tsx`

- [ ] **Step 1: Add the Gmail scope**

Replace the body of `lib/google/scopes.ts` with:

```ts
export const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  driveReadonly: "https://www.googleapis.com/auth/drive.readonly",
  gmailReadonly: "https://www.googleapis.com/auth/gmail.readonly",
} as const;

export const SCRAP_SCALE_SCOPES = [SCOPES.sheets, SCOPES.driveReadonly];
export const LENDER_FOLLOWUP_SCOPES = [SCOPES.gmailReadonly];

export function hasAllScopes(granted: string[], required: string[]): boolean {
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}
```

- [ ] **Step 2: Generalize `getConnection`**

In `lib/google/connection.ts`, change the import line and the `getConnection` signature:

```ts
import { hasAllScopes } from "./scopes";
```

(remove `SCRAP_SCALE_SCOPES` from that import) and replace `getConnection` with:

```ts
/** Connection status for the UI: present only when the Google sign-in granted the required scopes. */
export async function getConnection(
  clerkUserId: string,
  requiredScopes: string[],
): Promise<GoogleConnection | null> {
  const tok = await getGoogleToken(clerkUserId);
  if (!tok || !hasAllScopes(tok.scopes, requiredScopes)) return null;

  const client = await clerkClient();
  const user = await client.users.getUser(clerkUserId);
  const google = user.externalAccounts?.find((a) => a.provider === "google" || a.provider === "oauth_google");
  const email = google?.emailAddress ?? user.primaryEmailAddress?.emailAddress ?? null;
  return { clerk_user_id: clerkUserId, google_email: email, scopes: tok.scopes };
}
```

- [ ] **Step 3: Update the Scrap Scale page call site**

In `app/(app)/accounting/scrap-scale/page.tsx`, update the import and call:

```ts
import { getConnection } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
```

and change `const conn = await getConnection(user.id);` to:

```ts
const conn = await getConnection(user.id, SCRAP_SCALE_SCOPES);
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: Build completes; no type error about `getConnection` arity.

- [ ] **Step 5: Commit**

```bash
git add lib/google/scopes.ts lib/google/connection.ts "app/(app)/accounting/scrap-scale/page.tsx"
git commit -m "feat(google): add gmail.readonly scope; generalize getConnection to take scopes"
```

---

## Task 12: Gmail REST client (`lib/google/gmail.ts`)

**Files:**
- Create: `lib/google/gmail.ts`
- Test: `lib/google/__tests__/gmail.test.ts`

The HTTP calls aren't unit-tested (covered by runtime verification); the pure parsing helpers are.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseMetadata, decodeBodyParts } from "../gmail";

describe("parseMetadata", () => {
  it("pulls headers, fromEmail, internalDate from a metadata message", () => {
    const m = parseMetadata({
      id: "m1", threadId: "t1", snippet: "hello", internalDate: "1700000000000",
      payload: { headers: [
        { name: "From", value: "Axis Bank <Alerts@AxisBank.com>" },
        { name: "Subject", value: "EMI" },
        { name: "Date", value: "Wed, 01 May 2026 10:00:00 +0530" },
      ] },
    });
    expect(m.fromEmail).toBe("alerts@axisbank.com");
    expect(m.subject).toBe("EMI");
    expect(m.threadId).toBe("t1");
    expect(m.internalDate).toBe(new Date(1700000000000).toISOString());
  });
});

describe("decodeBodyParts", () => {
  it("prefers text/plain and base64url-decodes it", () => {
    const b64 = Buffer.from("Hello NACH", "utf8").toString("base64url");
    const body = decodeBodyParts({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64 } },
        { mimeType: "text/html", body: { data: Buffer.from("<b>x</b>", "utf8").toString("base64url") } },
      ],
    });
    expect(body).toBe("Hello NACH");
  });
  it("falls back to stripped HTML when no plain part", () => {
    const html = Buffer.from("<p>Hi&nbsp;there</p>", "utf8").toString("base64url");
    const body = decodeBodyParts({ mimeType: "text/html", body: { data: html } });
    expect(body.replace(/\s+/g, " ").trim()).toBe("Hi there");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/google/__tests__/gmail.test.ts`
Expected: FAIL — `Cannot find module '../gmail'`.

- [ ] **Step 3: Implement**

```ts
import { normalizeEmail } from "@/lib/lender/match";
import type { EmailMeta } from "@/lib/lender/types";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
};

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function parseMetadata(msg: GmailMessage): EmailMeta {
  const from = header(msg, "From");
  return {
    id: msg.id,
    threadId: msg.threadId,
    from,
    fromEmail: normalizeEmail(from),
    subject: header(msg, "Subject"),
    date: header(msg, "Date"),
    internalDate: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    snippet: msg.snippet ?? "",
  };
}

function b64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Walk a payload tree, prefer the first text/plain; else strip the first text/html. */
export function decodeBodyParts(payload: GmailPart): string {
  const plains: string[] = [];
  const htmls: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.mimeType === "text/plain" && p.body?.data) plains.push(b64urlDecode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) htmls.push(b64urlDecode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(payload);
  if (plains.length) return plains.join("\n").trim();
  if (htmls.length) return stripHtml(htmls.join("\n"));
  return "";
}

async function gFetch(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Page through all unread message ids. */
export async function listUnreadIds(token: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ q: "is:unread", maxResults: "500" });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await gFetch(token, `/messages?${q.toString()}`);
    if (!res.ok) throw new Error(`Gmail list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    (json.messages ?? []).forEach((m: { id: string }) => ids.push(m.id));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return ids;
}

export async function getMetadata(token: string, id: string): Promise<EmailMeta> {
  const q = "format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date";
  const res = await gFetch(token, `/messages/${id}?${q}`);
  if (!res.ok) throw new Error(`Gmail meta ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseMetadata(await res.json());
}

export async function getFull(
  token: string,
  id: string,
): Promise<{ id: string; threadId: string; from: string; subject: string; date: string; internalDate: string | null; bodyText: string }> {
  const res = await gFetch(token, `/messages/${id}?format=full`);
  if (!res.ok) throw new Error(`Gmail full ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const msg: GmailMessage = await res.json();
  const meta = parseMetadata(msg);
  const bodyText = msg.payload ? decodeBodyParts(msg.payload as GmailPart) : "";
  return { id: meta.id, threadId: meta.threadId, from: meta.from, subject: meta.subject, date: meta.date, internalDate: meta.internalDate, bodyText };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/google/__tests__/gmail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/google/gmail.ts lib/google/__tests__/gmail.test.ts
git commit -m "feat(google): gmail.readonly REST client (list/metadata/full + body decode)"
```

---

## Task 13: Access guard + activity helper

**Files:**
- Create: `lib/lender/access.ts`
- Create: `lib/lender/activity.ts`

- [ ] **Step 1: Implement the access guard**

```ts
// lib/lender/access.ts
import { requireDepartmentAccess } from "@/lib/auth/guards";

export const DEPT_SLUG = "finance";

export async function requireFinance(): Promise<{ departmentId: string; userId: string; email: string }> {
  const { user, department } = await requireDepartmentAccess(DEPT_SLUG);
  return { departmentId: department.id, userId: user.id, email: user.email };
}

/** Throws "forbidden" when the user is only a member (caller returns 403). */
export async function requireFinanceAdmin(): Promise<{ departmentId: string; userId: string; email: string }> {
  const { user, department, role } = await requireDepartmentAccess(DEPT_SLUG);
  if (role !== "admin" && role !== "super") throw new Error("forbidden");
  return { departmentId: department.id, userId: user.id, email: user.email };
}
```

- [ ] **Step 2: Implement the activity helper**

```ts
// lib/lender/activity.ts
import type { createAdminClient } from "@/utils/supabase/admin";

type DB = ReturnType<typeof createAdminClient>;
export type Activity = { at: string; message: string };

/** Append a timestamped event to a lender run's activity log (runs processed serially). */
export async function appendLenderActivity(db: DB, runId: string, message: string): Promise<void> {
  const { data } = await db.from("lender_runs").select("activities").eq("id", runId).single();
  const activities: Activity[] = Array.isArray(data?.activities) ? (data!.activities as Activity[]) : [];
  activities.push({ at: new Date().toISOString(), message });
  await db.from("lender_runs").update({ activities }).eq("id", runId);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json` (or `npm run build` if no separate typecheck)
Expected: no errors in these files.

- [ ] **Step 4: Commit**

```bash
git add lib/lender/access.ts lib/lender/activity.ts
git commit -m "feat(lender): finance access guard + run activity log"
```

---

## Task 14: Lender CRUD API

**Files:**
- Create: `app/api/tools/lender-followup/lenders/route.ts`
- Create: `app/api/tools/lender-followup/lenders/[id]/route.ts`

- [ ] **Step 1: Implement list + create**

```ts
// app/api/tools/lender-followup/lenders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";

export async function GET() {
  const { departmentId } = await requireFinance();
  const db = createAdminClient();
  const { data } = await db
    .from("lenders")
    .select("*")
    .eq("department_id", departmentId)
    .order("name");
  return NextResponse.json({ lenders: data ?? [] });
}

const toArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

export async function POST(req: NextRequest) {
  const { departmentId } = await requireFinance();
  const body = await req.json();
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from("lenders")
    .insert({
      department_id: departmentId,
      name: body.name.trim(),
      aliases: toArray(body.aliases),
      sender_domains: toArray(body.sender_domains).map((d) => d.toLowerCase()),
      known_sender_emails: toArray(body.known_sender_emails).map((e) => e.toLowerCase()),
      owner: body.owner ? String(body.owner) : null,
      active: body.active !== false,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lender: data });
}
```

- [ ] **Step 2: Implement patch + delete (delete admin-only)**

```ts
// app/api/tools/lender-followup/lenders/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance, requireFinanceAdmin } from "@/lib/lender/access";

const toArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { departmentId } = await requireFinance();
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if ("owner" in body) patch.owner = body.owner ? String(body.owner) : null;
  if ("active" in body) patch.active = !!body.active;
  if ("aliases" in body) patch.aliases = toArray(body.aliases);
  if ("sender_domains" in body) patch.sender_domains = toArray(body.sender_domains).map((d) => d.toLowerCase());
  if ("known_sender_emails" in body) patch.known_sender_emails = toArray(body.known_sender_emails).map((e) => e.toLowerCase());

  const db = createAdminClient();
  const { data, error } = await db
    .from("lenders")
    .update(patch)
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lender: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let departmentId: string;
  try {
    ({ departmentId } = await requireFinanceAdmin());
  } catch {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from("lenders")
    .delete()
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: routes compile.

- [ ] **Step 4: Commit**

```bash
git add app/api/tools/lender-followup/lenders
git commit -m "feat(lender): lender CRUD API (delete admin-only)"
```

---

## Task 15: Run creation route (list unread)

**Files:**
- Create: `app/api/tools/lender-followup/run/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { listUnreadIds } from "@/lib/google/gmail";
import { appendLenderActivity } from "@/lib/lender/activity";

export async function POST() {
  const { departmentId, userId, email } = await requireFinance();
  let accessToken: string;
  try {
    ({ accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES));
  } catch (e) {
    if (e instanceof ReconsentRequired) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }

  const ids = await listUnreadIds(accessToken);
  const db = createAdminClient();
  const { data: run, error } = await db
    .from("lender_runs")
    .insert({
      department_id: departmentId,
      created_by_email: email,
      status: "running",
      worklist: ids,
      cursor: 0,
      counts: { unread_total: ids.length, matched: 0, queued: 0, lenders_with_items: 0, open_items: 0 },
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await appendLenderActivity(db, run.id, `Run started — ${ids.length} unread emails to scan`);
  return NextResponse.json({ runId: run.id, total: ids.length });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route compiles.

- [ ] **Step 3: Commit**

```bash
git add app/api/tools/lender-followup/run/route.ts
git commit -m "feat(lender): run creation — list unread ids into worklist"
```

---

## Task 16: Process-chunk route (the core pipeline)

**Files:**
- Create: `app/api/tools/lender-followup/run/[runId]/process-chunk/route.ts`

This processes the next slice of the worklist: metadata → drop ignored → deterministic match → for matched, full + extract (cached). It writes matched extractions into `lender_message_cache` and queued metadata into the run's `counts`. The review queue is reconstructed at GET time from worklist∖(cached matched)∖ignored — but to keep GET cheap we persist a `queued_ids` list on the run. We store queued ids in `summary.queued_ids`.

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getMetadata, getFull } from "@/lib/google/gmail";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";
import { matchLender } from "@/lib/lender/match";
import { filterIgnored } from "@/lib/lender/ignore";
import { parseExtraction } from "@/lib/lender/extract";
import { buildExtractPrompt } from "@/lib/lender/prompts";
import { geminiJson } from "@/lib/gemini/client";
import { aggregateTracker, computeCounts } from "@/lib/lender/aggregate";
import { appendLenderActivity } from "@/lib/lender/activity";
import type { Lender, EmailMeta, Extraction } from "@/lib/lender/types";

const CHUNK = 25;       // ids per invocation
const CONCURRENCY = 6;  // simultaneous Gmail/Gemini ops

type DB = ReturnType<typeof createAdminClient>;

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId, userId } = await requireFinance();
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const worklist: string[] = Array.isArray(run.worklist) ? run.worklist : [];
  const cursor: number = run.cursor ?? 0;
  if (cursor >= worklist.length) return finalize(db, runId, departmentId);

  const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);

  // Load active lenders + ignore set.
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = (lendersData ?? []) as Lender[];
  const { data: ignoredData } = await db
    .from("lender_ignored_senders")
    .select("email")
    .eq("department_id", departmentId);
  const ignored = new Set((ignoredData ?? []).map((r) => (r.email as string).toLowerCase()));

  const slice = worklist.slice(cursor, cursor + CHUNK);

  // 1. metadata
  const metas: EmailMeta[] = await mapWithConcurrency(slice, CONCURRENCY, (id) =>
    withRetry(() => getMetadata(accessToken, id)),
  );

  // 2. drop ignored, deterministic match
  const kept = filterIgnored(metas, ignored);
  const matched = kept.map((m) => ({ meta: m, lenderId: matchLender(m.fromEmail, lenders) }));
  const toExtract = matched.filter((x) => x.lenderId);
  const queued = matched.filter((x) => !x.lenderId).map((x) => x.meta.id);

  // 3. full + extract for matched, skipping already-cached message ids
  const cachedIds = await alreadyCached(db, departmentId, toExtract.map((x) => x.meta.id));
  const fresh = toExtract.filter((x) => !cachedIds.has(x.meta.id));
  await mapWithConcurrency(fresh, CONCURRENCY, async ({ meta, lenderId }) => {
    const full = await withRetry(() => getFull(accessToken, meta.id));
    const lenderName = lenders.find((l) => l.id === lenderId)?.name ?? "lender";
    const prompt = buildExtractPrompt(lenderName, [{ id: meta.id, date: full.date, body: full.bodyText.slice(0, 12000) }]);
    const text = await withRetry(() => geminiJson(prompt));
    const extraction = parseExtraction(text, meta.id);
    await db.from("lender_message_cache").upsert(
      {
        department_id: departmentId,
        message_id: meta.id,
        lender_id: lenderId,
        thread_id: meta.threadId,
        from_email: meta.fromEmail,
        subject: meta.subject,
        internal_date: meta.internalDate,
        snippet: meta.snippet,
        extraction,
      },
      { onConflict: "department_id,message_id" },
    );
  });

  // 4. advance cursor + accumulate queued ids/counts
  const prevQueued: string[] = Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : [];
  const queuedIds = [...prevQueued, ...queued];
  const newCursor = cursor + slice.length;
  const counts = {
    ...(run.counts ?? {}),
    matched: (run.counts?.matched ?? 0) + toExtract.length,
    queued: queuedIds.length,
  };
  await db
    .from("lender_runs")
    .update({ cursor: newCursor, counts, summary: { ...(run.summary ?? {}), queued_ids: queuedIds } })
    .eq("id", runId);

  if (newCursor >= worklist.length) return finalize(db, runId, departmentId);
  return NextResponse.json({ processed: newCursor, total: worklist.length, matched: counts.matched, queued: counts.queued, done: false });
}

async function alreadyCached(db: DB, departmentId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await db
    .from("lender_message_cache")
    .select("message_id")
    .eq("department_id", departmentId)
    .in("message_id", ids);
  return new Set((data ?? []).map((r) => r.message_id as string));
}

async function finalize(db: DB, runId: string, departmentId: string) {
  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  const queuedIds: string[] = Array.isArray(run?.summary?.queued_ids) ? run!.summary.queued_ids : [];

  // Build tracker from all cached matched messages referenced by this run's matched set.
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = (lendersData ?? []) as Lender[];
  const worklist: string[] = Array.isArray(run?.worklist) ? run!.worklist : [];
  const { data: cacheRows } = await db
    .from("lender_message_cache")
    .select("message_id, lender_id, extraction")
    .eq("department_id", departmentId)
    .in("message_id", worklist.length ? worklist : ["__none__"]);

  const byMessage = (cacheRows ?? [])
    .filter((r) => r.lender_id)
    .map((r) => ({ lenderId: r.lender_id as string, extraction: (r.extraction ?? { items: [], last_contact_date: null }) as Extraction }));
  const tracker = aggregateTracker(lenders, byMessage);
  const counts = computeCounts(tracker, {
    unreadTotal: run?.counts?.unread_total ?? worklist.length,
    matched: run?.counts?.matched ?? byMessage.length,
    queued: queuedIds.length,
  });

  // Snapshot run items.
  await db.from("lender_run_items").delete().eq("run_id", runId);
  const items = tracker.flatMap((t) =>
    t.items.map((it) => ({
      run_id: runId,
      lender_id: t.lender_id,
      lender_name: t.lender_name,
      owner: t.owner,
      item: it.item,
      status: it.status,
      last_update_date: it.last_update_date,
      direction: it.direction,
      source_message_id: it.source_message_id,
      thread_id: null,
    })),
  );
  if (items.length) await db.from("lender_run_items").insert(items);

  await db
    .from("lender_runs")
    .update({ status: "done", counts, summary: { ...(run?.summary ?? {}), queued_ids: queuedIds } })
    .eq("id", runId);
  await appendLenderActivity(db, runId, `Done — ${counts.matched} matched, ${counts.open_items} open items across ${counts.lenders_with_items} lenders, ${counts.queued} queued for review`);

  return NextResponse.json({ processed: worklist.length, total: worklist.length, matched: counts.matched, queued: counts.queued, done: true });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route compiles.

- [ ] **Step 3: Commit**

```bash
git add app/api/tools/lender-followup/run/[runId]/process-chunk/route.ts
git commit -m "feat(lender): chunked process pipeline (match→extract, cached)"
```

---

## Task 17: GET run (tracker + queue) + message content route

**Files:**
- Create: `app/api/tools/lender-followup/run/[runId]/route.ts`
- Create: `app/api/tools/lender-followup/message/[messageId]/route.ts`

- [ ] **Step 1: Implement GET run**

```ts
// app/api/tools/lender-followup/run/[runId]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { aggregateTracker } from "@/lib/lender/aggregate";
import type { Lender, Extraction } from "@/lib/lender/types";

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireFinance();
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const worklist: string[] = Array.isArray(run.worklist) ? run.worklist : [];
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = (lendersData ?? []) as Lender[];

  const { data: cacheRows } = await db
    .from("lender_message_cache")
    .select("message_id, lender_id, extraction")
    .eq("department_id", departmentId)
    .in("message_id", worklist.length ? worklist : ["__none__"]);
  const byMessage = (cacheRows ?? [])
    .filter((r) => r.lender_id)
    .map((r) => ({ lenderId: r.lender_id as string, extraction: (r.extraction ?? { items: [], last_contact_date: null }) as Extraction }));
  const tracker = aggregateTracker(lenders, byMessage);

  // Review queue = queued metadata (fetch lightweight rows from cache if present, else just ids).
  const queuedIds: string[] = Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : [];
  const { data: queueMeta } = await db
    .from("lender_message_cache")
    .select("message_id, from_email, subject, snippet, internal_date")
    .eq("department_id", departmentId)
    .in("message_id", queuedIds.length ? queuedIds : ["__none__"]);

  return NextResponse.json({ run, tracker, queue: { ids: queuedIds, meta: queueMeta ?? [] } });
}
```

Note: queued emails are not in `lender_message_cache` (only matched ones are cached). The queue panel shows ids + whatever metadata the client already holds; the assign flow re-fetches metadata as needed. To give the queue useful metadata, the process-chunk route also upserts a metadata-only cache row for queued emails. Add this to Task 16's queued handling:

- [ ] **Step 2: Add queued metadata caching to process-chunk**

In `app/api/tools/lender-followup/run/[runId]/process-chunk/route.ts`, after computing `queued`, before advancing the cursor, insert:

```ts
  // Cache queued senders' metadata (no extraction, no lender) so the review queue has context.
  const queuedMetas = matched.filter((x) => !x.lenderId).map((x) => x.meta);
  if (queuedMetas.length) {
    await db.from("lender_message_cache").upsert(
      queuedMetas.map((m) => ({
        department_id: departmentId,
        message_id: m.id,
        lender_id: null,
        thread_id: m.threadId,
        from_email: m.fromEmail,
        subject: m.subject,
        internal_date: m.internalDate,
        snippet: m.snippet,
        extraction: null,
      })),
      { onConflict: "department_id,message_id" },
    );
  }
```

- [ ] **Step 3: Implement the message content route (read-only)**

```ts
// app/api/tools/lender-followup/message/[messageId]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getFull } from "@/lib/google/gmail";

export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const { departmentId, userId } = await requireFinance();
  const db = createAdminClient();

  // Only serve content for a message this department has already seen (matched or queued).
  const { data: row } = await db
    .from("lender_message_cache")
    .select("message_id, subject, from_email, extraction")
    .eq("department_id", departmentId)
    .eq("message_id", messageId)
    .single();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);
  const full = await getFull(accessToken, messageId); // readonly — never changes read-state
  return NextResponse.json({
    id: full.id,
    subject: full.subject,
    from: full.from,
    date: full.date,
    bodyText: full.bodyText,
    extraction: row.extraction ?? null,
  });
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: routes compile.

- [ ] **Step 5: Commit**

```bash
git add app/api/tools/lender-followup/run/[runId]/route.ts app/api/tools/lender-followup/message/[messageId]/route.ts app/api/tools/lender-followup/run/[runId]/process-chunk/route.ts
git commit -m "feat(lender): GET run tracker+queue, cached queue metadata, read-only message content"
```

---

## Task 18: Classify-queue route (on-demand AI)

**Files:**
- Create: `app/api/tools/lender-followup/run/[runId]/classify-queue/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getFull } from "@/lib/google/gmail";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";
import { buildClassifyPrompt, buildExtractPrompt } from "@/lib/lender/prompts";
import { parseClassification } from "@/lib/lender/classify";
import { parseExtraction } from "@/lib/lender/extract";
import { geminiJson } from "@/lib/gemini/client";
import { appendLenderActivity } from "@/lib/lender/activity";
import type { Lender } from "@/lib/lender/types";

const BATCH = 50;            // queued emails classified per click
const CONCURRENCY = 5;
const THRESHOLD = Number(process.env.LENDER_CLASSIFY_THRESHOLD ?? "0.75");

export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId, userId } = await requireFinance();
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const queuedIds: string[] = Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : [];
  if (!queuedIds.length) return NextResponse.json({ classified: 0, matched: run.counts?.matched ?? 0, queued: 0 });

  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = ((lendersData ?? []) as Lender[]).filter((l) => l.active);
  const lenderList = lenders.map((l) => ({ id: l.id, name: l.name }));

  const batch = queuedIds.slice(0, BATCH);
  const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);

  // Classify each queued email on subject+snippet from its cached metadata row.
  const { data: metaRows } = await db
    .from("lender_message_cache")
    .select("message_id, subject, snippet")
    .eq("department_id", departmentId)
    .in("message_id", batch);
  const metaById = new Map((metaRows ?? []).map((r) => [r.message_id as string, r]));

  const newlyMatched: string[] = [];
  await mapWithConcurrency(batch, CONCURRENCY, async (id) => {
    const meta = metaById.get(id);
    if (!meta) return;
    const prompt = buildClassifyPrompt(lenderList, { subject: (meta.subject as string) ?? "", snippet: (meta.snippet as string) ?? "" });
    const text = await withRetry(() => geminiJson(prompt));
    const { lenderId } = parseClassification(text, THRESHOLD);
    if (!lenderId || !lenders.some((l) => l.id === lenderId)) return;

    // Promote: fetch full + extract, write cache row as matched.
    const full = await withRetry(() => getFull(accessToken, id));
    const lenderName = lenders.find((l) => l.id === lenderId)?.name ?? "lender";
    const ePrompt = buildExtractPrompt(lenderName, [{ id, date: full.date, body: full.bodyText.slice(0, 12000) }]);
    const eText = await withRetry(() => geminiJson(ePrompt));
    const extraction = parseExtraction(eText, id);
    await db.from("lender_message_cache").upsert(
      {
        department_id: departmentId,
        message_id: id,
        lender_id: lenderId,
        thread_id: full.threadId,
        from_email: "", // unchanged; metadata already cached
        subject: full.subject,
        internal_date: full.internalDate,
        snippet: meta.snippet as string,
        extraction,
      },
      { onConflict: "department_id,message_id" },
    );
    newlyMatched.push(id);
  });

  const remaining = queuedIds.filter((id) => !newlyMatched.includes(id));
  const counts = {
    ...(run.counts ?? {}),
    matched: (run.counts?.matched ?? 0) + newlyMatched.length,
    queued: remaining.length,
  };
  await db
    .from("lender_runs")
    .update({ counts, summary: { ...(run.summary ?? {}), queued_ids: remaining } })
    .eq("id", runId);
  await appendLenderActivity(db, runId, `AI classified ${batch.length} queued — matched ${newlyMatched.length}`);

  return NextResponse.json({ classified: batch.length, matched: counts.matched, queued: counts.queued });
}
```

Note: this does not re-snapshot `lender_run_items` (those are finalized at run end / refreshed by a re-run). The GET endpoint recomputes the live tracker from the cache, so newly matched items appear immediately in the UI.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route compiles.

- [ ] **Step 3: Commit**

```bash
git add app/api/tools/lender-followup/run/[runId]/classify-queue/route.ts
git commit -m "feat(lender): on-demand AI classify of review queue (capped + throttled)"
```

---

## Task 19: Assign / ignore route (the learning step)

**Files:**
- Create: `app/api/tools/lender-followup/run/[runId]/assign/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getFull } from "@/lib/google/gmail";
import { withRetry } from "@/lib/scrap-scale/queue";
import { buildExtractPrompt } from "@/lib/lender/prompts";
import { parseExtraction } from "@/lib/lender/extract";
import { geminiJson } from "@/lib/gemini/client";
import { appendLenderActivity } from "@/lib/lender/activity";
import type { Lender } from "@/lib/lender/types";

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId, userId, email } = await requireFinance();
  const body = await req.json();
  const messageId: string = body?.messageId;
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = createAdminClient();
  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const { data: metaRow } = await db
    .from("lender_message_cache")
    .select("message_id, from_email, subject, snippet, thread_id, internal_date")
    .eq("department_id", departmentId)
    .eq("message_id", messageId)
    .single();
  if (!metaRow) return NextResponse.json({ error: "message not found" }, { status: 404 });
  const fromEmail = (metaRow.from_email as string)?.toLowerCase() ?? "";

  // IGNORE: add sender to ignore list, drop from queue.
  if (body.action === "ignore") {
    if (fromEmail) {
      await db.from("lender_ignored_senders").upsert(
        { department_id: departmentId, email: fromEmail, created_by_email: email },
        { onConflict: "department_id,email" },
      );
    }
    const remaining = (Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : []).filter((id: string) => id !== messageId);
    await db.from("lender_runs").update({
      summary: { ...(run.summary ?? {}), queued_ids: remaining },
      counts: { ...(run.counts ?? {}), queued: remaining.length },
    }).eq("id", runId);
    await appendLenderActivity(db, runId, `Marked ${fromEmail || messageId} as not-a-lender (ignored)`);
    return NextResponse.json({ ignored: messageId, queued: remaining.length });
  }

  // ASSIGN: learn the sender, extract, promote to matched.
  const lenderId: string = body.lenderId;
  if (!lenderId) return NextResponse.json({ error: "lenderId required" }, { status: 400 });
  const { data: lender } = await db
    .from("lenders")
    .select("*")
    .eq("id", lenderId)
    .eq("department_id", departmentId)
    .single<Lender>();
  if (!lender) return NextResponse.json({ error: "lender not found" }, { status: 404 });

  // Learning: append sender to known_sender_emails (dedup).
  if (fromEmail && !lender.known_sender_emails.map((e) => e.toLowerCase()).includes(fromEmail)) {
    await db.from("lenders").update({ known_sender_emails: [...lender.known_sender_emails, fromEmail] }).eq("id", lenderId);
  }

  const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);
  const full = await withRetry(() => getFull(accessToken, messageId));
  const prompt = buildExtractPrompt(lender.name, [{ id: messageId, date: full.date, body: full.bodyText.slice(0, 12000) }]);
  const text = await withRetry(() => geminiJson(prompt));
  const extraction = parseExtraction(text, messageId);
  await db.from("lender_message_cache").upsert(
    {
      department_id: departmentId,
      message_id: messageId,
      lender_id: lenderId,
      thread_id: full.threadId,
      from_email: fromEmail,
      subject: full.subject,
      internal_date: full.internalDate,
      snippet: metaRow.snippet as string,
      extraction,
    },
    { onConflict: "department_id,message_id" },
  );

  const remaining = (Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : []).filter((id: string) => id !== messageId);
  await db.from("lender_runs").update({
    summary: { ...(run.summary ?? {}), queued_ids: remaining },
    counts: { ...(run.counts ?? {}), matched: (run.counts?.matched ?? 0) + 1, queued: remaining.length },
  }).eq("id", runId);
  await appendLenderActivity(db, runId, `Assigned ${fromEmail || messageId} → ${lender.name} (learned sender)`);

  return NextResponse.json({ assigned: messageId, lenderId, queued: remaining.length });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route compiles.

- [ ] **Step 3: Commit**

```bash
git add app/api/tools/lender-followup/run/[runId]/assign/route.ts
git commit -m "feat(lender): assign (learns sender) / ignore (suppresses sender)"
```

---

## Task 20: Export route

**Files:**
- Create: `app/api/tools/lender-followup/run/[runId]/export/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { EXPORT_HEADERS, trackerToRows, rowsToCsv } from "@/lib/lender/exportRows";
import { aggregateTracker } from "@/lib/lender/aggregate";
import type { Lender, Extraction } from "@/lib/lender/types";
import { appendLenderActivity } from "@/lib/lender/activity";

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireFinance();
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("worklist").eq("id", runId).single();
  const worklist: string[] = Array.isArray(run?.worklist) ? run!.worklist : [];
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = (lendersData ?? []) as Lender[];
  const { data: cacheRows } = await db
    .from("lender_message_cache")
    .select("lender_id, extraction")
    .eq("department_id", departmentId)
    .in("message_id", worklist.length ? worklist : ["__none__"]);
  const byMessage = (cacheRows ?? [])
    .filter((r) => r.lender_id)
    .map((r) => ({ lenderId: r.lender_id as string, extraction: (r.extraction ?? { items: [], last_contact_date: null }) as Extraction }));
  const tracker = aggregateTracker(lenders, byMessage);
  const rows = trackerToRows(tracker);

  await appendLenderActivity(db, runId, `Exported ${format.toUpperCase()} (${rows.length} items)`);

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Lender Pendencies");
    ws.addRow(EXPORT_HEADERS);
    rows.forEach((r) => ws.addRow(r));
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="lender-pendencies-${runId}.xlsx"`,
      },
    });
  }

  const csv = rowsToCsv(EXPORT_HEADERS, rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lender-pendencies-${runId}.csv"`,
    },
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route compiles.

- [ ] **Step 3: Commit**

```bash
git add app/api/tools/lender-followup/run/[runId]/export/route.ts
git commit -m "feat(lender): CSV/Excel export of the tracker"
```

---

## Task 21: Registry + seed lenders

**Files:**
- Modify: `lib/tools/registry.ts`
- Modify: `supabase/seed.mjs`

- [ ] **Step 1: Register the tool**

In `lib/tools/registry.ts`, add a second entry to the `TOOLS` array:

```ts
  {
    slug: "lender-followup",
    name: "Lender Follow-up Tracker",
    description: "Track open pending items per lender from unread Gmail (read-only).",
    departmentSlug: "finance",
    icon: "Landmark",
    route: "/finance/lender-followup",
    requiredRole: "member",
  },
```

- [ ] **Step 2: Seed the 9 lenders**

In `supabase/seed.mjs`, after the departments upsert in `main()`, add:

```js
  const { data: finance } = await admin.from("departments").select("id").eq("slug", "finance").single();
  if (finance) {
    const LENDERS = [
      "Aditya Birla Capital Ltd",
      "Axis Bank Limited (Commercial)",
      "Bank of Maharashtra",
      "Bank of Baroda",
      "Cholamandalam Finance",
      "CSB Bank Limited",
      "Cosmos Co-operative Bank Ltd",
      "DNSB Sahakari Bank Ltd",
      "Federal Bank Limited",
    ].map((name) => ({ department_id: finance.id, name }));
    const { error: lendErr } = await admin
      .from("lenders")
      .upsert(LENDERS, { onConflict: "department_id,name" });
    if (lendErr) throw lendErr;
    console.log(`Upserted ${LENDERS.length} lenders into Finance.`);
  }
```

- [ ] **Step 3: Run the seed**

Run: `node --env-file=.env.local supabase/seed.mjs`
Expected: `Upserted 5 departments.` then `Upserted 9 lenders into Finance.`

- [ ] **Step 4: Commit**

```bash
git add lib/tools/registry.ts supabase/seed.mjs
git commit -m "feat(lender): register tool under Finance + seed 9 lenders"
```

---

## Task 22: UI — LenderManager component

**Files:**
- Create: `components/lender/LenderManager.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { useState } from "react";
import type { Lender } from "@/lib/lender/types";

const csv = (a: string[]) => a.join(", ");
const toArr = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function LenderManager({ initial, canManage }: { initial: Lender[]; canManage: boolean }) {
  const [lenders, setLenders] = useState<Lender[]>(initial);
  const [draft, setDraft] = useState({ name: "", owner: "", sender_domains: "", known_sender_emails: "", aliases: "" });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!draft.name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/tools/lender-followup/lenders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        owner: draft.owner || null,
        sender_domains: toArr(draft.sender_domains),
        known_sender_emails: toArr(draft.known_sender_emails),
        aliases: toArr(draft.aliases),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const { lender } = await res.json();
      setLenders((l) => [...l, lender].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft({ name: "", owner: "", sender_domains: "", known_sender_emails: "", aliases: "" });
    }
  }

  async function save(id: string, patch: Partial<Lender> & { sender_domains?: string[]; known_sender_emails?: string[] }) {
    const res = await fetch(`/api/tools/lender-followup/lenders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const { lender } = await res.json();
      setLenders((l) => l.map((x) => (x.id === id ? lender : x)));
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this lender?")) return;
    const res = await fetch(`/api/tools/lender-followup/lenders/${id}`, { method: "DELETE" });
    if (res.ok) setLenders((l) => l.filter((x) => x.id !== id));
    else alert((await res.json().catch(() => ({}))).error ?? "Delete failed");
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-cal">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-ink-tertiary">
              <th className="px-3 py-2">Lender</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Sender domains</th>
              <th className="px-3 py-2">Known senders</th>
              <th className="px-3 py-2">Active</th>
              {canManage && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {lenders.map((l) => (
              <tr key={l.id} className="border-t border-line-light align-top">
                <td className="px-3 py-2 text-ink">{l.name}</td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={l.owner ?? ""}
                    onBlur={(e) => e.target.value !== (l.owner ?? "") && save(l.id, { owner: e.target.value || null })}
                    className="w-24 rounded border border-line px-2 py-1 text-gray-900"
                    placeholder="owner"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={csv(l.sender_domains)}
                    onBlur={(e) => save(l.id, { sender_domains: toArr(e.target.value) })}
                    className="w-56 rounded border border-line px-2 py-1 text-gray-900"
                    placeholder="axisbank.com, ..."
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={csv(l.known_sender_emails)}
                    onBlur={(e) => save(l.id, { known_sender_emails: toArr(e.target.value) })}
                    className="w-56 rounded border border-line px-2 py-1 text-gray-900"
                    placeholder="alerts@axisbank.com, ..."
                  />
                </td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={l.active} onChange={(e) => save(l.id, { active: e.target.checked })} />
                </td>
                {canManage && (
                  <td className="px-3 py-2">
                    <button onClick={() => remove(l.id)} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-cal">
        <h3 className="mb-2 text-sm font-medium text-ink">Add lender</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" className="rounded border border-line px-2 py-1 text-gray-900" />
          <input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} placeholder="Owner" className="rounded border border-line px-2 py-1 text-gray-900" />
          <input value={draft.sender_domains} onChange={(e) => setDraft({ ...draft, sender_domains: e.target.value })} placeholder="domains (comma)" className="rounded border border-line px-2 py-1 text-gray-900" />
          <input value={draft.known_sender_emails} onChange={(e) => setDraft({ ...draft, known_sender_emails: e.target.value })} placeholder="known senders (comma)" className="rounded border border-line px-2 py-1 text-gray-900" />
          <button onClick={add} disabled={busy || !draft.name.trim()} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/lender/LenderManager.tsx
git commit -m "feat(lender): LenderManager CRUD UI"
```

---

## Task 23: UI — LenderFollowupApp (run + tracker + queue)

**Files:**
- Create: `components/lender/LenderFollowupApp.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { useState } from "react";
import { SignOutButton } from "@clerk/nextjs";
import type { Lender, TrackerLender, RunCounts } from "@/lib/lender/types";

type QueueMeta = { message_id: string; from_email: string; subject: string; snippet: string };
type RunData = {
  run: { id: string; status: string; counts: RunCounts };
  tracker: TrackerLender[];
  queue: { ids: string[]; meta: QueueMeta[] };
};

const PRIVACY =
  "Only emails matched to a lender have their full content fetched and sent to Gemini. All other unread mail is read as metadata only (sender, subject, date) and is never sent anywhere. Email is never marked read.";

export function LenderFollowupApp({
  connected,
  connectedEmail,
  lenders,
}: {
  connected: boolean;
  connectedEmail: string | null;
  lenders: Lender[];
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [data, setData] = useState<RunData | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; matched: number; queued: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const owners = [...new Set(lenders.map((l) => l.owner).filter(Boolean))] as string[];

  async function refresh(id: string) {
    const res = await fetch(`/api/tools/lender-followup/run/${id}`);
    if (res.ok) setData(await res.json());
  }

  async function run() {
    setError(null);
    setBusy(true);
    setData(null);
    const res = await fetch("/api/tools/lender-followup/run", { method: "POST" });
    if (res.status === 409) {
      setBusy(false);
      setError("Gmail access missing — sign out and sign in again to grant gmail.readonly.");
      return;
    }
    if (!res.ok) {
      setBusy(false);
      setError((await res.json().catch(() => ({}))).error ?? "Run failed");
      return;
    }
    const { runId: id, total } = await res.json();
    setRunId(id);
    setProgress({ processed: 0, total, matched: 0, queued: 0 });
    let done = false;
    while (!done) {
      const cr = await fetch(`/api/tools/lender-followup/run/${id}/process-chunk`, { method: "POST" });
      if (!cr.ok) { setError("Processing error"); break; }
      const p = await cr.json();
      setProgress({ processed: p.processed, total: p.total, matched: p.matched, queued: p.queued });
      done = p.done;
    }
    await refresh(id);
    setBusy(false);
  }

  async function classifyQueue() {
    if (!runId) return;
    setBusy(true);
    const res = await fetch(`/api/tools/lender-followup/run/${runId}/classify-queue`, { method: "POST" });
    setBusy(false);
    if (res.ok) await refresh(runId);
  }

  async function assign(messageId: string, lenderId: string) {
    if (!runId) return;
    await fetch(`/api/tools/lender-followup/run/${runId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, lenderId }),
    });
    await refresh(runId);
  }

  async function ignore(messageId: string) {
    if (!runId) return;
    await fetch(`/api/tools/lender-followup/run/${runId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, action: "ignore" }),
    });
    await refresh(runId);
  }

  if (!connected) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-cal">
        <p className="mb-1 text-sm text-gray-700">Gmail (read-only) access isn&apos;t granted yet.</p>
        <p className="mb-4 text-sm text-gray-600">
          Sign out and sign back in with Google — the sign-in asks for read-only Gmail permission. Email is never marked read.
        </p>
        <SignOutButton>
          <button className="inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white">Sign out &amp; sign back in</button>
        </SignOutButton>
      </div>
    );
  }

  const tracker = (data?.tracker ?? []).filter((t) => !ownerFilter || t.owner === ownerFilter);

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-line-light bg-surface-secondary/50 px-3 py-2 text-xs text-ink-tertiary">{PRIVACY}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-500">Using Gmail access for {connectedEmail ?? "your account"}</span>
        <button onClick={run} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Running…" : "Run"}
        </button>
        {progress && (
          <span className="text-sm text-gray-600">
            {progress.processed}/{progress.total} scanned · {progress.matched} matched · {progress.queued} queued
          </span>
        )}
      </div>
      {progress && progress.total > 0 && (
        <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Lenders with items: <b>{data.run.counts.lenders_with_items}</b></span>
            <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Open items: <b>{data.run.counts.open_items}</b></span>
            <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Matched: <b>{data.run.counts.matched}</b></span>
            <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">In review queue: <b>{data.run.counts.queued}</b></span>
            <div className="ml-auto flex items-center gap-2">
              {owners.length > 0 && (
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="rounded border border-line px-2 py-1 text-sm text-gray-900">
                  <option value="">All owners</option>
                  {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              <a href={`/api/tools/lender-followup/run/${data.run.id}/export?format=csv`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-secondary">CSV</a>
              <a href={`/api/tools/lender-followup/run/${data.run.id}/export?format=xlsx`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-secondary">Excel</a>
            </div>
          </div>

          {/* Tracker */}
          <div className="space-y-4">
            {tracker.map((t) => (
              <div key={t.lender_id ?? t.lender_name} className="rounded-2xl border border-line bg-surface p-4 shadow-cal">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-medium text-ink">{t.lender_name}</h3>
                  <span className="text-xs text-ink-tertiary">{t.owner ?? "—"} · {t.items.length} open</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {t.items.map((it, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 border-t border-line-light py-1">
                      <span className="text-ink">{it.item}</span>
                      <span className="rounded bg-surface-secondary px-2 py-0.5 text-xs text-ink-secondary">{it.status}</span>
                      <span className="text-xs text-ink-tertiary">{it.last_update_date ?? ""}</span>
                      <span className="text-xs text-ink-tertiary">[{it.direction}]</span>
                      <a href={`/api/tools/lender-followup/message/${it.source_message_id}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-brand hover:underline">view email</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {tracker.length === 0 && <p className="text-sm text-ink-tertiary">No lender pendencies yet.</p>}
          </div>

          {/* Review queue */}
          {data.queue.ids.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-cal">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium text-ink">Needs assignment ({data.queue.ids.length})</h3>
                <button onClick={classifyQueue} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-secondary disabled:opacity-50">
                  Classify queue (AI)
                </button>
              </div>
              <ul className="space-y-2 text-sm">
                {data.queue.meta.map((m) => (
                  <li key={m.message_id} className="flex flex-wrap items-center gap-2 border-t border-line-light py-2">
                    <span className="text-ink-secondary">{m.from_email}</span>
                    <span className="text-ink">{m.subject}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <select
                        defaultValue=""
                        onChange={(e) => e.target.value && assign(m.message_id, e.target.value)}
                        className="rounded border border-line px-2 py-1 text-xs text-gray-900"
                      >
                        <option value="">Assign to…</option>
                        {lenders.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                      <button onClick={() => ignore(m.message_id)} className="rounded border border-line px-2 py-1 text-xs text-ink-tertiary hover:bg-surface-secondary">
                        Not a lender
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/lender/LenderFollowupApp.tsx
git commit -m "feat(lender): main app — run, live progress, tracker, review queue, export"
```

---

## Task 24: UI — RunHistory + page wiring

**Files:**
- Create: `components/lender/LenderRunHistory.tsx`
- Create: `app/(app)/finance/lender-followup/page.tsx`

- [ ] **Step 1: Implement the history list**

```tsx
"use client";

type Run = {
  id: string;
  created_at: string;
  created_by_email: string | null;
  status: string;
  counts: { matched?: number; open_items?: number; lenders_with_items?: number; queued?: number } | null;
};

export function LenderRunHistory({ runs }: { runs: Run[] }) {
  if (!runs.length) return null;
  return (
    <div>
      <h2 className="mb-3 text-lg font-medium text-ink">Run history</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-cal">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-ink-tertiary">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Run by</th>
              <th className="px-3 py-2">Matched</th>
              <th className="px-3 py-2">Open items</th>
              <th className="px-3 py-2">Lenders</th>
              <th className="px-3 py-2">Queued</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-line-light">
                <td className="px-3 py-2 text-ink">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.created_by_email ?? "—"}</td>
                <td className="px-3 py-2 text-ink">{r.counts?.matched ?? "—"}</td>
                <td className="px-3 py-2 text-ink">{r.counts?.open_items ?? "—"}</td>
                <td className="px-3 py-2 text-ink">{r.counts?.lenders_with_items ?? "—"}</td>
                <td className="px-3 py-2 text-ink">{r.counts?.queued ?? "—"}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the page (tabs via client wrapper)**

```tsx
// app/(app)/finance/lender-followup/page.tsx
import { requireDepartmentAccess } from "@/lib/auth/guards";
import { getConnection } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { createAdminClient } from "@/utils/supabase/admin";
import { LenderFollowupPageClient } from "@/components/lender/LenderFollowupPageClient";
import type { Lender } from "@/lib/lender/types";

export default async function LenderFollowupPage() {
  const { user, department, role } = await requireDepartmentAccess("finance");
  const canManage = role === "admin" || role === "super";
  const conn = await getConnection(user.id, LENDER_FOLLOWUP_SCOPES);
  const db = createAdminClient();
  const { data: lenders } = await db.from("lenders").select("*").eq("department_id", department.id).order("name");
  const { data: runs } = await db
    .from("lender_runs")
    .select("id, created_at, created_by_email, status, counts")
    .eq("department_id", department.id)
    .order("created_at", { ascending: false })
    .limit(25);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">Lender Follow-up Tracker</h1>
        <p className="mb-6 text-sm text-gray-500">Open pending items per lender, from unread Gmail (read-only).</p>
      </div>
      <LenderFollowupPageClient
        connected={!!conn}
        connectedEmail={conn?.google_email ?? null}
        lenders={(lenders ?? []) as Lender[]}
        runs={runs ?? []}
        canManage={canManage}
      />
    </div>
  );
}
```

- [ ] **Step 3: Implement the tabs client wrapper**

```tsx
// components/lender/LenderFollowupPageClient.tsx
"use client";
import { useState } from "react";
import { LenderFollowupApp } from "./LenderFollowupApp";
import { LenderManager } from "./LenderManager";
import { LenderRunHistory } from "./LenderRunHistory";
import type { Lender } from "@/lib/lender/types";

type Run = { id: string; created_at: string; created_by_email: string | null; status: string; counts: { matched?: number; open_items?: number; lenders_with_items?: number; queued?: number } | null };

export function LenderFollowupPageClient({
  connected, connectedEmail, lenders, runs, canManage,
}: {
  connected: boolean; connectedEmail: string | null; lenders: Lender[]; runs: Run[]; canManage: boolean;
}) {
  const [tab, setTab] = useState<"tracker" | "lenders">("tracker");
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg bg-surface-secondary p-0.5 text-sm">
        {(["tracker", "lenders"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 transition-colors ${tab === t ? "bg-surface font-medium text-ink shadow-cal-sm" : "text-ink-tertiary hover:text-ink-secondary"}`}
          >
            {t === "tracker" ? "Tracker" : "Manage lenders"}
          </button>
        ))}
      </div>
      {tab === "tracker" ? (
        <>
          <LenderFollowupApp connected={connected} connectedEmail={connectedEmail} lenders={lenders} />
          <LenderRunHistory runs={runs} />
        </>
      ) : (
        <LenderManager initial={lenders} canManage={canManage} />
      )}
    </div>
  );
}
```

Update Task 24 file list to include `components/lender/LenderFollowupPageClient.tsx` (Create).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: `/finance/lender-followup` appears in the route list; build clean.

- [ ] **Step 5: Commit**

```bash
git add components/lender/LenderRunHistory.tsx components/lender/LenderFollowupPageClient.tsx "app/(app)/finance/lender-followup/page.tsx"
git commit -m "feat(lender): finance page, tabs wrapper, run history"
```

---

## Task 25: Docs + env + final verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Ensure env vars are documented**

Confirm `.env.example` contains (add any missing):

```
GEMINI_API_KEY=
GEMINI_API_KEY_2=
GEMINI_API_KEY_3=
GEMINI_MODEL=gemini-2.5-flash
LENDER_CLASSIFY_THRESHOLD=0.75
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=
```

- [ ] **Step 2: Add a README section**

Append to `README.md`:

```markdown
## Lender Follow-up Tracker (Finance)

Reads UNREAD Gmail and tracks open pending items per lender. **Emails are never marked read** —
the tool uses only the `https://www.googleapis.com/auth/gmail.readonly` scope.

**One-time setup:** add `gmail.readonly` to the Google connection in the Clerk dashboard, then sign
out and sign in again to re-consent. Run `node --env-file=.env.local supabase/apply-0006.mjs` and
`node --env-file=.env.local supabase/seed.mjs`.

**Matching (deterministic → AI → human):** each unread email is matched to a lender by sender domain
or known sender email. Confident misses can be classified on demand by Gemini (the "Classify queue"
button). Remaining emails go to a "Needs assignment" queue; assigning one **teaches** the matcher by
appending that sender to the lender's known senders, and "Not a lender" suppresses that sender from
future runs.

**Privacy:** only full content of matched-lender emails is fetched and sent to Gemini; all other
unread mail stays metadata-only.
```

- [ ] **Step 3: Full verification**

Run: `npm test`
Expected: all unit suites pass (existing + new lender/gmail/gemini suites).

Run: `npm run lint`
Expected: clean.

Run: `npm run build`
Expected: clean; `/finance/lender-followup` and the new API routes listed.

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "docs(lender): README usage + env for lender follow-up tracker"
```

---

## Runtime verification (after deploy / locally with real Google)

Per the `verify` skill, exercise the running app (these are NOT covered by unit tests):
1. Sign in with Google (after adding `gmail.readonly` in Clerk) → open `/finance/lender-followup` → Tracker tab shows "Run" (not the connect prompt).
2. Manage lenders → set `sender_domains` for 1–2 banks you actually receive mail from.
3. Run → watch the progress bar advance through the unread backlog → confirm matched lenders show pendency items and the queue shows unmatched senders.
4. Assign a queued email to a lender → confirm it leaves the queue, appears under that lender, and the sender now shows in that lender's known senders (Manage tab).
5. "Not a lender" on a queued email → re-run → confirm that sender no longer appears.
6. Export CSV and Excel → confirm rows match the on-screen tracker.
7. Confirm in Gmail that none of the read emails became marked read.

---

## Self-Review notes (addressed)

- **Spec coverage:** lenders CRUD (T14/T22), gmail.readonly + connect (T11/T12/T23), run pipeline + live progress + caching + throttling/rotation (T15/T16/T9), deterministic→AI→human matching (T16 deterministic, T18 AI, T19 human+learning), suppression (T19/T6), per-lender tracker + owner filter + counts + read-only email view (T17/T23), instances + run_items snapshot (T16 finalize/T1), export (T20/T8), registry + Finance placement + seed (T21), privacy banner (T23), env/README (T25). Deferred (compare, historyId incremental) explicitly out of scope per spec.
- **Type consistency:** `matchLender`, `parseExtraction(text, messageId)`, `parseClassification(text, threshold)`, `aggregateTracker(lenders, byMessage)`, `computeCounts(tracker, {unreadTotal,matched,queued})`, `EXPORT_HEADERS/trackerToRows/rowsToCsv`, `geminiJson`, gmail `listUnreadIds/getMetadata/getFull/parseMetadata/decodeBodyParts` are used consistently across routes.
- **Queue metadata:** matched-only caching would leave the review queue id-only; Task 17 Step 2 adds metadata-only cache rows for queued emails so the queue and assign/ignore/classify flows have sender/subject context (consistent with the privacy rule — metadata only, no body, no Gemini).
```
