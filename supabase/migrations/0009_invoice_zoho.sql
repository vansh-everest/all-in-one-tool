-- 0009_invoice_zoho.sql — Invoice → Zoho purchase-bill tool (Finance). Idempotent.

create table if not exists public.invoice_mapping_profiles (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name          text not null,
  constants     jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.invoice_config (
  department_id uuid primary key references public.departments(id) on delete cascade,
  gmail_label   text,
  profile_id    uuid references public.invoice_mapping_profiles(id) on delete set null,
  last_run_date date,
  updated_at    timestamptz not null default now()
);

create table if not exists public.invoice_runs (
  id                 uuid primary key default gen_random_uuid(),
  department_id      uuid not null references public.departments(id) on delete cascade,
  created_by_email   text,
  status             text not null default 'running',
  label              text,
  since_date         date,
  worklist           jsonb not null default '[]'::jsonb,
  cursor             int not null default 0,
  counts             jsonb not null default '{}'::jsonb,
  summary            jsonb,
  activities         jsonb not null default '[]'::jsonb,
  last_internal_date timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists public.invoice_processed (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  message_id    text not null,
  attachment_id text not null default '',
  run_id        uuid,
  processed_at  timestamptz not null default now(),
  unique (department_id, message_id, attachment_id)
);

create table if not exists public.invoice_rows (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.invoice_runs(id) on delete cascade,
  department_id     uuid not null references public.departments(id) on delete cascade,
  source_message_id text,
  attachment_id     text,
  file_name         text,
  mime_type         text,
  ocr               jsonb,
  mapped            jsonb,
  flags             text[] not null default '{}',
  confidence        numeric,
  grand_total       numeric,
  reconciled        boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists invoice_rows_run_idx on public.invoice_rows(run_id);

alter table public.invoice_mapping_profiles enable row level security;
alter table public.invoice_config           enable row level security;
alter table public.invoice_runs             enable row level security;
alter table public.invoice_processed        enable row level security;
alter table public.invoice_rows             enable row level security;
