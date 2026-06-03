import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAccounting, requireAccountingAdmin } from "@/lib/scrap-scale/access";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAccounting();
  const supabase = createAdminClient();
  const { data: run } = await supabase.from("scrap_scale_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: rows } = await supabase
    .from("scrap_scale_run_rows")
    .select("*")
    .eq("run_id", runId)
    .order("row_index");
  return NextResponse.json({ run, rows: rows ?? [] });
}

// Admin-only: permanently delete a run (and its rows, via FK cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  let departmentId: string;
  try {
    ({ departmentId } = await requireAccountingAdmin());
  } catch {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const supabase = createAdminClient();
  // Scope the delete to the caller's department so an admin can't remove
  // another department's runs by guessing an id.
  const { data: deleted, error } = await supabase
    .from("scrap_scale_runs")
    .delete()
    .eq("id", runId)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: runId });
}
