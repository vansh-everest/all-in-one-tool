# Everest Platform Shell v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the Everest Fleet internal tools platform — Supabase-Auth login, per-department RLS access control, a pluggable tool registry, dashboard/department/tool routing, and a super_admin admin page — with one "Scrap Scale" placeholder tool under Accounting.

**Architecture:** Next.js App Router (TS) on Vercel. Supabase Postgres with RLS on every table, using native `auth.uid()`. Auth is Supabase email/password via `@supabase/ssr` cookie sessions. Access is enforced in two layers: RLS policies (using `SECURITY DEFINER` helper functions to avoid recursion) and server-side route guards. Tools are declared in a single typed registry; pages derive all UI from it.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, `@supabase/supabase-js`, `@supabase/ssr`, Vitest (pure-logic unit tests), Postgres (via psql for migrations/seed).

---

## File Structure

```
everest/
├── app/
│   ├── layout.tsx                      # root layout (html/body, Tailwind)
│   ├── globals.css                     # Tailwind directives
│   ├── page.tsx                        # '/' dashboard (department cards, filtered)
│   ├── sign-in/page.tsx                # email/password sign-in
│   ├── (app)/layout.tsx                # authed shell: sidebar + main, requires session
│   ├── [department]/page.tsx           # department tool list (server guard)
│   ├── [department]/[tool]/page.tsx    # tool page dispatcher (server guard)
│   ├── accounting/scrap-scale/page.tsx # explicit Scrap Scale stub route
│   ├── admin/page.tsx                  # super_admin: users + memberships
│   ├── account/actions.ts              # change password / sign out server actions
│   └── api/                            # (reserved for later tools)
├── components/
│   ├── Sidebar.tsx
│   ├── DepartmentCard.tsx
│   ├── ToolCard.tsx
│   └── admin/AdminUserManager.tsx      # client component, calls admin server actions
├── lib/
│   ├── auth/guards.ts                  # getSession, requireUser, requireDepartmentAccess
│   ├── auth/access.ts                  # pure: filterDepartmentsForUser, toolsForDepartment
│   ├── tools/registry.ts               # typed tool registry
│   └── tools/types.ts                  # ToolDef type
├── utils/supabase/
│   ├── server.ts                       # SSR server client (publishable key, user-scoped)
│   ├── client.ts                       # browser client
│   ├── middleware.ts                   # session-refresh helper
│   └── admin.ts                        # service-role client (server only)
├── middleware.ts                       # Next.js middleware: refresh session + protect routes
├── supabase/
│   ├── migrations/0001_init.sql        # tables, trigger, helper fns, RLS
│   └── seed.mjs                        # departments + super_admin
├── lib/tools/__tests__/access.test.ts  # Vitest unit tests for pure access logic
├── .env.example
├── .env.local                          # real secrets (gitignored)
├── README.md
└── (existing) docs/, Stuff_needed/
```

**Testing note:** Pure logic (registry filtering, access helpers, and later the Drive-link parser) is unit-tested with Vitest TDD. Infrastructure (migrations, RLS, SSR auth, server components) is verified with explicit commands and a scripted manual checklist — these have no meaningful unit-test seam and mocking them would test the mock, not the system.

---

## Task 1: Scaffold Next.js app + git, preserving existing files

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`, `.gitignore` (all via create-next-app)

- [ ] **Step 1: Stash existing non-scaffold files**

`create-next-app .` refuses to run in a directory containing `.env`, `docs/`, or `Stuff_needed/`. Move them aside (it tolerates `.DS_Store`).

```bash
cd /Users/vanshsood/Projects/everest
mkdir -p /tmp/everest-stash
mv .env docs Stuff_needed /tmp/everest-stash/
```

- [ ] **Step 2: Scaffold Next.js**

```bash
npx create-next-app@latest . --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --yes
```
Expected: creates `app/`, `package.json`, configs. If it prompts for Turbopack, accept the default.

- [ ] **Step 3: Restore stashed files**

```bash
mv /tmp/everest-stash/.env /tmp/everest-stash/docs /tmp/everest-stash/Stuff_needed /Users/vanshsood/Projects/everest/
```

- [ ] **Step 4: Install runtime deps + Vitest**

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest
```

