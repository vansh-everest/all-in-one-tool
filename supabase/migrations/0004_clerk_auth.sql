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
