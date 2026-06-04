-- 0008 — unified editable tracker items (the grid's single source of truth). Idempotent.
-- Every cell in the grid is a row here: sheet imports, email-found tasks, and manual adds.

create table if not exists public.lender_items (
  id                uuid primary key default gen_random_uuid(),
  department_id     uuid not null references public.departments(id) on delete cascade,
  lender_id         uuid references public.lenders(id) on delete cascade,
  position          int not null default 0,
  text              text not null default '',
  source            text not null default 'manual',  -- sheet | email | manual
  source_message_id text,
  email_date        timestamptz,
  done              boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists lender_items_dept_idx on public.lender_items(department_id);
create index if not exists lender_items_lender_idx on public.lender_items(lender_id);
alter table public.lender_items enable row level security;