- [ ] **Step 5: Add gitignore entries + Vitest script**

Ensure `.gitignore` contains (append if missing): `.env`, `.env.local`, `Stuff_needed/`. Add to `package.json` `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 6: Init git and first commit**

```bash
git init && git add -A && git commit -m "chore: scaffold Next.js app with Supabase + Tailwind"
```

- [ ] **Step 7: Verify dev server boots**

```bash
npm run build
```
Expected: build succeeds (default Next.js home page compiles).

---

## Task 2: Supabase client helpers

**Files:**
- Create: `utils/supabase/server.ts`, `utils/supabase/client.ts`, `utils/supabase/middleware.ts`, `utils/supabase/admin.ts`

- [ ] **Step 1: Server client (user-scoped, publishable key)**

Create `utils/supabase/server.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component; middleware refreshes the session.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 2: Browser client**

Create `utils/supabase/client.ts`:
```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

- [ ] **Step 3: Middleware session helper**

Create `utils/supabase/middleware.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/sign-in") || path.startsWith("/_next") || path === "/favicon.ico";
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }
  return response;
}
```

- [ ] **Step 4: Service-role admin client (server only)**

Create `utils/supabase/admin.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

// SERVER ONLY. Bypasses RLS. Never import into a client component.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add utils/supabase && git commit -m "feat: add Supabase server/client/middleware/admin helpers"
```

---

## Task 3: Database migration (tables, trigger, RLS)

**Files:**
- Create: `supabase/migrations/0001_init.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0001_init.sql`:
```sql
-- ============ Tables ============
create extension if not exists pgcrypto;

create table if not exists public.departments (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  icon       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  full_name      text,
  is_super_admin boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists public.memberships (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  role          text not null check (role in ('admin','member')),
  created_at    timestamptz not null default now(),
  unique (profile_id, department_id)
);

-- ============ New-user trigger ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS helper functions (SECURITY DEFINER → no recursion) ============
create or replace function public.is_super_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from public.profiles where id = uid), false);
$$;

create or replace function public.is_member_of(dept uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where department_id = dept and profile_id = uid);
$$;

create or replace function public.is_dept_admin(dept uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where department_id = dept and profile_id = uid and role = 'admin'
  );
$$;

grant execute on function public.is_super_admin(uuid) to anon, authenticated;
grant execute on function public.is_member_of(uuid, uuid) to anon, authenticated;
grant execute on function public.is_dept_admin(uuid, uuid) to anon, authenticated;

-- ============ RLS ============
alter table public.departments enable row level security;
alter table public.profiles    enable row level security;
alter table public.memberships enable row level security;

-- departments
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_member_of(id, auth.uid()));
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super_admin(auth.uid()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_super_admin(auth.uid()))
  with check (id = auth.uid() or public.is_super_admin(auth.uid()));

-- memberships
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_super_admin(auth.uid())
    or public.is_dept_admin(department_id, auth.uid())
  );
drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_dept_admin(department_id, auth.uid()))
  with check (public.is_super_admin(auth.uid()) or public.is_dept_admin(department_id, auth.uid()));
```

- [ ] **Step 2: Apply the migration**

Use the Postgres connection string the user provides (store it in shell var `$DB_URL`, do not commit it):
```bash
psql "$DB_URL" -f supabase/migrations/0001_init.sql
```
Expected: `CREATE TABLE`, `CREATE FUNCTION`, `CREATE POLICY` etc. with no errors.

- [ ] **Step 3: Verify tables + RLS exist**

```bash
psql "$DB_URL" -c "select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('departments','profiles','memberships');"
```
Expected: three rows, `rowsecurity = t` for each.

- [ ] **Step 4: Commit (migration file only — never the connection string)**

```bash
git add supabase/migrations/0001_init.sql && git commit -m "feat: db schema, new-user trigger, and RLS policies"
```

---

## Task 4: Seed departments + super_admin

**Files:**
- Create: `supabase/seed.mjs`

- [ ] **Step 1: Write the seed script**

Create `supabase/seed.mjs`:
```js
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_SUPER_ADMIN_EMAIL;
const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

