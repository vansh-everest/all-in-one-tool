import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance, requireFinanceAdmin } from "@/lib/lender/access";
import { buildRunFindings } from "@/lib/lender/grid";

// Run detail: the matched email threads for this run (vendor, subject, date, tasks).
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireFinance();
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("id, status, created_at, created_by_email, counts").eq("id", runId).eq("department_id", departmentId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const findings = await buildRunFindings(db, departmentId, runId);
  return NextResponse.json({ run, findings });
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
    .from("lender_runs")
    .delete()
    .eq("id", runId)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: runId });
}
