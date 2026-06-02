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