if (!url || !serviceKey || !email || !password) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_SUPER_ADMIN_EMAIL, SEED_SUPER_ADMIN_PASSWORD");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEPARTMENTS = [
  { slug: "marketing",   name: "Marketing",   icon: "Megaphone" },
  { slug: "recruitment", name: "Recruitment", icon: "Users" },
  { slug: "finance",     name: "Finance",     icon: "Banknote" },
  { slug: "accounting",  name: "Accounting",  icon: "Calculator" },
  { slug: "operations",  name: "Operations",  icon: "Truck" },
];

async function main() {
  // 1. Departments (idempotent on slug)
  const { error: deptErr } = await admin
    .from("departments")
    .upsert(DEPARTMENTS, { onConflict: "slug" });
  if (deptErr) throw deptErr;
  console.log(`Upserted ${DEPARTMENTS.length} departments.`);

  // 2. Super admin auth user (create or find existing)
  let userId;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) {
    if (!/already/i.test(createErr.message)) throw createErr;
    const { data: list } = await admin.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === email)?.id;
    console.log("Super admin already exists; reusing.");
  } else {
    userId = created.user.id;
    console.log("Created super admin auth user.");
  }
  if (!userId) throw new Error("Could not resolve super admin user id.");

  // 3. Flag profile (trigger created the row already; upsert to be safe)
  const { error: profErr } = await admin
    .from("profiles")
    .upsert({ id: userId, email, full_name: "Super Admin", is_super_admin: true }, { onConflict: "id" });
  if (profErr) throw profErr;
  console.log("Flagged super admin profile.");
}

main().then(() => { console.log("Seed complete."); process.exit(0); })
  .catch((e) => { console.error("Seed failed:", e); process.exit(1); });
```

- [ ] **Step 2: Run the seed**

```bash
node --env-file=.env.local supabase/seed.mjs
```
Expected: "Upserted 5 departments." → "Created super admin auth user." → "Flagged super admin profile." → "Seed complete."

- [ ] **Step 3: Verify in DB**

```bash
psql "$DB_URL" -c "select count(*) from departments;"
psql "$DB_URL" -c "select email, is_super_admin from profiles;"
```
Expected: departments count 5; one profile with `is_super_admin = t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.mjs && git commit -m "feat: seed departments and super_admin"
```

---

## Task 5: Tool registry + types + pure access logic (TDD)

**Files:**
- Create: `lib/tools/types.ts`, `lib/tools/registry.ts`, `lib/auth/access.ts`, `lib/tools/__tests__/access.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write the types and registry**

Create `lib/tools/types.ts`:
```ts
export type Role = "admin" | "member";

export type ToolDef = {
  slug: string;
  name: string;
  description: string;
  departmentSlug: string;
  icon: string; // lucide icon name
  route: string;
  requiredRole?: Role; // default 'member'
};

export type DepartmentRow = {
  id: string;
  slug: string;
  name: string;
  icon: string;
};

export type Membership = {
  department_id: string;
  department_slug: string;
  role: Role;
};
```

Create `lib/tools/registry.ts`:
```ts
import type { ToolDef } from "./types";

export const TOOLS: ToolDef[] = [
  {
    slug: "scrap-scale",
    name: "Scrap Scale",
    description: "Reconcile payment screenshots against Total Fund Collection.",
    departmentSlug: "accounting",
    icon: "Scale",
    route: "/accounting/scrap-scale",
    requiredRole: "member",
  },
];
```

- [ ] **Step 2: Write the failing test for access logic**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

