# Everest Fleet — Internal Tools Platform

A dashboard of **departments**, each containing **tools**, with per-department access control.
This repository is the **platform shell (v1)**: authentication, access gating, a pluggable tool
registry, and an admin page. The first tool, **Scrap Scale** (Accounting), is currently a
"Coming soon" placeholder — its real implementation arrives in a later prompt.

## Stack

- **Next.js 16** (App Router, TypeScript) — server components + server actions
- **Clerk** authentication — Google sign-in only, restricted to `@everestfleet.in` / `@everestfleet.com`
- **Supabase** (Postgres) — all access via the service-role client; authorization enforced in server guards
- **Tailwind CSS v4**

## Prerequisites

- Node.js 20+ (developed on Node 25)
- A Supabase project (URL, publishable key, service-role key, and the Postgres connection string)

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | app (server) | **Server only.** All DB access. Never exposed to the client |
| `DIRECT_URL` | `migrate.mjs` | Postgres connection string (session-mode pooler). Migrations only |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | app (browser) | Clerk publishable key |
| `CLERK_SECRET_KEY` | app (server) | Clerk secret key |
| `SUPER_ADMIN_EMAILS` | server guards | Comma-separated; flagged super-admin on first login |
| `ALLOWED_EMAIL_DOMAINS` | server guards | Comma-separated allowed sign-in domains |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | per-user Google connect | OAuth web client (Internal consent) |
| `TOKEN_ENCRYPTION_KEY` | app (server) | 32-byte base64; encrypts stored Google refresh tokens. Keep stable across deploys |
| `GEMINI_API_KEY` (+ `_2`, `_3`, or `GEMINI_API_KEYS`) | OCR | Key pool; rotates on rate limits |
| `GEMINI_MODEL` | OCR | Default `gemini-2.5-flash` |

`.env.local` is gitignored. The service-role key, Clerk secret, and Google/Gemini keys must never be
committed or shipped to the client bundle.

## Setup

```bash
npm install

# 1. Apply database migrations (schema + Clerk re-key in 0004)
node --env-file=.env.local supabase/migrate.mjs

# 2. Seed the 5 departments (no users — they self-provision via Google sign-in)
node --env-file=.env.local supabase/seed.mjs

# 3. Run
npm run dev          # http://localhost:3000
npm test             # unit tests
npm run build        # production build + typecheck
```

### Clerk setup (one-time)

1. Create a Clerk application; enable **Google** as the only social connection.
2. Clerk Dashboard → **Restrictions**: allowlist `everestfleet.in` and `everestfleet.com`.
3. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` to `.env.local` (and Vercel).
4. The first person whose email is in `SUPER_ADMIN_EMAILS` becomes super-admin on sign-in.

## How access control works

There is **no Supabase session** — Clerk owns identity, and the app reads/writes the DB exclusively
with the **service-role** client. Authorization lives in **server guards**:

- `lib/auth/guards.ts` (`requireUser`, `requireDepartmentAccess`) resolve the Clerk user, reject email
  domains outside `ALLOWED_EMAIL_DOMAINS` (→ `/not-allowed`), lazy-provision a `profiles` row keyed by
  the Clerk user id, and check the `memberships` table.
- `proxy.ts` runs `clerkMiddleware()`; unauthenticated users are redirected to `/sign-in`.
- RLS stays enabled as a backstop (the service role bypasses it; no `auth.uid()` policies remain).

Roles: a membership is `admin` or `member` per department. `profiles.is_super_admin` (derived from
`SUPER_ADMIN_EMAILS`) grants global access. The `/admin` page is super-admin-only.

## Users & access

1. Staff sign in with their `@everestfleet.in` / `@everestfleet.com` Google account — they appear in
   `/admin` automatically (no manual user creation).
2. A super-admin assigns each person `member`/`admin`/none per department in the grid; changes save on
   selection.

New users see an empty dashboard until granted department access.

## How to add a new tool

Tools are declared in one place; pages derive everything from the registry.

1. Add a `ToolDef` to `lib/tools/registry.ts`:
   ```ts
   {
     slug: "my-tool",
     name: "My Tool",
     description: "What it does.",
     departmentSlug: "operations",
     icon: "Wrench",                 // a lucide icon name
     route: "/operations/my-tool",
     requiredRole: "member",         // optional; default "member"
   }
   ```
   The dashboard card counts, the department tool list, and the generic
   `app/(app)/[department]/[tool]/page.tsx` guard all update automatically.
2. To give the tool a real page (instead of the "Coming soon" stub), create a dedicated route at
   `app/(app)/<department>/<tool>/page.tsx` (it takes precedence over the generic `[department]/[tool]`
   route) and keep tool-specific logic under `lib/tools/<slug>/`. Always call
   `requireDepartmentAccess(<departmentSlug>)` at the top so the server guard applies.

## Project layout

```
app/
  layout.tsx                # root; wraps <ClerkProvider>
  sign-in/[[...sign-in]]/   # Clerk <SignIn> (outside the authed group)
  not-allowed/              # rejected email domain
  (app)/                    # authed shell (sidebar); route group, no URL segment
    layout.tsx              # requires Clerk user; renders sidebar
    page.tsx                # dashboard (department cards, filtered)
    [department]/page.tsx   # tool list for a department
    [department]/[tool]/    # generic tool page (renders stub in v1)
    admin/                  # super-admin: assign roles to signed-in users
