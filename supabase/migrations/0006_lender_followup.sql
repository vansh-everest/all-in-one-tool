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