Create `lib/tools/__tests__/access.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { filterDepartmentsForUser, toolsForDepartment } from "../../auth/access";
import type { DepartmentRow, Membership, ToolDef } from "../types";

const depts: DepartmentRow[] = [
  { id: "1", slug: "accounting", name: "Accounting", icon: "Calculator" },
  { id: "2", slug: "marketing", name: "Marketing", icon: "Megaphone" },
];
const tools: ToolDef[] = [
  { slug: "scrap-scale", name: "Scrap Scale", description: "", departmentSlug: "accounting", icon: "Scale", route: "/accounting/scrap-scale", requiredRole: "member" },
  { slug: "admin-only", name: "Admin Only", description: "", departmentSlug: "accounting", icon: "Lock", route: "/accounting/admin-only", requiredRole: "admin" },
];

describe("filterDepartmentsForUser", () => {
  it("super_admin sees all departments", () => {
    expect(filterDepartmentsForUser(depts, [], true).map((d) => d.slug)).toEqual(["accounting", "marketing"]);
  });
  it("member sees only their departments", () => {
    const m: Membership[] = [{ department_id: "1", department_slug: "accounting", role: "member" }];
    expect(filterDepartmentsForUser(depts, m, false).map((d) => d.slug)).toEqual(["accounting"]);
  });
});

describe("toolsForDepartment", () => {
  it("member sees only member-level tools", () => {
    const result = toolsForDepartment(tools, "accounting", "member", false);
    expect(result.map((t) => t.slug)).toEqual(["scrap-scale"]);
  });
  it("dept admin sees admin tools too", () => {
    const result = toolsForDepartment(tools, "accounting", "admin", false);
    expect(result.map((t) => t.slug)).toEqual(["scrap-scale", "admin-only"]);
  });
  it("super_admin sees all tools regardless of role", () => {
    const result = toolsForDepartment(tools, "accounting", null, true);
    expect(result.map((t) => t.slug)).toEqual(["scrap-scale", "admin-only"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test
```
Expected: FAIL — cannot find module `../../auth/access`.

- [ ] **Step 4: Implement the access logic**

Create `lib/auth/access.ts`:
```ts
import type { DepartmentRow, Membership, Role, ToolDef } from "../tools/types";

export function filterDepartmentsForUser(
  departments: DepartmentRow[],
  memberships: Membership[],
  isSuperAdmin: boolean,
): DepartmentRow[] {
  if (isSuperAdmin) return departments;
  const allowed = new Set(memberships.map((m) => m.department_slug));
  return departments.filter((d) => allowed.has(d.slug));
}

export function toolsForDepartment(
  tools: ToolDef[],
  departmentSlug: string,
  role: Role | null,
  isSuperAdmin: boolean,
): ToolDef[] {
  return tools.filter((t) => {
    if (t.departmentSlug !== departmentSlug) return false;
    if (isSuperAdmin) return true;
    const required = t.requiredRole ?? "member";
    if (required === "admin") return role === "admin";
    return role === "admin" || role === "member";
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test
```
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add lib vitest.config.ts && git commit -m "feat: tool registry, types, and tested access logic"
```

---

## Task 6: Auth guards + Next.js middleware + sign-in

**Files:**
- Create: `lib/auth/guards.ts`, `middleware.ts`, `app/sign-in/page.tsx`, `app/sign-in/actions.ts`, `app/account/actions.ts`

- [ ] **Step 1: Wire Next.js middleware**

Create `middleware.ts` (repo root):
```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 2: Server-side guards**

Create `lib/auth/guards.ts`:
```ts
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import type { DepartmentRow, Membership, Role } from "@/lib/tools/types";

export type CurrentUser = {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  memberships: Membership[];
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles").select("is_super_admin").eq("id", user.id).single();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("department_id, role, departments(slug)")
    .eq("profile_id", user.id);

  return {
    id: user.id,
    email: user.email ?? "",
    isSuperAdmin: profile?.is_super_admin ?? false,
    memberships: (memberships ?? []).map((m: any) => ({
      department_id: m.department_id,
      department_slug: m.departments?.slug ?? "",
      role: m.role as Role,
    })),
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** Returns the user's role in the department, or 'super' for super_admin. Redirects to '/' if no access. */
export async function requireDepartmentAccess(
  departmentSlug: string,
): Promise<{ user: CurrentUser; role: Role | "super"; department: DepartmentRow }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: dept } = await supabase
    .from("departments").select("id, slug, name, icon").eq("slug", departmentSlug).single();
  if (!dept) redirect("/");

  if (user.isSuperAdmin) return { user, role: "super", department: dept as DepartmentRow };
  const m = user.memberships.find((x) => x.department_slug === departmentSlug);
  if (!m) redirect("/");
  return { user, role: m.role, department: dept as DepartmentRow };
}
```

- [ ] **Step 3: Sign-in server action**

