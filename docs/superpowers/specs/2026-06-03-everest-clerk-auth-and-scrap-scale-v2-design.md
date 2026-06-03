# Everest v2: Clerk Auth + Per-User Google + Scrap Scale OCR/Filters — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending spec review → implementation plan.

## Goal

Replace Supabase Auth with **Clerk** (Google-only, domain-restricted), make Google
Drive/Sheets access **per-user** (any sheet the signed-in user can open works, no
service account), and finish Scrap Scale: **Gemini key rotation** for rate limits,
a **per-screenshot breakdown + tally**, and a **Google-Sheets-style filter panel**.

## Decisions (locked)

- **Auth:** Clerk. Google sign-in only (no email/password). Restricted to
  `@everestfleet.in` and `@everestfleet.com`.
- **Google access:** Separate per-user "Connect Google" OAuth (our existing
  `lib/google/oauth.ts`, re-keyed department → user). **Service account dropped.**
- **DB security:** Server guards (`requireUser` / `requireDepartmentAccess`) using
  Clerk `auth()` + the `memberships` table; all DB access via the **service-role**
  client. RLS demoted to a backstop (service role bypasses it).
- **New-signup default access:** none until a super-admin grants a department.
- **Data reset accepted:** profiles/memberships are re-keyed to Clerk ids; existing
  test users are wiped and re-assigned after first Google login.

## Non-goals

- Domain-wide delegation / service-account sharing (rejected).
- Folding Drive/Sheets scopes into Clerk's Google connection (rejected for run reliability).
- Clerk ↔ Supabase JWT/RLS integration (rejected; server-guard model instead).

---

## Component A — Clerk authentication

### Packages & wiring
- `npm i @clerk/nextjs`.
- `proxy.ts` (root, Next 16): `export default clerkMiddleware()` from
  `@clerk/nextjs/server`, with the matcher from Clerk's current quickstart **plus**
  `'/__clerk/(.*)'`. This replaces the current Supabase `proxy()` (session refresh
  no longer needed).
- `app/layout.tsx`: wrap with `<ClerkProvider>` inside `<body>`. Sign-in/up surfaces
  via Clerk components. **Verify the exact component API (`<Show>` vs
  `<SignedIn>/<SignedOut>`) against the installed `@clerk/nextjs` version before
  writing UI** — follow the installed package, not memory.
- Remove `app/sign-in/`, `app/account/actions.ts` (Supabase password flows),
  `utils/supabase/{client,middleware,server}.ts` session usage. Keep
  `utils/supabase/admin.ts` (service-role) as the single DB client.

### Env
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
- `SUPER_ADMIN_EMAILS` (comma-separated; seeds `is_super_admin` on first login).
- `ALLOWED_EMAIL_DOMAINS=everestfleet.in,everestfleet.com`.

### Domain restriction
- Configure Clerk Dashboard → Restrictions → allowlist the two domains.
- **Also** enforce server-side: a helper `assertAllowedEmail(email)` checks the
  domain; `requireUser` rejects (sign-out + 403) any session whose primary email is
  outside `ALLOWED_EMAIL_DOMAINS`. Defense in depth.

### Lazy provisioning
- `lib/auth/guards.ts#requireUser()`:
  1. `const { userId } = await auth()`; if none → redirect to Clerk sign-in.
  2. Load Clerk user; assert allowed email domain.
  3. Upsert `profiles` row keyed by `clerk_user_id` (full name + email);
     set `is_super_admin = email ∈ SUPER_ADMIN_EMAILS`.
  4. Return `{ userId, email, profile }`.
- `requireDepartmentAccess(slug)`: as today, but membership lookup is by
  `clerk_user_id`. Returns `{ user, role: Role|"super", department }`.

### Admin page
- `/admin` (super-admin only): lists provisioned profiles + per-department
  membership grid (member/admin/none). Server actions use service-role client.
  "Add user" by email is **removed** (users self-provision via Google sign-in);
  the admin only assigns roles. Optionally keep an "invite by email" note.

---

## Component B — Per-user Google connection

### Schema (`0004` migration, see Data section)
- `google_connections` re-keyed: drop `department_id` uniqueness; add
  `clerk_user_id text` unique; keep `refresh_token_encrypted`, `scopes[]`,
  `google_email`. One connection per user.

### OAuth module changes
- `lib/google/connection.ts`: `getConnection(userId)`, `saveConnection(userId, …)`,
  `getAccessToken(userId, requiredScopes)` (throws `ReconsentRequired`).
- `app/api/google/oauth/start`: `state` carries the Clerk `userId` (signed) instead
  of `department`. `callback`: saves under `clerk_user_id`.
- All Scrap Scale routes resolve the **current Clerk user**, then
  `getAccessToken(userId, SCRAP_SCALE_SCOPES)`.

### UX
- Scrap Scale page shows "Connect Google" if the **current user** has no connection
  (was per-department). Reconnect prompts on `reconsent_required`.

---

## Component C — Gemini key rotation (rate limits)