lib/
  auth/guards.ts            # Clerk auth + service-role + lazy provisioning
  auth/access.ts            # pure, unit-tested access logic
  tools/registry.ts         # the tool registry
utils/supabase/admin.ts     # service-role client (sole DB client)
supabase/
  migrations/               # 0001 schema → 0004 Clerk re-key
  migrate.mjs               # applies migrations via DIRECT_URL
  seed.mjs                  # departments only
proxy.ts                    # Next.js 16 proxy = clerkMiddleware()
```

## Scrap Scale (Accounting)

Reconciles payment-screenshot amounts in a Google Sheet against a per-row "Total Fund Collection"
expected amount, flags mismatches and duplicate transactions, and writes results back as a new dated
tab — leaving the original tab untouched.

### Google connection (reusable module)

Scrap Scale authenticates via **per-user delegated OAuth** — no service-account keys. The OAuth
consent screen is **Internal** to the Everest Workspace, so any org user can consent without Google
app verification.

- **Scopes:** `https://www.googleapis.com/auth/spreadsheets` (read + write, to add the results tab) and
  `https://www.googleapis.com/auth/drive.readonly` (to download the screenshots). Defined once in
  `lib/google/scopes.ts`.
- **Connect:** each user clicks **Connect Google** once and consents as themselves. The tool then
  reads exactly what that user can access — if they can open the sheet/Drive link, the tool can too.
  Their **refresh token** is encrypted at rest (AES-256-GCM via `TOKEN_ENCRYPTION_KEY`) in
  `google_connections`, keyed by their Clerk user id. Access tokens are minted server-side per run and
  never reach the browser.
- If the stored token is missing required scopes, the tool returns `reconsent_required` (409) and the
  UI prompts **Reconnect**.

### Usage

1. **Connect Google** (once, per user).
2. Paste the **Google Sheet URL** → **Detect columns**. Pick the **sheet/tab** if there are several.
   The tool fuzzy-matches the link and "Total Fund Collection" columns; override any column before
   running. Use **"Test a Drive link"** to see exactly what Gemini reads for one link (bypasses cache).
3. **Filter** (optional) with the Google-Sheets-style panel — *filter by values* (distinct-value
   checklist) or *by condition* (text / number / **date** before-after-between). Only matching rows run.
4. **Run** → a chunked, resumable job resolves each Drive link (folders expand to their files),
   downloads **images and PDFs** (multi-page supported), OCRs them with Gemini Flash (**rotating across
   the key pool on rate limits**), sums every payment per row, and shows live progress. OCR is cached
   by Drive file id.
5. Review the **summary** + **results table**. Click an extracted value to see each screenshot as
   **SS1/SS2/…** with per-payment amounts, the **total**, and the **tally vs expected**. Strict
   flagging: flagged when the rounded difference ≠ 0.00. Duplicate txn ids flagged across rows; rows
   with no Drive link are "note rows".
6. **Write results tab** → a `ScrapScale <date> <time>` tab with `Extracted Values`, `Difference`,
   `Flag`, and a per-screenshot **Breakdown** column. The source tab is never modified.
7. **Download CSV / Excel** (incl. Breakdown), and use **Run history** to compare two runs.

### Env vars

`GEMINI_API_KEY` (+ optional `GEMINI_API_KEY_2`/`_3` or comma-separated `GEMINI_API_KEYS` for rate-limit
rotation), `GEMINI_MODEL` (default `gemini-2.5-flash`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI` (`…/api/google/oauth/callback`), `TOKEN_ENCRYPTION_KEY` (32-byte base64). See
`.env.example`.

## Security note

Rotate the Supabase service-role key and the database password if they were ever shared outside a
secret manager. Keep both strictly in `.env.local` locally and in Vercel's server-side env in
production. The Google `TOKEN_ENCRYPTION_KEY` must be stable across deploys (rotating it invalidates
stored refresh tokens — users would re-consent).

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