Create `app/sign-in/actions.ts`:
```ts
"use server";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect("/");
}
```

- [ ] **Step 4: Sign-in page**

Create `app/sign-in/page.tsx`:
```tsx
"use client";
import { useActionState } from "react";
import { signIn } from "./actions";

export default function SignInPage() {
  const [state, action, pending] = useActionState(signIn, null as { error: string } | null);
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Everest Internal Tools</h1>
        <input name="email" type="email" required placeholder="Email"
          className="w-full rounded-md border px-3 py-2 text-sm" />
        <input name="password" type="password" required placeholder="Password"
          className="w-full rounded-md border px-3 py-2 text-sm" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-xs text-gray-500">Accounts are created by an administrator.</p>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Account actions (sign out + change password)**

Create `app/account/actions.ts`:
```ts
"use server";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

export async function changePassword(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: true };
}
```

- [ ] **Step 6: Verify build + middleware compile**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/guards.ts middleware.ts app/sign-in app/account && git commit -m "feat: auth guards, middleware route protection, sign-in"
```

---

## Task 7: Authed shell layout + sidebar

**Files:**
- Create: `app/(app)/layout.tsx`, `components/Sidebar.tsx`
- Modify: `app/layout.tsx` (ensure Tailwind + metadata)

- [ ] **Step 1: Sidebar component**

Create `components/Sidebar.tsx`:
```tsx
import Link from "next/link";
import { signOut } from "@/app/account/actions";
import type { DepartmentRow } from "@/lib/tools/types";

export function Sidebar({
  departments, email, isSuperAdmin,
}: { departments: DepartmentRow[]; email: string; isSuperAdmin: boolean }) {
  return (
    <aside className="flex w-60 flex-col border-r bg-white">
      <div className="border-b px-5 py-4">
        <Link href="/" className="text-sm font-semibold text-gray-900">Everest Tools</Link>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {departments.map((d) => (
          <Link key={d.slug} href={`/${d.slug}`}
            className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
            {d.name}
          </Link>
        ))}
        {isSuperAdmin && (
          <Link href="/admin"
            className="mt-2 block rounded-md px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
            Admin
          </Link>
        )}
      </nav>
      <div className="border-t px-3 py-3">
        <p className="truncate px-2 text-xs text-gray-500">{email}</p>
        <form action={signOut}>
          <button className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Authed layout (route group)**

Create `app/(app)/layout.tsx`:
```tsx
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/utils/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { filterDepartmentsForUser } from "@/lib/auth/access";
import type { DepartmentRow } from "@/lib/tools/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: allDepts } = await supabase.from("departments").select("id, slug, name, icon").order("name");
  const visible = filterDepartmentsForUser(
    (allDepts ?? []) as DepartmentRow[], user.memberships, user.isSuperAdmin,
  );
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar departments={visible} email={user.email} isSuperAdmin={user.isSuperAdmin} />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Move dashboard/department/tool/admin routes under the (app) group**

The route group `(app)` does not affect URLs. In later tasks, `page.tsx` files for `/`, `/[department]`, `/[department]/[tool]`, and `/admin` are created **inside** `app/(app)/` so they inherit this layout. (Sign-in stays outside the group.)

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app components && git commit -m "feat: authed shell layout with sidebar"
```

---

## Task 8: Dashboard, department, and tool pages

**Files:**
- Create: `app/(app)/page.tsx`, `app/(app)/[department]/page.tsx`, `app/(app)/[department]/[tool]/page.tsx`
- Create: `components/DepartmentCard.tsx`, `components/ToolCard.tsx`
- Remove: the default `app/page.tsx` created by scaffold (replaced by `app/(app)/page.tsx`)

- [ ] **Step 1: Remove scaffold home page**

```bash
rm -f app/page.tsx
```
(The dashboard now lives at `app/(app)/page.tsx`.)

- [ ] **Step 2: Card components**

Create `components/DepartmentCard.tsx`:
```tsx
import Link from "next/link";

