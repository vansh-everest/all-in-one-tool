import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance, requireFinanceAdmin } from "@/lib/lender/access";

// Run detail: the run plus its mapped invoice rows (ordered for the grid).
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireFinance();
  const db = createAdminClient();

  const { data: run } = await db
    .from("invoice_runs")
    .select("*")
    .eq("id", runId)
    .eq("department_id", departmentId)
    .single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: rows } = await db
    .from("invoice_rows")
    .select("*")
    .eq("run_id", runId)
    .order("created_at");

  return NextResponse.json({ run, rows: rows ?? [] });
}

// Admin-only: delete a run (and its rows via cascade).
export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  let departmentId: string;
  try {
    ({ departmentId } = await requireFinanceAdmin());
  } catch {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from("invoice_runs")
    .delete()
    .eq("id", runId)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: runId });
}
