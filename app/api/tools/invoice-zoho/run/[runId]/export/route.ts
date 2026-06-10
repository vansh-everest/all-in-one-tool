import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { buildZohoWorkbook } from "@/lib/invoice/excel";
import type { MappedRow } from "@/lib/invoice/mapping";

// Exports this run's mapped rows as a Zoho-ready purchase-bill workbook.
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireAccounting();
  const db = createAdminClient();

  const { data: run } = await db
    .from("invoice_runs")
    .select("id")
    .eq("id", runId)
    .eq("department_id", departmentId)
    .single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: rows } = await db
    .from("invoice_rows")
    .select("mapped")
    .eq("run_id", runId)
    .order("created_at");

  const mappedRows: MappedRow[] = (rows ?? [])
    .map((r) => r.mapped as MappedRow | null)
    .filter((m): m is MappedRow => !!m);

  const buf = await buildZohoWorkbook(mappedRows);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="zoho-purchase-bills.xlsx"`,
    },
  });
}
