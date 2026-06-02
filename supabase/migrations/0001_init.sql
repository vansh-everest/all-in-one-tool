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

-- ============ RLS helper functions (SECURITY DEFINER -> no recursion) ============
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