export function DepartmentCard({ slug, name, toolCount }: { slug: string; name: string; toolCount: number }) {
  return (
    <Link href={`/${slug}`}
      className="block rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md">
      <h3 className="text-base font-semibold text-gray-900">{name}</h3>
      <p className="mt-1 text-sm text-gray-500">{toolCount} tool{toolCount === 1 ? "" : "s"}</p>
    </Link>
  );
}
```

Create `components/ToolCard.tsx`:
```tsx
import Link from "next/link";

export function ToolCard({ name, description, route }: { name: string; description: string; route: string }) {
  return (
    <Link href={route} className="block rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md">
      <h3 className="text-base font-semibold text-gray-900">{name}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </Link>
  );
}
```

- [ ] **Step 3: Dashboard page**

Create `app/(app)/page.tsx`:
```tsx
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/utils/supabase/server";
import { filterDepartmentsForUser, toolsForDepartment } from "@/lib/auth/access";
import { TOOLS } from "@/lib/tools/registry";
import { DepartmentCard } from "@/components/DepartmentCard";
import type { DepartmentRow } from "@/lib/tools/types";

export default async function Dashboard() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: allDepts } = await supabase.from("departments").select("id, slug, name, icon").order("name");
  const visible = filterDepartmentsForUser((allDepts ?? []) as DepartmentRow[], user.memberships, user.isSuperAdmin);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Departments</h1>
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">You have no department access yet. Ask an administrator to add you.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((d) => {
            const role = user.isSuperAdmin ? null : user.memberships.find((m) => m.department_slug === d.slug)?.role ?? null;
            const count = toolsForDepartment(TOOLS, d.slug, role, user.isSuperAdmin).length;
            return <DepartmentCard key={d.slug} slug={d.slug} name={d.name} toolCount={count} />;
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Department page**

Create `app/(app)/[department]/page.tsx`:
```tsx
import { requireDepartmentAccess } from "@/lib/auth/guards";
import { toolsForDepartment } from "@/lib/auth/access";
import { TOOLS } from "@/lib/tools/registry";
import { ToolCard } from "@/components/ToolCard";

export default async function DepartmentPage({ params }: { params: Promise<{ department: string }> }) {
  const { department } = await params;
  const { role } = await requireDepartmentAccess(department);
  const isSuper = role === "super";
  const tools = toolsForDepartment(TOOLS, department, isSuper ? null : role, isSuper);
  const deptName = department.charAt(0).toUpperCase() + department.slice(1);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">{deptName}</h1>
      {tools.length === 0 ? (
        <p className="text-sm text-gray-500">No tools available in this department yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <ToolCard key={t.slug} name={t.name} description={t.description} route={t.route} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Generic tool page (guard + registry lookup)**

Create `app/(app)/[department]/[tool]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { requireDepartmentAccess } from "@/lib/auth/guards";
import { toolsForDepartment } from "@/lib/auth/access";
import { TOOLS } from "@/lib/tools/registry";