- New `lib/scrap-scale/gemini-keys.ts`:
  - `getGeminiKeys(): string[]` — reads `GEMINI_API_KEYS` (comma-separated) or
    `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`; dedupes; throws if empty.
  - A module-level round-robin cursor so concurrent calls spread across keys.
- `geminiExtract` accepts the key pool and, on **429 / RESOURCE_EXHAUSTED / quota**,
  fails over to the next key immediately (not just backoff); after exhausting all
  keys, applies the existing exponential backoff (`withRetry`) and retries the cycle.
  Distinguish 429 (rotate) from 4xx (don't retry) from 5xx (backoff).
- **No key material in client bundles** (server-only).

## Component D — Per-screenshot breakdown + tally

- Drill-down (ResultsTable): per file render **SS1 / SS2 / …** with the file's
  total and each payment (amount + txn) beneath it, then **Total: ₹N** and
  **Tally vs expected: Δ + OK/Flag**.
- `ocr_details` already holds per-file `{name, mimeType, amount, txn_ids, payments,
  error}`; add `payments` to the stored detail so per-payment lines render.
- **Write-back + CSV/XLSX export:** add a `Breakdown` column,
  e.g. `SS1: 6708; SS2: 3000` plus the existing `Extracted Values / Difference /
  Flag`. Keep the source tab untouched (new dated tab only).

## Component E — Google-Sheets-style filter panel

- Replace the contains-only filter. Per-column filter supporting two modes (like
  Sheets): **Filter by values** (distinct-value checklist) and **Filter by
  condition**.
- Conditions by inferred column type:
  - text: contains / not contains / equals / starts with / ends with / empty / not empty
  - number: = / ≠ / > / ≥ / < / ≤ / between
  - date: is / before / after / between (parse common dd/mm/yyyy + ISO)
- Data model:
  ```ts
  type ColumnFilter =
    | { index: number; mode: "values"; values: string[] }
    | { index: number; mode: "condition"; op: string; value?: string; value2?: string };
  ```
  AND across columns. A row is processed iff it passes every filter.
- `lib/scrap-scale/filters.ts` extended; pure logic is **TDD** (text/number/date ops,
  values membership, blank-guard, date parsing).
- New endpoint `POST /api/tools/scrap-scale/column-values` → `{ values: string[] }`
  (distinct, capped, with counts) for the chosen column's checklist, using the
  current user's Google token + selected tab. Date type inferred from samples.
- Run route applies the new filter shape; **original row positions preserved** for
  correct write-back alignment (already handled).

---

## Data / migrations

`supabase/migrations/0004_clerk_auth.sql` (applied via existing `migrate.mjs`):
- Drop trigger `on_auth_user_created` + `handle_new_user()`.
- Recreate `profiles` keyed by `clerk_user_id text primary key` (email, full_name,
  is_super_admin). Drop FK to `auth.users`.
- `memberships.user_id` → `text` (references `profiles.clerk_user_id`).
- `*.created_by` (`scrap_scale_runs`, etc.) → `text`.
- `google_connections`: add `clerk_user_id text unique`, drop `department_id`
  uniqueness (keep column nullable for history or drop).
- Keep existing RLS policies but they are **no longer the boundary** (service role
  bypasses). Rewrite `is_super_admin/is_member_of/is_dept_admin` to no-op or leave
  as-is (unused) — simplest: leave; document they're dormant.
- `seed.mjs` no longer creates an auth user; super-admin is established by email on
  first Clerk login.

## Security

- Service-role key, Clerk secret, Gemini keys, Google client secret,
  `TOKEN_ENCRYPTION_KEY` — server-only, `.env.local` + Vercel env. Never in the
  client bundle. `TOKEN_ENCRYPTION_KEY` stable across deploys.
- `Stuff_needed/` (incl. the now-unused service-account JSON) stays gitignored.
- Per-user Google tokens encrypted at rest (AES-256-GCM).

## Testing

- **Pure logic (TDD):** filter ops (text/number/date/values), Gemini key-pool
  selection + 429 rotation decision, per-SS breakdown formatting. Vitest.
- **Build/lint** green each phase.
- **Live E2E** (user-driven): Google sign-in (both domains; reject others),
  admin role assignment, Connect Google, run on `Main_sheet.csv`'s real sheet,
  verify amounts/tally/breakdown, filters, write-back, export, rate-limit behavior.

## Build order

A (Clerk auth + guards + admin + migration) → B (per-user Google connect) →
C (Gemini rotation) → D (per-SS breakdown) → E (Sheets-style filters).
Each phase: build + lint + unit tests green, commit, before the next.

## Open risks

- Clerk component/API names may differ from the pasted guide; verify post-install.
- `drive.readonly`/`spreadsheets` are sensitive scopes — fine under the **Internal**
  consent screen for org users; confirm the OAuth client is Internal.
- Date parsing for filters: support dd/mm/yyyy (sheet uses it) + ISO; ambiguous
  formats fall back to string compare.
