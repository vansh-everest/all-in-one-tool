import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAccounting } from "@/lib/scrap-scale/access";

const HEADERS = ["Row", "Submitted By", "Links", "Expected", "Extracted", "Difference", "Flag", "Duplicate", "Status"];

function toRow(r: Record<string, unknown>): (string | number)[] {
  return [
    r.row_index as number,
    (r.submitted_by as string) ?? "",
    ((r.links as string[]) ?? []).join(" | "),
    Number(r.expected_amount ?? 0),
    Number(r.extracted_amount ?? 0),
    Number(r.difference ?? 0),
    r.flagged ? "FLAGGED" : "OK",
    r.duplicate ? "DUPLICATE" : "",
    r.status as string,
  ];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAccounting();
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const supabase = createAdminClient();
  const { data: rows } = await supabase
    .from("scrap_scale_run_rows")
    .select("*")
    .eq("run_id", runId)
    .order("row_index");
  const data = (rows ?? []).map(toRow);

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Scrap Scale");
    ws.addRow(HEADERS);
    data.forEach((d) => ws.addRow(d));
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="scrap-scale-${runId}.xlsx"`,
      },
    });
  }

  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [HEADERS, ...data].map((r) => r.map(esc).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="scrap-scale-${runId}.csv"`,
    },
  });
}
