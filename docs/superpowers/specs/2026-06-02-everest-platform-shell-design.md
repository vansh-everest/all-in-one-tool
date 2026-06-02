# Everest Fleet Internal Tools Platform — Shell v1 (Design Spec)

**Date:** 2026-06-02
**Status:** Approved for planning
**Scope:** Foundation only. No department tools beyond a single "Scrap Scale" placeholder stub.

---

## 1. Purpose

A single internal web app for Everest Fleet, organized as a dashboard of **departments**, each
containing **tools**. This spec covers only the **shell**: authentication, per-department access
control, a pluggable tool registry, routing, and an admin page for user/department management.

The shell must make adding a new tool a small, isolated change (one registry entry + one folder),
because subsequent prompts add real tools (the first being **Scrap Scale** under Accounting).

## 2. Stack

- **Next.js** (App Router, TypeScript), deployable on Vercel. Server Components + Route Handlers
  for any backend logic.
- **Supabase** (Postgres) as the database, **Row Level Security enabled on every table**.
- **Supabase Auth (email/password)** for authentication — *not Clerk*. RLS uses native `auth.uid()`.
- **`@supabase/ssr`** for cookie-based session management (server client, browser client, middleware).
- **Tailwind CSS**. Clean, professional, minimal: left sidebar + main content area.

### Deltas from the original "prompt 01" text
- **Clerk is removed.** Auth is Supabase Auth. This eliminates the Clerk↔Supabase JWT template and
  uses `auth.uid()` directly in RLS.
- **No public sign-up.** Accounts are created by admins only (see §6).

## 3. Departments & core concept

Five departments: **Marketing, Recruitment, Finance, Accounting, Operations**.

- `/` (authenticated): grid of department **cards**, filtered to the departments the user belongs to.
  Each card: name, icon, count of tools available to the user in that department.
- `/[department]`: lists that department's tools as cards/links (derived from the registry).
- `/[department]/[tool]`: renders the tool's page.
- Super_admins see all departments and all tools.

## 4. Data model (Supabase, all RLS-enabled)

```
departments (
  id          uuid pk default gen_random_uuid(),
  slug        text unique not null,   -- 'accounting', etc.
  name        text not null,
  icon        text not null,          -- lucide icon name
  created_at  timestamptz default now()
)

profiles (
  id             uuid pk references auth.users(id) on delete cascade,
  email          text not null,
  full_name      text,
  is_super_admin boolean not null default false,
  created_at     timestamptz default now()
)

memberships (
  id            uuid pk default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  role          text not null check (role in ('admin','member')),
  created_at    timestamptz default now(),
  unique (profile_id, department_id)
)
```

- A `profiles` row is auto-created when an auth user is created, via a `handle_new_user()` trigger on
  `auth.users` (`SECURITY DEFINER`), copying `id` and `email`.

## 5. Access control (two layers)

### Layer 1 — RLS (database)
To avoid policy recursion (a policy on `memberships` that itself queries `memberships`), define two
`SECURITY DEFINER` helper functions that bypass RLS internally:

- `public.is_super_admin(uid uuid) returns boolean` — reads `profiles.is_super_admin`.
- `public.is_member_of(dept uuid, uid uuid) returns boolean` — checks a row in `memberships`.

Policies (summary):
- **departments**: `select` allowed if `is_super_admin(auth.uid())` OR `is_member_of(id, auth.uid())`.
  Insert/update/delete: super_admin only.
- **profiles**: a user may `select`/`update` their own row (`id = auth.uid()`); super_admin has full
  access (so the super_admin-only `/admin` page can list all users). Department-admin profile access is
  deferred until department admins get UI (post-v1).
- **memberships**: `select` own rows or rows in departments where the user is an `admin`, plus
  super_admin full access. Insert/update/delete: super_admin, or department `admin` for that
  department only.

### Layer 2 — Server route guards
`/[department]` and `/[department]/[tool]` resolve the current user server-side and verify membership
(or super_admin). On failure: redirect to `/` (or 404). The client is never the source of truth.

## 6. Authentication & user management

- **Sign-in only** at `/sign-in` (email + password via Supabase Auth). No `/sign-up` route is exposed,
  and the Supabase project's "Allow new users to sign up" setting should be **disabled** (documented in
  README).
- **Admin creates users** at `/admin` (super_admin only for v1):
  - Enter email + full name → server Route Handler uses the **service-role** Supabase client to call
    `auth.admin.createUser({ email, password: <generated temp>, email_confirm: true })`.
  - The generated temp password is **shown once** to the admin to hand off. (SMTP-based invite/reset is
    a documented optional enhancement, not built in v1.)
  - Assign/remove department memberships and set role (`admin`/`member`) per department.
- **Change password**: a minimal account action for any signed-in user (`supabase.auth.updateUser`).
- The **service-role key** is used **only** server-side in the seed script and the admin user-creation
  Route Handler. It never reaches the client bundle. All other DB access uses the publishable key as the
  authenticated user, so RLS is enforced.

## 7. Tool registry (pluggable)

`lib/tools/registry.ts` exports a typed array of:

```ts
type ToolDef = {
  slug: string;
  name: string;
  description: string;
  departmentSlug: string;
  icon: string;            // lucide icon name
  route: string;           // e.g. '/accounting/scrap-scale'
  requiredRole?: 'admin' | 'member';  // default 'member'
};
```

- Dashboard cards, per-department tool lists, counts, and links are **all derived from this array** —
  no hardcoded per-tool wiring in pages.
- Each tool lives in `app/[department]/[tool]/` (page) and optionally `lib/tools/<slug>/` (logic), so it
  is self-contained.
- v1 registers exactly one tool: **Scrap Scale** (`accounting/scrap-scale`) → "Coming soon" stub page.
  A later prompt swaps the stub for the real component.

## 8. Project hygiene & deliverables

- `supabase/migrations/` — SQL for tables, trigger, helper functions, and RLS policies.
- **Seed** (`supabase/seed` script, run with service-role key): inserts the 5 departments; creates the
  super_admin **vansh.sood@everestfleet.in** via `auth.admin.createUser` (temp password from env
  `SEED_SUPER_ADMIN_PASSWORD`, `email_confirm: true`); flags `is_super_admin = true`.
- `.env.example` — every required var:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server only)
  - `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` (seed only)
- `.env.local` holds the real values (gitignored; never committed).
- `README.md` — local setup, env vars, how to apply migrations, how RLS/RBAC works, admin-only user
  creation flow, and **how to add a new tool**.

## 9. Out of scope (later prompts)

Scrap Scale logic, OCR/Gemini extraction, Google OAuth, report reshaping, email tracking. The shell
must not block these — e.g. `google_connections` and tool-config tables come with their respective tools.

## 10. Verification

- `npm run build` / typecheck clean.
- Migrations applied to the live Supabase project (`hbspmyossvwiueshvqjp`).
- Seed run → super_admin can sign in.
- Manual end-to-end: sign in as super_admin → see all 5 cards → open Accounting → see Scrap Scale
  "Coming soon" → `/admin` create a user with limited membership → that user sees only their departments.

## 11. Security note

The Supabase service-role and anon/service keys were shared in plaintext during design. Recommend
rotating the service-role key in the Supabase dashboard after the build, and keeping it strictly in
`.env.local` / Vercel server env going forward.
