-- 0005_run_activity_and_date.sql
-- Track who ran a reconciliation and a per-run activity log, plus capture the
-- "Scrap Sold Date" per row for display/export.

alter table public.scrap_scale_runs
  add column if not exists created_by_email text,
  add column if not exists activities jsonb not null default '[]'::jsonb;

alter table public.scrap_scale_run_rows
  add column if not exists scrap_sold_date text;