export default async function ToolPage({ params }: { params: Promise<{ department: string; tool: string }> }) {
  const { department, tool } = await params;
  const { role } = await requireDepartmentAccess(department);
  const isSuper = role === "super";
  const allowed = toolsForDepartment(TOOLS, department, isSuper ? null : role, isSuper);
  const def = allowed.find((t) => t.slug === tool);
  if (!def) notFound();

  // v1: the only tool is Scrap Scale, rendered as a stub. Real components are added per-tool later.
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-gray-900">{def.name}</h1>
      <p className="mb-6 text-sm text-gray-500">{def.description}</p>
      <div className="rounded-xl border border-dashed bg-white p-12 text-center text-gray-400">
        Coming soon.
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```
Expected: build succeeds; routes `/`, `/[department]`, `/[department]/[tool]` listed.

- [ ] **Step 7: Commit**

```bash
git add app components && git commit -m "feat: dashboard, department, and tool pages from registry"
```

---

## Task 9: Admin page — users + memberships (super_admin only)

**Files:**
- Create: `app/(app)/admin/page.tsx`, `app/(app)/admin/actions.ts`, `components/admin/AdminUserManager.tsx`

- [ ] **Step 1: Admin server actions**

Create `app/(app)/admin/actions.ts`:
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

function tempPassword() {
  // simple readable temp password; admin hands it off, user changes it.
  return "Everest-" + Math.abs(hashStr(Date.now().toString())).toString(36) + "-Aa1";
}
function hashStr(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

export async function createUser(_prev: unknown, formData: FormData) {
  await assertSuperAdmin();
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!email) return { error: "Email required." };
  const admin = createAdminClient();
  const password = tempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error) return { error: error.message };
  await admin.from("profiles").update({ full_name: fullName }).eq("id", data.user.id);
  revalidatePath("/admin");
  return { ok: true, tempPassword: password, email };
}

export async function setMembership(_prev: unknown, formData: FormData) {
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
  return { ok: true };
}
```

- [ ] **Step 2: Admin page (data load, super_admin guard)**

Create `app/(app)/admin/page.tsx`:
```tsx
import { requireUser } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { AdminUserManager } from "@/components/admin/AdminUserManager";

export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/");

  const admin = createAdminClient();
  const { data: profiles } = await admin.from("profiles").select("id, email, full_name, is_super_admin").order("email");
  const { data: departments } = await admin.from("departments").select("id, slug, name").order("name");
  const { data: memberships } = await admin.from("memberships").select("profile_id, department_id, role");

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Admin · Users & Access</h1>
      <AdminUserManager
        profiles={profiles ?? []}
        departments={departments ?? []}
        memberships={memberships ?? []}
      />
    </div>
  );
}
```

- [ ] **Step 3: Admin client component**

Create `components/admin/AdminUserManager.tsx`:
```tsx
"use client";
import { useActionState } from "react";
import { createUser, setMembership } from "@/app/(app)/admin/actions";

type Profile = { id: string; email: string; full_name: string | null; is_super_admin: boolean };
type Dept = { id: string; slug: string; name: string };
type Mem = { profile_id: string; department_id: string; role: string };

export function AdminUserManager({ profiles, departments, memberships }:
  { profiles: Profile[]; departments: Dept[]; memberships: Mem[] }) {
  const [createState, createAction, creating] = useActionState(createUser, null as any);

  const roleFor = (pid: string, did: string) =>
    memberships.find((m) => m.profile_id === pid && m.department_id === did)?.role ?? "none";

  return (
    <div className="space-y-8">
      <section className="rounded-xl border bg-white p-6">
        <h2 className="mb-4 text-lg font-medium">Add user</h2>
        <form action={createAction} className="flex flex-wrap items-end gap-3">
          <input name="email" type="email" required placeholder="email@everestfleet.in"
            className="rounded-md border px-3 py-2 text-sm" />
          <input name="full_name" placeholder="Full name" className="rounded-md border px-3 py-2 text-sm" />
          <button disabled={creating} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>
        {createState?.error && <p className="mt-2 text-sm text-red-600">{createState.error}</p>}
        {createState?.ok && (
          <p className="mt-2 rounded bg-green-50 p-3 text-sm text-green-800">
            Created <b>{createState.email}</b>. Temp password: <code className="font-mono">{createState.tempPassword}</code> — share it once; the user should change it.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-white p-6">
        <h2 className="mb-4 text-lg font-medium">Memberships</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="px-2 py-2">User</th>
                {departments.map((d) => <th key={d.id} className="px-2 py-2">{d.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-2 py-2">{p.email}{p.is_super_admin && <span className="ml-1 text-xs text-indigo-600">(super)</span>}</td>
                  {departments.map((d) => (
                    <td key={d.id} className="px-2 py-2">
                      <form action={setMembership}>
                        <input type="hidden" name="profile_id" value={p.id} />
                        <input type="hidden" name="department_id" value={d.id} />
                        <select name="role" defaultValue={roleFor(p.id, d.id)}
                          onChange={(e) => e.currentTarget.form?.requestSubmit()}
                          className="rounded border px-2 py-1 text-xs">
                          <option value="none">—</option>
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      </form>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app components && git commit -m "feat: super_admin page for users and memberships"
```

---

## Task 10: Env, README, and end-to-end verification

**Files:**
- Create: `.env.example`, `README.md`
- Modify: `.env.local` (real values — not committed)

- [ ] **Step 1: `.env.example`**

Create `.env.example`:
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server only — never exposed to client

# Seed (used only by supabase/seed.mjs)
SEED_SUPER_ADMIN_EMAIL=vansh.sood@everestfleet.in
SEED_SUPER_ADMIN_PASSWORD=

# --- Reserved for later tools (Scrap Scale etc.); not used by the shell ---
# GEMINI_API_KEY=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/oauth/callback
# TOKEN_ENCRYPTION_KEY=
```

- [ ] **Step 2: Create `.env.local` with the real Supabase values**

Populate `.env.local` (gitignored) with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SEED_SUPER_ADMIN_EMAIL=vansh.sood@everestfleet.in`, and a chosen `SEED_SUPER_ADMIN_PASSWORD`.

- [ ] **Step 3: README**

Create `README.md` with: project overview; prerequisites (Node 20+, psql); env var table; how to apply migrations (`psql "$DB_URL" -f supabase/migrations/0001_init.sql`); how to seed (`node --env-file=.env.local supabase/seed.mjs`); how to run (`npm run dev`); how RLS/RBAC works (helper functions, two-layer guard); **how to add a new tool** (add a `ToolDef` to `lib/tools/registry.ts`; if it needs a custom page, create `app/(app)/[department]/[tool]/`-equivalent or a dedicated route and render it from the registry); the **admin-only user creation** flow; and a note to **disable public sign-ups** in Supabase Auth settings and to **rotate the service-role key** after setup.

- [ ] **Step 4: Run the app and verify end-to-end**

```bash
npm run dev
```
Then manually (or via the `verify` skill):
1. Visit `/` unauthenticated → redirected to `/sign-in`.
2. Sign in as `vansh.sood@everestfleet.in` → dashboard shows **all 5** department cards.
3. Open **Accounting** → see **Scrap Scale** card → open it → "Coming soon" stub.
4. Go to `/admin` → create a test user → assign them **member** of Marketing only.
5. Sign out, sign in as the test user → dashboard shows **only Marketing**; visiting `/accounting` redirects to `/`.

- [ ] **Step 5: Final commit**

```bash
git add .env.example README.md && git commit -m "docs: env example and README; shell v1 complete"
```

---

## Self-Review

**Spec coverage:**
- Stack (Next.js/Supabase/Tailwind/Supabase-Auth) → Tasks 1, 2, 6. ✓
- Schema departments/profiles/memberships + trigger → Task 3. ✓
- RLS with non-recursive helper functions + two-layer guard → Tasks 3 (RLS) + 6 (guards) + 8 (page guards). ✓
- Admin-only user creation, no public sign-up → Task 9 (createUser) + Task 6 (no /sign-up route) + Task 10 (README note to disable signups). ✓
- Tool registry pluggable; dashboard/department derive from it → Tasks 5, 8. ✓
- Single Scrap Scale placeholder under Accounting → Task 5 (registry) + Task 8 (stub render). ✓
- `/admin` membership management super_admin only → Task 9. ✓
- Seed 5 departments + super_admin vansh.sood@everestfleet.in → Task 4. ✓
- `.env.example`, README, migrations → Tasks 3, 10. ✓
- Service-role key server-only → Task 2 (admin.ts comment) + used only in Tasks 4, 9. ✓

**Placeholder scan:** No TBD/TODO. Every code step has complete code. README content (Task 10 Step 3) is described as concrete required sections rather than full prose — acceptable for a docs step; the engineer writes prose from the listed contents.

**Type consistency:** `ToolDef`, `DepartmentRow`, `Membership`, `Role` defined in Task 5 `lib/tools/types.ts`; `filterDepartmentsForUser`/`toolsForDepartment` signatures match between test (Task 5 Step 2), implementation (Step 4), and callers (Tasks 7, 8). `requireDepartmentAccess` returns `role: Role | "super"`, consumed consistently in Tasks 8. `createAdminClient`/`createClient` names consistent across Tasks 2, 6, 7, 8, 9.

**Note on RLS vs admin client:** Task 9 deliberately uses the service-role admin client for the admin page reads/writes (super_admin gate is enforced server-side in the page + actions). This is consistent with the spec (§6: service-role used only in seed + admin user-creation handler). Regular department/dashboard pages (Tasks 7, 8) use the user-scoped client so RLS is the enforcer.
