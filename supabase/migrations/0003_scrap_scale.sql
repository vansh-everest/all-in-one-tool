create table if not exists public.ocr_cache (
  file_id       text primary key,
  department_id uuid not null references public.departments(id) on delete cascade,
  amount        numeric,
  currency      text,
  txn_id        text,
  date          text,
  confidence    numeric,
  raw_json      jsonb,
  fetched_at    timestamptz not null default now()
);

create table if not exists public.scrap_scale_runs (
  id               uuid primary key default gen_random_uuid(),
  department_id    uuid not null references public.departments(id) on delete cascade,
  created_by       uuid references public.profiles(id) on delete set null,
  spreadsheet_id   text not null,
  sheet_title      text,
  detected_columns jsonb,
  status           text not null default 'pending'
                     check (status in ('pending','reading','processing','writing','done','error')),
  total_rows       int not null default 0,
  processed_rows   int not null default 0,
  summary          jsonb,
  results_tab_name text,
  error            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.scrap_scale_run_rows (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.scrap_scale_runs(id) on delete cascade,
  row_index        int not null,
  submitted_by     text,
  links            text[] not null default '{}',
  expected_amount  numeric,
  extracted_amount numeric,
  difference       numeric,
  flagged          boolean,
  duplicate        boolean not null default false,
  status           text not null default 'pending'
                     check (status in ('ok','needs-review','note-row','pending')),
  ocr_details      jsonb,
  unique (run_id, row_index)
);
create index if not exists scrap_scale_run_rows_run_idx on public.scrap_scale_run_rows(run_id);
create index if not exists scrap_scale_runs_sheet_idx on public.scrap_scale_runs(spreadsheet_id);

alter table public.ocr_cache            enable row level security;
alter table public.scrap_scale_runs     enable row level security;
alter table public.scrap_scale_run_rows enable row level security;

drop policy if exists ocr_cache_rw on public.ocr_cache;
create policy ocr_cache_rw on public.ocr_cache for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()))
  with check (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()));

drop policy if exists runs_rw on public.scrap_scale_runs;
create policy runs_rw on public.scrap_scale_runs for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()))
  with check (public.is_super_admin(auth.uid()) or public.is_member_of(department_id, auth.uid()));

drop policy if exists run_rows_rw on public.scrap_scale_run_rows;
create policy run_rows_rw on public.scrap_scale_run_rows for all to authenticated
  using (exists (
    select 1 from public.scrap_scale_runs r
    where r.id = run_id and (public.is_super_admin(auth.uid()) or public.is_member_of(r.department_id, auth.uid()))
  ))
  with check (exists (
    select 1 from public.scrap_scale_runs r
    where r.id = run_id and (public.is_super_admin(auth.uid()) or public.is_member_of(r.department_id, auth.uid()))
  ));
