# Everest v2: Clerk Auth + Per-User Google + Scrap Scale OCR/Filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth with Clerk (Google-only, domain-restricted), make Google Drive/Sheets access per-user, and finish Scrap Scale (Gemini key rotation, per-screenshot breakdown, Google-Sheets-style filters).

**Architecture:** Clerk for identity; all DB access via the Supabase service-role client with authorization enforced in server guards (`requireUser`/`requireDepartmentAccess`) against a `memberships` table keyed on the Clerk user id. Per-user Google OAuth (our existing module re-keyed department→user) stores each user's encrypted refresh token. Scrap Scale reads use the requesting user's token.

**Tech Stack:** Next.js 16 (App Router, proxy.ts), Clerk (`@clerk/nextjs`), Supabase Postgres (service-role only), Tailwind v4, Vitest, Gemini 2.5 Flash, Google Sheets/Drive REST.

**Spec:** `docs/superpowers/specs/2026-06-03-everest-clerk-auth-and-scrap-scale-v2-design.md`

---

## File map

**Part A — Clerk auth**
- Modify: `proxy.ts` (Supabase session → `clerkMiddleware()`)
- Modify: `app/layout.tsx` (wrap `<ClerkProvider>`)
- Create: `app/sign-in/[[...sign-in]]/page.tsx` (Clerk `<SignIn>`)
- Create: `app/not-allowed/page.tsx` (rejected domain)
- Rewrite: `lib/auth/guards.ts` (Clerk `auth()` + service-role + lazy provision)
- Modify: `lib/scrap-scale/access.ts` (unchanged signature; relies on new guards)
- Rewrite: `app/(app)/admin/actions.ts` (drop createUser; setMembership by Clerk id)
- Modify: `app/(app)/admin/page.tsx`, `app/(app)/layout.tsx`, `components/Sidebar.tsx`
- Delete: `app/account/actions.ts`, `app/sign-in/page.tsx` (old), Supabase session usage in `utils/supabase/server.ts`/`middleware.ts`
- Create: `supabase/migrations/0004_clerk_auth.sql`

**Part B — Per-user Google**
- Modify: `lib/google/connection.ts` (key by `clerkUserId`)
- Modify: `app/api/google/oauth/start/route.ts`, `app/api/google/oauth/callback/route.ts`
- Modify: all `app/api/tools/scrap-scale/**` routes (`getAccessToken(userId, …)`)
- Modify: `app/(app)/accounting/scrap-scale/page.tsx` (connection by user)

**Part C — Gemini rotation**
- Create: `lib/scrap-scale/gemini-keys.ts` + `__tests__/gemini-keys.test.ts`
- Modify: `lib/scrap-scale/ocr.ts` (`geminiExtract` rotates keys)

**Part D — Per-screenshot breakdown**
- Create: `lib/scrap-scale/breakdown.ts` + `__tests__/breakdown.test.ts`
- Modify: `app/api/tools/scrap-scale/run/[runId]/process-chunk/route.ts` (store `payments`)
- Modify: `components/scrap-scale/ResultsTable.tsx`
- Modify: `app/api/tools/scrap-scale/run/[runId]/write-back/route.ts`, `export/route.ts`

**Part E — Sheets-style filters**
- Rewrite: `lib/scrap-scale/filters.ts` + `__tests__/filters.test.ts`
- Create: `app/api/tools/scrap-scale/column-values/route.ts`
- Create: `components/scrap-scale/FilterPanel.tsx`
- Modify: `components/scrap-scale/ScrapScaleApp.tsx`, `app/api/tools/scrap-scale/run/route.ts`

---

## Prerequisites (USER actions — surface these when each part starts)

- **Part A:** Create a Clerk application; enable **Google** as the only social connection; in Clerk Dashboard → Restrictions, allowlist `everestfleet.in` and `everestfleet.com`. Add to `.env.local` + Vercel: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `SUPER_ADMIN_EMAILS=vansh.sood@everestfleet.in`, `ALLOWED_EMAIL_DOMAINS=everestfleet.in,everestfleet.com`.
- **Part C:** Add `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` to `.env.local` + Vercel.
- Confirm the Google OAuth consent screen is **Internal**.

---

## PART A — Clerk authentication

### Task A1: Install Clerk and verify its current API

**Files:** none yet (investigation + install).

- [ ] **Step 1: Install**

```bash
npm install @clerk/nextjs
```

- [ ] **Step 2: Verify the installed component/middleware API**

The pasted quickstart used `<Show when="signed-in">` and `clerkMiddleware()` in `proxy.ts`. Confirm against the installed package before writing UI:

```bash
node -e "const p=require('@clerk/nextjs/package.json'); console.log('version', p.version)"
grep -REl "export .*(SignedIn|Show|UserButton|ClerkProvider)" node_modules/@clerk/nextjs/dist 2>/dev/null | head
node -e "const c=require('@clerk/nextjs'); console.log(Object.keys(c).filter(k=>/Sign|Show|User|Clerk/.test(k)))"
```

Expected: prints the exported component names. **Use whatever the package actually exports** — if `Show` is absent, use `SignedIn`/`SignedOut`. Record the chosen names; later tasks reference "the auth components" — substitute the verified names.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @clerk/nextjs"
```

### Task A2: Database migration 0004 (Clerk ids, drop Supabase Auth)

**Files:** Create `supabase/migrations/0004_clerk_auth.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0004_clerk_auth.sql
-- Identity moves from Supabase Auth to Clerk. The app now accesses the DB only
-- via the service-role client; authorization is enforced in server guards.
-- RLS stays enabled as a backstop (service role bypasses it) but the
-- auth.uid()-based policies/helpers are removed (no Supabase session exists).
-- Test users/memberships are intentionally wiped and re-assigned after first login.

