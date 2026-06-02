import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAccounting();
  const supabase = await createClient();
  const { data: run } = await supabase.from("scrap_scale_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: rows } = await supabase
    .from("scrap_scale_run_rows")
    .select("*")
    .eq("run_id", runId)
    .order("row_index");
  return NextResponse.json({ run, rows: rows ?? [] });
}
