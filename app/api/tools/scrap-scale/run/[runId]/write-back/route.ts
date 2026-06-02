import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { readValues, addResultsTab, writeValues } from "@/lib/google/sheets";

function tabName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `ScrapScale ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireAccounting();
  const supabase = await createClient();
  const { data: run } = await supabase.from("scrap_scale_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { accessToken } = await getAccessToken(departmentId, SCRAP_SCALE_SCOPES);

  // Read the original tab; append 3 columns onto a copy written to a NEW tab.
  const original = await readValues(run.spreadsheet_id, run.sheet_title, accessToken);
  const { data: rows } = await supabase
    .from("scrap_scale_run_rows")
    .select("row_index, extracted_amount, difference, flagged")
    .eq("run_id", runId)
    .order("row_index");
  const byIndex = new Map((rows ?? []).map((r) => [r.row_index, r]));

  const out: (string | number | null)[][] = original.map((row, i) => {
    if (i === 0) return [...row, "Extracted Values", "Difference", "Flag"];
    const r = byIndex.get(i); // data row i corresponds to row_index i
    return [...row, r?.extracted_amount ?? "", r?.difference ?? "", r?.flagged ? "FLAGGED" : "OK"];
  });

  const name = tabName(new Date());
  await addResultsTab(run.spreadsheet_id, name, accessToken);
  await writeValues(run.spreadsheet_id, name, out, accessToken);
  await supabase.from("scrap_scale_runs").update({ results_tab_name: name }).eq("id", runId);

  return NextResponse.json({ resultsTab: name });
}