-- 1) Supabase-Auth trigger
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- 2) Old RLS policies + helpers (keyed on auth.uid())
drop policy if exists departments_select on public.departments;
drop policy if exists departments_write  on public.departments;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists memberships_select on public.memberships;
drop policy if exists memberships_write  on public.memberships;
drop policy if exists google_connections_rw on public.google_connections;
drop policy if exists ocr_cache_rw on public.ocr_cache;
drop policy if exists runs_rw on public.scrap_scale_runs;
drop policy if exists run_rows_rw on public.scrap_scale_run_rows;
drop function if exists public.is_super_admin(uuid);
drop function if exists public.is_member_of(uuid, uuid);
drop function if exists public.is_dept_admin(uuid, uuid);

-- 3) Re-key identity tables to Clerk ids (text). cascade drops dependent FKs.
drop table if exists public.google_connections cascade;
drop table if exists public.memberships cascade;
drop table if exists public.profiles cascade;

create table public.profiles (
  clerk_user_id  text primary key,
  email          text not null,
  full_name      text,
  is_super_admin boolean not null default false,
  created_at     timestamptz not null default now()
);

create table public.memberships (
  id            uuid primary key default gen_random_uuid(),
  profile_id    text not null references public.profiles(clerk_user_id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  role          text not null check (role in ('admin','member')),
  created_at    timestamptz not null default now(),
  unique (profile_id, department_id)
);

create table public.google_connections (
  id                      uuid primary key default gen_random_uuid(),
  clerk_user_id           text not null references public.profiles(clerk_user_id) on delete cascade,
  google_email            text,
  refresh_token_encrypted text not null,
  scopes                  text[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (clerk_user_id)
);

-- 4) created_by on runs: uuid -> text (FK already dropped by cascade above)
alter table public.scrap_scale_runs
  alter column created_by type text using created_by::text;

-- 5) RLS enabled, no policies => deny-all for non-service-role (backstop)
alter table public.profiles            enable row level security;
alter table public.memberships         enable row level security;
alter table public.google_connections  enable row level security;
```

- [ ] **Step 2: Apply the migration**

Run: `node --env-file=.env.local supabase/migrate.mjs`
Expected: prints applied `0004_clerk_auth.sql` with no error. (If `migrate.mjs` only runs un-applied files, confirm it picks up 0004.)

- [ ] **Step 3: Verify schema**

```bash
node --env-file=.env.local -e "import('pg').then(async ({default:pg})=>{const c=new pg.Client({connectionString:process.env.DIRECT_URL,ssl:{rejectUnauthorized:false}});await c.connect();const r=await c.query(\"select column_name,data_type from information_schema.columns where table_name='profiles' order by ordinal_position\");console.log(r.rows);await c.end();})"
```

Expected: `clerk_user_id | text` is the PK column.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_clerk_auth.sql
git commit -m "feat(db): 0004 migrate identity to Clerk user ids; drop Supabase Auth policies"
```

### Task A3: proxy.ts → clerkMiddleware

**Files:** Modify `proxy.ts`

- [ ] **Step 1: Replace the file**

```ts
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/__clerk/(.*)",
    "/(api|trpc)(.*)",
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add proxy.ts
git commit -m "feat(auth): clerkMiddleware in proxy.ts"
```

### Task A4: ClerkProvider in root layout + sign-in/not-allowed pages

**Files:** Modify `app/layout.tsx`; Create `app/sign-in/[[...sign-in]]/page.tsx`, `app/not-allowed/page.tsx`; Delete old `app/sign-in/page.tsx`.

- [ ] **Step 1: Wrap root layout** — read `app/layout.tsx`, then wrap the existing `<body>` contents with `<ClerkProvider>`:

```tsx
import { ClerkProvider } from "@clerk/nextjs";
// ...existing imports/fonts...
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={/* existing class */}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 2: Sign-in page** — create `app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <SignIn />
    </div>
  );
}
```

- [ ] **Step 3: Not-allowed page** — create `app/not-allowed/page.tsx`:

```tsx
export default function NotAllowed() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="rounded-xl border bg-white p-8 text-center">
        <h1 className="mb-2 text-lg font-semibold text-gray-900">Access restricted</h1>
        <p className="text-sm text-gray-600">
          Sign in with an @everestfleet.in or @everestfleet.com Google account.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Remove the old Supabase sign-in route**

```bash
git rm app/sign-in/page.tsx
```

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/sign-in/ app/not-allowed/
git commit -m "feat(auth): ClerkProvider + Clerk SignIn + not-allowed page"
```

### Task A5: Rewrite guards (Clerk auth + service-role + lazy provision)

**Files:** Rewrite `lib/auth/guards.ts`

- [ ] **Step 1: Replace the file**

```ts
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "@/utils/supabase/admin";
import type { DepartmentRow, Membership, Role } from "@/lib/tools/types";

const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? "everestfleet.in,everestfleet.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const SUPER_ADMINS = (process.env.SUPER_ADMIN_EMAILS ?? "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export type CurrentUser = {
  id: string; // Clerk user id
  email: string;
  isSuperAdmin: boolean;
  memberships: Membership[];
};

