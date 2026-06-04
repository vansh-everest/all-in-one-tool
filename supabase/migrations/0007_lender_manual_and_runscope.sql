-- 0007 — manual tracker items + run-scoping the message cache. Idempotent.

create table if not exists public.lender_manual_items (
  id               uuid primary key default gen_random_uuid(),
  department_id    uuid not null references public.departments(id) on delete cascade,
  lender_id        uuid references public.lenders(id) on delete cascade,
  item             text not null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists lender_manual_items_dept_idx on public.lender_manual_items(department_id);
alter table public.lender_manual_items enable row level security;

-- Tag each cached message with the run that last matched it, so a run's findings
-- (including matched threads that yielded no task) can be reconstructed.
alter table public.lender_message_cache add column if not exists run_id uuid;
