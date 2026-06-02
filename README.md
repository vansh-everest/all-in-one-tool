# Everest Fleet — Internal Tools Platform

A dashboard of **departments**, each containing **tools**, with per-department access control.
This repository is the **platform shell (v1)**: authentication, access gating, a pluggable tool
registry, and an admin page. The first tool, **Scrap Scale** (Accounting), is currently a
"Coming soon" placeholder — its real implementation arrives in a later prompt.

## Stack

- **Next.js 16** (App Router, TypeScript) — server components + server actions
- **Supabase** (Postgres) with **Row Level Security** on every table
- **Supabase Auth** (email/password) via `@supabase/ssr` cookie sessions
- **Tailwind CSS v4**

## Prerequisites

- Node.js 20+ (developed on Node 25)
- A Supabase project (URL, publishable key, service-role key, and the Postgres connection string)

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app + scripts | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app (browser + SSR) | Replaces the legacy anon key; RLS-scoped |
| `SUPABASE_SERVICE_ROLE_KEY` | seed + admin actions | **Server only.** Bypasses RLS. Never exposed to the client |
| `DIRECT_URL` | `migrate.mjs`, `seed.mjs` | Postgres connection string (session-mode pooler). Migrations/seed only |
| `SEED_SUPER_ADMIN_EMAIL` | `seed.mjs` | Initial super_admin email |
| `SEED_SUPER_ADMIN_PASSWORD` | `seed.mjs` | Initial super_admin password (change after first login) |

`.env.local` is gitignored. The service-role key and DB password must never be committed or shipped
to the client bundle.

## Setup

```bash
npm install

# 1. Apply database migrations (tables, RLS, trigger, helper functions)
node --env-file=.env.local supabase/migrate.mjs

# 2. Seed the 5 departments + the super_admin
node --env-file=.env.local supabase/seed.mjs

# 3. Run
npm run dev          # http://localhost:3000
npm test             # unit tests for access logic
npm run build        # production build + typecheck
```

After seeding, sign in at `/sign-in` with `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`.

### Disable public sign-ups (important)

Accounts are created **only by admins** (see below). There is no `/sign-up` route. To prevent any
self-registration via the Supabase API, also turn **off** "Allow new users to sign up" in the
Supabase dashboard → Authentication → Providers → Email.

## How access control works

Access is enforced in **two layers**:

1. **RLS (database).** Every table has policies. To avoid policy recursion, the policies call three
   `SECURITY DEFINER` helper functions defined in `supabase/migrations/0001_init.sql`:
   `is_super_admin(uid)`, `is_member_of(dept, uid)`, `is_dept_admin(dept, uid)`. A user can only read
   departments/memberships tied to departments they belong to; super_admin bypasses everything.
2. **Server route guards.** `lib/auth/guards.ts` (`requireUser`, `requireDepartmentAccess`) resolve
   the user server-side and redirect if they lack membership. The `proxy.ts` (Next.js 16's renamed
   middleware) redirects unauthenticated requests to `/sign-in` and refreshes the session cookie.

Roles: a membership is `admin` or `member` per department. `profiles.is_super_admin` grants global
access. The `/admin` page is super_admin-only in v1.

## Admin-only user creation

1. Sign in as a super_admin → **Admin** in the sidebar (`/admin`).
2. **Add user**: enter email + full name. The server creates the Supabase Auth user (via the
   service-role admin API, `email_confirm: true`) and displays a **one-time temp password** — hand it
   to the user; they sign in and change it.
3. **Memberships**: the grid assigns each user `member`/`admin`/none per department; changes save on
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
  sign-in/                  # public sign-in (outside the authed group)
  (app)/                    # authed shell (sidebar); route group, no URL segment
    layout.tsx              # requires session; renders sidebar
    page.tsx                # dashboard (department cards, filtered)
    [department]/page.tsx   # tool list for a department
    [department]/[tool]/    # generic tool page (renders stub in v1)
    admin/                  # super_admin: users + memberships
  account/actions.ts        # sign out / change password
lib/
  auth/guards.ts            # server guards
  auth/access.ts            # pure, unit-tested access logic
  tools/registry.ts         # the tool registry
utils/supabase/             # server / client / proxy / admin clients
supabase/
  migrations/0001_init.sql  # schema + RLS
  migrate.mjs               # applies migrations via DIRECT_URL
  seed.mjs                  # departments + super_admin
proxy.ts                    # Next.js 16 middleware (auth redirect + session refresh)
```

## Scrap Scale (Accounting)

Reconciles payment-screenshot amounts in a Google Sheet against a per-row "Total Fund Collection"
expected amount, flags mismatches and duplicate transactions, and writes results back as a new dated
tab — leaving the original tab untouched.

### Google connection (reusable module)

Scrap Scale (and future Google-backed tools) authenticate via **user-delegated OAuth** — no
service-account keys. The OAuth consent screen is **Internal** to the everestfleet.in Workspace, so
any org user can consent to the scopes without Google app verification.

- **Scopes:** `https://www.googleapis.com/auth/spreadsheets` (read + write, to add the results tab) and
  `https://www.googleapis.com/auth/drive.readonly` (to download the screenshots). Defined once in
  `lib/google/scopes.ts`.
- **Connect:** on the Scrap Scale page click **Connect Google** and consent with an account that has
  access to the source sheet **and** the Drive folder holding the screenshots (a dedicated internal
  account is recommended). The **refresh token** is encrypted at rest (AES-256-GCM via
  `TOKEN_ENCRYPTION_KEY`) in `google_connections`, scoped by RLS to the Accounting department. Access
  tokens are minted server-side per run and never reach the browser.
- If the stored token is missing required scopes, the tool returns `reconsent_required` (409) and the
  UI prompts **Reconnect**.

### Usage

1. **Connect Google** (once).
2. Paste the **Google Sheet URL** → **Detect columns**. The tool fuzzy-matches the link column
   (≈ "Upload Transaction Details") and the expected-amount column (≈ "Total Fund Collection"); if two
   link columns match it picks the one that actually contains Drive links, else asks you to choose.
   You can **override** any column before running.
3. **Run** → a chunked, resumable job downloads each screenshot, OCRs it with Gemini Flash, sums valid
   amounts per row, and shows live progress + a running subtotal. OCR results are cached by Drive file
   id, so re-runs are fast and within free-tier limits.
4. Review the **reconciliation summary** + **results table** (click an extracted value to see the
   source screenshot(s) and what OCR read). Strict flagging: a row is flagged if the rounded difference
   is not exactly 0.00. Duplicate transaction ids are flagged across rows; rows with no Drive link are
   "note rows" excluded from the math.
5. **Write results tab to sheet** → adds a `ScrapScale <date> <time>` tab with the original rows plus
   `Extracted Values`, `Difference`, `Flag` columns. The source tab is never modified.
6. **Download CSV / Excel**, and use **Run history** to review past runs and compare two side by side.

### Env vars

`GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (`…/api/google/oauth/callback`), `TOKEN_ENCRYPTION_KEY`
(32-byte base64). See `.env.example`.

## Security note

Rotate the Supabase service-role key and the database password if they were ever shared outside a
secret manager. Keep both strictly in `.env.local` locally and in Vercel's server-side env in
production. The Google `TOKEN_ENCRYPTION_KEY` must be stable across deploys (rotating it invalidates
stored refresh tokens — users would re-consent).