export function isAllowedEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const cu = await currentUser();
  const email =
    cu?.primaryEmailAddress?.emailAddress ?? cu?.emailAddresses?.[0]?.emailAddress ?? "";
  if (!isAllowedEmail(email)) return null;

  const admin = createAdminClient();
  const isSuper = SUPER_ADMINS.includes(email.toLowerCase());
  const fullName = [cu?.firstName, cu?.lastName].filter(Boolean).join(" ") || null;
  await admin
    .from("profiles")
    .upsert({ clerk_user_id: userId, email, full_name: fullName, is_super_admin: isSuper }, { onConflict: "clerk_user_id" });

  const { data: memberships } = await admin
    .from("memberships")
    .select("department_id, role, departments(slug)")
    .eq("profile_id", userId);

  return {
    id: userId,
    email,
    isSuperAdmin: isSuper,
    memberships: (memberships ?? []).map((m) => {
      const dept = m.departments as unknown as { slug: string } | null;
      return { department_id: m.department_id as string, department_slug: dept?.slug ?? "", role: m.role as Role };
    }),
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const user = await getCurrentUser();
  if (!user) redirect("/not-allowed");
  return user;
}

export async function requireDepartmentAccess(
  departmentSlug: string,
): Promise<{ user: CurrentUser; role: Role | "super"; department: DepartmentRow }> {
  const user = await requireUser();
  const admin = createAdminClient();
  const { data: dept } = await admin
    .from("departments").select("id, slug, name, icon").eq("slug", departmentSlug).single();
  if (!dept) redirect("/");
  if (user.isSuperAdmin) return { user, role: "super", department: dept as DepartmentRow };
  const m = user.memberships.find((x) => x.department_slug === departmentSlug);
  if (!m) redirect("/");
  return { user, role: m.role, department: dept as DepartmentRow };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit` (or rely on `npm run build` in a later task)
Expected: no errors from `guards.ts`. (`Membership` already has `department_id/department_slug/role` in `lib/tools/types.ts`; confirm by reading it.)

- [ ] **Step 3: Commit**

```bash
git add lib/auth/guards.ts
git commit -m "feat(auth): guards use Clerk auth + service-role + lazy provisioning"
```

### Task A6: Switch app layout + admin to the service-role client; UserButton

**Files:** Modify `app/(app)/layout.tsx`, `app/(app)/admin/page.tsx`, `app/(app)/admin/actions.ts`, `components/Sidebar.tsx`; Delete `app/account/actions.ts`.

- [ ] **Step 1: app layout — read it, replace `createClient()` (Supabase cookie) with `createAdminClient()`** for the departments query (guards already provision the user):

```tsx
import { requireUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/utils/supabase/admin";
import { Sidebar } from "@/components/Sidebar";
import { filterDepartmentsForUser } from "@/lib/auth/access";
import type { DepartmentRow } from "@/lib/tools/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const admin = createAdminClient();
  const { data: allDepts } = await admin.from("departments").select("id, slug, name, icon").order("name");
  const visible = filterDepartmentsForUser((allDepts ?? []) as DepartmentRow[], user.memberships, user.isSuperAdmin);
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar departments={visible} email={user.email} isSuperAdmin={user.isSuperAdmin} />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Sidebar — read `components/Sidebar.tsx`, replace any Supabase sign-out link with Clerk `<UserButton />`.** Add at top: `import { UserButton } from "@clerk/nextjs";` and render `<UserButton afterSignOutUrl="/sign-in" />` where the email/sign-out currently is. Keep the `email`/`isSuperAdmin` props and department list as-is.

- [ ] **Step 3: admin/actions.ts — rewrite** (drop `createUser`; `setMembership` keyed on Clerk id):

```ts
"use server";
import { requireUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

async function assertSuperAdmin() {
  const user = await requireUser();
  if (!user.isSuperAdmin) throw new Error("Forbidden");
  return user;
}

export async function setMembership(formData: FormData) {
  await assertSuperAdmin();
  const profileId = String(formData.get("profile_id"));
  const departmentId = String(formData.get("department_id"));
  const role = String(formData.get("role"));
  const admin = createAdminClient();
  if (role === "none") {
    await admin.from("memberships").delete().match({ profile_id: profileId, department_id: departmentId });
  } else {
    await admin.from("memberships").upsert(
      { profile_id: profileId, department_id: departmentId, role },
      { onConflict: "profile_id,department_id" },
    );
  }
  revalidatePath("/admin");
}
```

- [ ] **Step 4: admin/page.tsx — read it, then:** (a) source data via `createAdminClient()`, (b) select `clerk_user_id, email, full_name, is_super_admin` from `profiles`, (c) the membership grid's hidden `profile_id` input uses `profile.clerk_user_id`, (d) remove the "Add user" form + its `createUser` import/usage. Leave the membership grid otherwise intact.

- [ ] **Step 5: Delete the Supabase account actions**

```bash
git rm app/account/actions.ts
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: compiles. Fix any remaining imports of `@/utils/supabase/server` in app routes by swapping to `createAdminClient()` (search: `grep -rl "utils/supabase/server" app lib`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(auth): service-role data access, Clerk UserButton, admin keyed on Clerk ids"
```

### Task A7: Remove dead Supabase session client/middleware

**Files:** Delete `utils/supabase/middleware.ts`; reduce `utils/supabase/server.ts` if now unused.

- [ ] **Step 1:** `grep -rl "utils/supabase/middleware" .` and `grep -rl "utils/supabase/server" app lib components` — if no references remain, `git rm utils/supabase/middleware.ts utils/supabase/server.ts`. If `server.ts` is still referenced, leave it.
- [ ] **Step 2: Build** — `npm run build` (expected: compiles).
- [ ] **Step 3: Commit** — `git add -A && git commit -m "chore(auth): drop unused Supabase session clients"`

**CHECKPOINT A:** User adds Clerk env vars + dashboard config, runs `npm run dev`, signs in with a `@everestfleet.in` Google account, confirms: a non-Everest Google account is rejected (`/not-allowed`); the super-admin sees `/admin`; assigning Accounting membership to a second user works.

---

## PART B — Per-user Google connection

### Task B1: Re-key the Google connection module to the Clerk user

**Files:** Modify `lib/google/connection.ts`

- [ ] **Step 1: Read `lib/google/connection.ts`.** Replace `departmentId` with `clerkUserId` throughout, and the service-role client:
  - `getConnection(clerkUserId: string)` → `select … where clerk_user_id = clerkUserId`.
  - `saveConnection(clerkUserId, { googleEmail, refreshToken, scopes })` → upsert `{ clerk_user_id, google_email, refresh_token_encrypted, scopes }` `onConflict: "clerk_user_id"`.
  - `getAccessToken(clerkUserId, requiredScopes)` → look up by `clerk_user_id`; throw `ReconsentRequired` if missing/insufficient scopes.
  - Use `createAdminClient()` (not the cookie client).
- [ ] **Step 2: Build** — `npm run build` (expect type errors in callers; fixed in B2/B3).
- [ ] **Step 3: Commit** — `git add lib/google/connection.ts && git commit -m "feat(google): key connection by Clerk user id"`

### Task B2: OAuth start/callback per-user

**Files:** Modify `app/api/google/oauth/start/route.ts`, `app/api/google/oauth/callback/route.ts`

- [ ] **Step 1: start route — read it.** Remove the `?department=` param; get the current user via `requireUser()`. Put the Clerk `userId` into the OAuth `state` (existing signed-state mechanism). Keep `buildConsentUrl(SCRAP_SCALE_SCOPES, state)`.
- [ ] **Step 2: callback route — read it.** Verify `state`, extract `userId`, `exchangeCode`, `emailFromIdToken`, then `saveConnection(userId, …)`. Redirect back to `/accounting/scrap-scale`.
- [ ] **Step 3: Build** — `npm run build`.
- [ ] **Step 4: Commit** — `git add app/api/google/oauth && git commit -m "feat(google): per-user OAuth connect"`

### Task B3: Scrap Scale routes + page use the current user's token

**Files:** Modify every `app/api/tools/scrap-scale/**/route.ts` that calls `getAccessToken`, and `app/(app)/accounting/scrap-scale/page.tsx`.

- [ ] **Step 1:** `grep -rl "getAccessToken(departmentId" app/api/tools/scrap-scale` — in each (`detect-columns`, `run`, `run/[runId]/process-chunk`, `write-back`, `image`, `test-link`), change `requireAccounting()` usage so the **Clerk user id** is passed: `getAccessToken(userId, SCRAP_SCALE_SCOPES)`. (`requireAccounting` already returns `{ departmentId, userId }`; `userId` is now the Clerk id.)
- [ ] **Step 2: scrap-scale page — read it.** Replace `getConnection(department.id)` with `getConnection(user.id)` (get `user` from `requireDepartmentAccess`). Keep run-history query via `createAdminClient()`.
- [ ] **Step 3: Build** — `npm run build` (expect clean).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(scrap-scale): reads use the requesting user's Google token"`

**CHECKPOINT B:** User clicks Connect Google, consents, then Detect/Run on the real `Main_sheet` — confirms a sheet they can access works without sharing.

---

## PART C — Gemini key rotation

### Task C1: Key pool + rotation logic (TDD)

**Files:** Create `lib/scrap-scale/gemini-keys.ts`, `lib/scrap-scale/__tests__/gemini-keys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseGeminiKeys, isRateLimitStatus } from "../gemini-keys";

describe("parseGeminiKeys", () => {
  it("reads comma-separated GEMINI_API_KEYS", () => {
    expect(parseGeminiKeys({ GEMINI_API_KEYS: "a, b ,c" })).toEqual(["a", "b", "c"]);
  });
  it("reads numbered fallbacks and dedupes, preserving order", () => {
    expect(parseGeminiKeys({ GEMINI_API_KEY: "a", GEMINI_API_KEY_2: "b", GEMINI_API_KEY_3: "a" })).toEqual(["a", "b"]);
  });
  it("throws when no keys are present", () => {
    expect(() => parseGeminiKeys({})).toThrow();
  });
});

describe("isRateLimitStatus", () => {
  it("treats 429 as rate-limited", () => {
    expect(isRateLimitStatus(429)).toBe(true);
    expect(isRateLimitStatus(400)).toBe(false);
    expect(isRateLimitStatus(500)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** — `npx vitest run lib/scrap-scale/__tests__/gemini-keys.test.ts` (Cannot find module).

- [ ] **Step 3: Implement**

```ts
type Env = Record<string, string | undefined>;

export function parseGeminiKeys(env: Env = process.env): string[] {
  const out: string[] = [];
  const push = (v?: string) => v && v.split(",").forEach((k) => { const t = k.trim(); if (t && !out.includes(t)) out.push(t); });
  push(env.GEMINI_API_KEYS);
  push(env.GEMINI_API_KEY);
  push(env.GEMINI_API_KEY_2);
  push(env.GEMINI_API_KEY_3);
  if (out.length === 0) throw new Error("No Gemini API key configured (set GEMINI_API_KEY or GEMINI_API_KEYS).");
  return out;
}

export function isRateLimitStatus(status: number): boolean {
  return status === 429;
}

let cursor = 0;
/** Round-robin starting offset so concurrent calls spread across keys. */
export function nextStartIndex(poolSize: number): number {
  const i = cursor % poolSize;
  cursor = (cursor + 1) % poolSize;
  return i;
}
```

- [ ] **Step 4: Run — expect PASS** — `npx vitest run lib/scrap-scale/__tests__/gemini-keys.test.ts`.
- [ ] **Step 5: Commit** — `git add lib/scrap-scale/gemini-keys.ts lib/scrap-scale/__tests__/gemini-keys.test.ts && git commit -m "feat(scrap-scale): Gemini key pool + rotation helpers (TDD)"`

### Task C2: geminiExtract rotates keys on 429

**Files:** Modify `lib/scrap-scale/ocr.ts`

- [ ] **Step 1: Replace `geminiExtract`** so it tries each key, rotating on 429 and throwing other errors:

```ts
import { parseGeminiKeys, isRateLimitStatus, nextStartIndex } from "./gemini-keys";
// ...existing parseOcr/sumAmount unchanged...

export async function geminiExtract(base64: string, mimeType: string): Promise<OcrResult> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const keys = parseGeminiKeys();
  const start = nextStartIndex(keys.length);
  let lastErr: Error | null = null;
  for (let n = 0; n < keys.length; n++) {
    const key = keys[(start + n) % keys.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: OCR_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return parseOcr(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    }
    const body = await res.text();
    if (isRateLimitStatus(res.status)) { lastErr = Object.assign(new Error(`Gemini 429: ${body}`), { status: 429 }); continue; }
    throw Object.assign(new Error(`Gemini ${res.status}: ${body}`), { status: res.status });
  }
  // All keys rate-limited: surface 429 so withRetry() backs off and retries the cycle.
  throw lastErr ?? new Error("Gemini: all keys exhausted");
}
```

(The chunk processor already wraps `geminiExtract` in `withRetry`, which backs off on 429 — so after every key is throttled, it waits and retries.)

- [ ] **Step 2: Run unit tests** — `npm test` (expect all pass; ocr.test.ts unaffected since `parseOcr` unchanged).
- [ ] **Step 3: Build** — `npm run build`.
- [ ] **Step 4: Commit** — `git add lib/scrap-scale/ocr.ts && git commit -m "feat(scrap-scale): rotate Gemini keys on 429, backoff after exhausting pool"`

**CHECKPOINT C:** User adds the 2 extra keys to env. (Manual rate-limit observation deferred to live testing.)

---

## PART D — Per-screenshot breakdown + tally

### Task D1: Breakdown formatter (TDD)

**Files:** Create `lib/scrap-scale/breakdown.ts`, `lib/scrap-scale/__tests__/breakdown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { breakdownString, type SsDetail } from "../breakdown";

const details: SsDetail[] = [
  { name: "gpay1.jpg", amount: 6708, readable: true },
  { name: "gpay2.jpg", amount: 3000, readable: true },
  { name: "blurry.jpg", amount: null, readable: false },
];

describe("breakdownString", () => {
  it("lists SS1..SSn with amounts and a total", () => {
    expect(breakdownString(details)).toBe("SS1: 6708; SS2: 3000; SS3: unreadable | Total: 9708");
  });
  it("returns empty string when there are no screenshots", () => {
    expect(breakdownString([])).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** — `npx vitest run lib/scrap-scale/__tests__/breakdown.test.ts`.

- [ ] **Step 3: Implement**

```ts
export type SsDetail = { name?: string; amount: number | null; readable?: boolean };

export function breakdownString(details: SsDetail[]): string {
  if (details.length === 0) return "";
  const parts = details.map((d, i) => `SS${i + 1}: ${d.amount == null ? "unreadable" : d.amount}`);
  const total = details.reduce((s, d) => s + (d.amount ?? 0), 0);
  return `${parts.join("; ")} | Total: ${total}`;
}
```

- [ ] **Step 4: Run — expect PASS**.
- [ ] **Step 5: Commit** — `git add lib/scrap-scale/breakdown.ts lib/scrap-scale/__tests__/breakdown.test.ts && git commit -m "feat(scrap-scale): per-screenshot breakdown formatter (TDD)"`

### Task D2: Store payments in ocr_details

**Files:** Modify `app/api/tools/scrap-scale/run/[runId]/process-chunk/route.ts`

- [ ] **Step 1:** In the `details` array built per row, add `payments: f.payments` to each `fileResults` entry (the `extractOneFile` result already carries `payments`). Keep the existing fields.
- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(scrap-scale): persist per-payment details for breakdown"`

### Task D3: Drill-down shows SS1/SS2/Total/tally

**Files:** Modify `components/scrap-scale/ResultsTable.tsx`

- [ ] **Step 1:** In the expanded drill-down, label each file card **SS{i+1}**, list its `payments` (amount + txn) beneath the preview, and after the cards render a summary line: `Total: ₹{sum}` and `Tally vs expected ₹{expected}: Δ{difference} {OK|FLAG}` using the row's `expected_amount`/`difference`/`flagged`. (Types already include `payments?` via the detail; extend the `ocr_details` item type with `payments?: { amount: number; txn_id: string | null }[]`.)
- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git add components/scrap-scale/ResultsTable.tsx && git commit -m "feat(scrap-scale): SS1/SS2/total/tally in drill-down"`

### Task D4: Breakdown column in write-back + export

**Files:** Modify `app/api/tools/scrap-scale/run/[runId]/write-back/route.ts`, `app/api/tools/scrap-scale/run/[runId]/export/route.ts`

- [ ] **Step 1: write-back** — read the route. Select `ocr_details` alongside the existing row fields. Add header `"Breakdown"` and, per row, `breakdownString((r.ocr_details ?? []).map(d => ({ name: d.name, amount: d.amount })))`. Column order: `… , "Extracted Values", "Difference", "Flag", "Breakdown"`.
- [ ] **Step 2: export** — read the route. Add the same `Breakdown` column to CSV + XLSX output using `breakdownString`.
- [ ] **Step 3: Build + tests** — `npm run build && npm test`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(scrap-scale): Breakdown column in write-back + export"`

---

## PART E — Google-Sheets-style filters

### Task E1: Filter engine — values + conditions incl. dates (TDD)

**Files:** Rewrite `lib/scrap-scale/filters.ts`, `lib/scrap-scale/__tests__/filters.test.ts`

- [ ] **Step 1: Replace the test file**

```ts
import { describe, it, expect } from "vitest";
import { rowPassesFilters, type ColumnFilter } from "../filters";

const row = ["Alice", "DONE", "1200", "11/11/2025"];

describe("rowPassesFilters", () => {
  it("passes with no filters", () => {
    expect(rowPassesFilters(row, [])).toBe(true);
  });
  it("filter by values: keep only chosen values (case-insensitive, trimmed)", () => {
    const f: ColumnFilter = { index: 1, mode: "values", values: ["done"] };
    expect(rowPassesFilters(row, [f])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 1, mode: "values", values: ["pending"] }])).toBe(false);
  });
  it("text condition: contains / equals / starts / ends / empty / not_empty", () => {
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "contains", value: "lic" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "starts_with", value: "Al" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "ends_with", value: "ce" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "not_empty" }])).toBe(true);
  });
  it("number condition: > >= < <= = != between", () => {
    expect(rowPassesFilters(row, [{ index: 2, mode: "condition", op: "gt", value: "1000" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 2, mode: "condition", op: "lt", value: "1000" }])).toBe(false);
    expect(rowPassesFilters(row, [{ index: 2, mode: "condition", op: "between", value: "1000", value2: "1500" }])).toBe(true);
  });
  it("date condition: before / after / between (dd/mm/yyyy + ISO)", () => {
    expect(rowPassesFilters(row, [{ index: 3, mode: "condition", op: "date_after", value: "01/11/2025" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 3, mode: "condition", op: "date_before", value: "2025-12-01" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 3, mode: "condition", op: "date_between", value: "01/11/2025", value2: "30/11/2025" }])).toBe(true);
  });
  it("AND across columns", () => {
    const fs: ColumnFilter[] = [
      { index: 1, mode: "values", values: ["DONE"] },
      { index: 2, mode: "condition", op: "gte", value: "1200" },
    ];
    expect(rowPassesFilters(row, fs)).toBe(true);
  });
  it("ignores condition filters with a blank value (no constraint)", () => {
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "contains", value: "  " }])).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** — `npx vitest run lib/scrap-scale/__tests__/filters.test.ts`.

- [ ] **Step 3: Implement**

```ts
export type TextOp = "contains" | "not_contains" | "equals" | "starts_with" | "ends_with" | "empty" | "not_empty";
export type NumOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between";
export type DateOp = "date_is" | "date_before" | "date_after" | "date_between";
export type ConditionOp = TextOp | NumOp | DateOp;

export type ColumnFilter =
  | { index: number; mode: "values"; values: string[] }
  | { index: number; mode: "condition"; op: ConditionOp; value?: string; value2?: string };

const needsValue = new Set<ConditionOp>([
  "contains","not_contains","equals","starts_with","ends_with",
  "eq","neq","gt","gte","lt","lte","between",
  "date_is","date_before","date_after","date_between",
]);
const valuelessOps = new Set<ConditionOp>(["empty", "not_empty"]);

function num(s: string): number | null {
  const t = s.replace(/[^0-9.\-]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse dd/mm/yyyy or ISO yyyy-mm-dd to a UTC timestamp (ms), else null. */
export function parseDate(s: string): number | null {
  const t = s.trim();
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function textMatch(cell: string, op: TextOp, v: string): boolean {
  const c = cell.trim().toLowerCase();
  const val = v.trim().toLowerCase();
  switch (op) {
    case "empty": return c === "";
    case "not_empty": return c !== "";
    case "contains": return c.includes(val);
    case "not_contains": return !c.includes(val);
    case "equals": return c === val;
    case "starts_with": return c.startsWith(val);
    case "ends_with": return c.endsWith(val);
  }
}

function numMatch(cell: string, op: NumOp, v: string, v2?: string): boolean {
  const c = num(cell); const a = num(v); if (c === null || a === null) return false;
  switch (op) {
    case "eq": return c === a;
    case "neq": return c !== a;
    case "gt": return c > a;
    case "gte": return c >= a;
    case "lt": return c < a;
    case "lte": return c <= a;
    case "between": { const b = num(v2 ?? ""); return b !== null && c >= Math.min(a, b) && c <= Math.max(a, b); }
  }
}

function dateMatch(cell: string, op: DateOp, v: string, v2?: string): boolean {
  const c = parseDate(cell); const a = parseDate(v); if (c === null || a === null) return false;
  switch (op) {
    case "date_is": return c === a;
    case "date_before": return c < a;
    case "date_after": return c > a;
    case "date_between": { const b = parseDate(v2 ?? ""); return b !== null && c >= Math.min(a, b) && c <= Math.max(a, b); }
  }
}

const TEXT_OPS = new Set<ConditionOp>(["contains","not_contains","equals","starts_with","ends_with","empty","not_empty"]);
const NUM_OPS = new Set<ConditionOp>(["eq","neq","gt","gte","lt","lte","between"]);

function conditionPasses(cell: string, op: ConditionOp, value?: string, value2?: string): boolean {
  if (valuelessOps.has(op)) return textMatch(cell, op as TextOp, "");
  if (needsValue.has(op) && !(value ?? "").trim()) return true; // blank value = no constraint
  if (TEXT_OPS.has(op)) return textMatch(cell, op as TextOp, value!);
  if (NUM_OPS.has(op)) return numMatch(cell, op as NumOp, value!, value2);
  return dateMatch(cell, op as DateOp, value!, value2);
}

export function rowPassesFilters(row: string[], filters: ColumnFilter[]): boolean {
  return filters.every((f) => {
    const cell = row[f.index] ?? "";
    if (f.mode === "values") {
      if (!f.values?.length) return true;
      const set = new Set(f.values.map((v) => v.trim().toLowerCase()));
      return set.has(cell.trim().toLowerCase());
    }
    return conditionPasses(cell, f.op, f.value, f.value2);
  });
}
```

- [ ] **Step 4: Run — expect PASS** — `npx vitest run lib/scrap-scale/__tests__/filters.test.ts`.
- [ ] **Step 5: Commit** — `git add lib/scrap-scale/filters.ts lib/scrap-scale/__tests__/filters.test.ts && git commit -m "feat(scrap-scale): Sheets-style filter engine (values + text/number/date conditions, TDD)"`

### Task E2: Distinct column values endpoint

**Files:** Create `app/api/tools/scrap-scale/column-values/route.ts`

- [ ] **Step 1: Implement** (mirrors detect-columns' auth/read; returns distinct values + an inferred type):

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { readValues } from "@/lib/google/sheets";
import { parseDate } from "@/lib/scrap-scale/filters";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAccounting();
    const { spreadsheetId, sheetTab, index } = await req.json();
    if (!spreadsheetId || typeof index !== "number") {
      return NextResponse.json({ error: "Missing spreadsheet or column index." }, { status: 400 });
    }
    let accessToken: string;
    try { ({ accessToken } = await getAccessToken(userId, SCRAP_SCALE_SCOPES)); }
    catch (e) { if (e instanceof ReconsentRequired) return NextResponse.json({ error: "reconsent_required" }, { status: 409 }); throw e; }

    const values = await readValues(spreadsheetId, sheetTab, accessToken);
    const cells = values.slice(1).map((r) => (r[index] ?? "").trim());
    const counts = new Map<string, number>();
    for (const c of cells) counts.set(c, (counts.get(c) ?? 0) + 1);
    const distinct = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 500);
    const nonEmpty = cells.filter(Boolean);
    const numericShare = nonEmpty.length ? nonEmpty.filter((c) => /^[₹$,.\s\d-]+$/.test(c) && /\d/.test(c)).length / nonEmpty.length : 0;
    const dateShare = nonEmpty.length ? nonEmpty.filter((c) => parseDate(c) !== null).length / nonEmpty.length : 0;
    const type = dateShare > 0.6 ? "date" : numericShare > 0.6 ? "number" : "text";

    return NextResponse.json({ values: distinct, type });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load column values." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git add app/api/tools/scrap-scale/column-values && git commit -m "feat(scrap-scale): distinct column-values endpoint for filters"`

### Task E3: FilterPanel component

**Files:** Create `components/scrap-scale/FilterPanel.tsx`

- [ ] **Step 1: Implement** a panel that, given `headers` + a fetch callback for column values, lets the user add per-column filters with a mode toggle (Values | Condition). Values mode shows the distinct-value checklist (lazy-loaded via `/column-values`); Condition mode shows an op dropdown (text/number/date ops) + value input(s). Emits `ColumnFilter[]` via `onChange`. Full component:

```tsx
"use client";
import { useState } from "react";
import type { ColumnFilter, ConditionOp } from "@/lib/scrap-scale/filters";

const TEXT_OPS: { v: ConditionOp; label: string }[] = [
  { v: "contains", label: "contains" }, { v: "not_contains", label: "does not contain" },
  { v: "equals", label: "is exactly" }, { v: "starts_with", label: "starts with" },
  { v: "ends_with", label: "ends with" }, { v: "empty", label: "is empty" }, { v: "not_empty", label: "is not empty" },
];
const NUM_OPS: { v: ConditionOp; label: string }[] = [
  { v: "eq", label: "=" }, { v: "neq", label: "≠" }, { v: "gt", label: ">" }, { v: "gte", label: "≥" },
  { v: "lt", label: "<" }, { v: "lte", label: "≤" }, { v: "between", label: "between" },
];
const DATE_OPS: { v: ConditionOp; label: string }[] = [
  { v: "date_is", label: "is" }, { v: "date_before", label: "before" },
  { v: "date_after", label: "after" }, { v: "date_between", label: "between" },
];

type ColType = "text" | "number" | "date";

export function FilterPanel({
  headers, filters, onChange, loadValues,
}: {
  headers: string[];
  filters: ColumnFilter[];
  onChange: (f: ColumnFilter[]) => void;
  loadValues: (index: number) => Promise<{ values: { value: string; count: number }[]; type: ColType }>;
}) {
  const [valueCache, setValueCache] = useState<Record<number, { values: { value: string; count: number }[]; type: ColType }>>({});

  function update(i: number, patch: Partial<ColumnFilter>) {
    onChange(filters.map((f, idx) => (idx === i ? ({ ...f, ...patch } as ColumnFilter) : f)));
  }
  function remove(i: number) { onChange(filters.filter((_, idx) => idx !== i)); }
  async function addValuesFilter() {
    const f: ColumnFilter = { index: 0, mode: "values", values: [] };
    onChange([...filters, f]);
    await ensureValues(0);
  }
  function addConditionFilter() { onChange([...filters, { index: 0, mode: "condition", op: "contains", value: "" }]); }
  async function ensureValues(index: number) {
    if (valueCache[index]) return;
    const data = await loadValues(index);
    setValueCache((c) => ({ ...c, [index]: data }));
  }
  function opsFor(type: ColType) { return type === "number" ? NUM_OPS : type === "date" ? DATE_OPS : TEXT_OPS; }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">Filters — only rows matching all filters are processed</span>
        <div className="flex gap-2">
          <button onClick={addValuesFilter} className="rounded border px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">+ By values</button>
          <button onClick={addConditionFilter} className="rounded border px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">+ By condition</button>
        </div>
      </div>
      {filters.length === 0 && <p className="text-xs text-gray-400">No filters — all rows will be processed.</p>}
      {filters.map((f, i) => {
        const type = valueCache[f.index]?.type ?? "text";
        return (
          <div key={i} className="rounded border p-2">
            <div className="mb-2 flex items-center gap-2">
              <select
                value={f.index}
                onChange={(e) => { const index = Number(e.target.value); update(i, { index }); if (f.mode === "values") ensureValues(index); }}
                className="rounded border px-2 py-1 text-sm text-gray-900"
              >
                {headers.map((h, idx) => <option key={idx} value={idx}>{h || `(col ${idx + 1})`}</option>)}
              </select>
              <span className="text-xs text-gray-400">{f.mode === "values" ? "by values" : "by condition"}</span>
              <button onClick={() => remove(i)} className="ml-auto rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">Remove</button>
            </div>

            {f.mode === "values" ? (
              <div className="max-h-40 overflow-y-auto rounded border p-2">
                {(valueCache[f.index]?.values ?? []).map(({ value, count }) => {
                  const checked = f.values.includes(value);
                  return (
                    <label key={value} className="flex items-center gap-2 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => update(i, { values: e.target.checked ? [...f.values, value] : f.values.filter((v) => v !== value) } as Partial<ColumnFilter>)}
                      />
                      <span className="truncate">{value || "(blank)"}</span>
                      <span className="ml-auto text-xs text-gray-400">{count}</span>
                    </label>
                  );
                })}
                {!valueCache[f.index] && <span className="text-xs text-gray-400">Loading values…</span>}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select value={f.op} onChange={(e) => update(i, { op: e.target.value as ConditionOp })} className="rounded border px-2 py-1 text-sm text-gray-900">
                  {opsFor(type).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                {f.op !== "empty" && f.op !== "not_empty" && (
                  <input value={f.value ?? ""} onChange={(e) => update(i, { value: e.target.value })} placeholder="value" className="rounded border px-2 py-1 text-sm text-gray-900" />
                )}
                {(f.op === "between" || f.op === "date_between") && (
                  <input value={f.value2 ?? ""} onChange={(e) => update(i, { value2: e.target.value })} placeholder="and" className="rounded border px-2 py-1 text-sm text-gray-900" />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git add components/scrap-scale/FilterPanel.tsx && git commit -m "feat(scrap-scale): Google-Sheets-style FilterPanel"`

### Task E4: Wire FilterPanel into ScrapScaleApp + run route

**Files:** Modify `components/scrap-scale/ScrapScaleApp.tsx`, `app/api/tools/scrap-scale/run/route.ts`

- [ ] **Step 1: ScrapScaleApp** — replace the old inline filter UI block with `<FilterPanel headers={detect.headers} filters={filters} onChange={setFilters} loadValues={loadColumnValues} />`. Add `loadColumnValues`:

```ts
async function loadColumnValues(index: number) {
  const res = await fetch("/api/tools/scrap-scale/column-values", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spreadsheetId: detect!.spreadsheetId, sheetTab: sheetTab || detect!.sheetTab, index }),
  });
  return (await readJson(res)) as { values: { value: string; count: number }[]; type: "text" | "number" | "date" };
}
```

Change the `filters` state type to `ColumnFilter[]` from `@/lib/scrap-scale/filters` and drop the old `FilterOp`/`FILTER_OPS` constants. The run call already sends `filters`.

- [ ] **Step 2: run route** — it already passes `filters` to `rowPassesFilters`; no change needed beyond the new `ColumnFilter` shape (already imported). Confirm `Array.isArray(filters)` guard remains.
- [ ] **Step 3: Build + tests** — `npm run build && npm test` (expect all green).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(scrap-scale): use Sheets-style FilterPanel end-to-end"`

**CHECKPOINT E:** User filters by a city's values and by a November date range, runs, and confirms only matching rows are OCR'd.

---

## Final

- [ ] **Run full suite** — `npm test` (all pass), `npm run lint` (clean), `npm run build` (clean).
- [ ] **Update README** — auth section (Clerk, Google-only, domains), per-user Connect Google, Gemini key pool env, breakdown/filters.
- [ ] **Update `.env.example`** — remove Supabase seed vars; add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `SUPER_ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`.
- [ ] **finishing-a-development-branch** — verify tests, present options, push to `origin/main` (Vercel deploy).
