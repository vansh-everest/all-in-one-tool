import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { EXPORT_HEADERS, trackerToRows, rowsToCsv } from "@/lib/lender/exportRows";
import { aggregateTracker } from "@/lib/lender/aggregate";
import type { Lender, Extraction } from "@/lib/lender/types";
import { appendLenderActivity } from "@/lib/lender/activity";

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireFinance();
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("worklist").eq("id", runId).single();
  const worklist: string[] = Array.isArray(run?.worklist) ? run!.worklist : [];
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = (lendersData ?? []) as Lender[];
  const { data: cacheRows } = await db
    .from("lender_message_cache")
    .select("lender_id, extraction")
    .eq("department_id", departmentId)
    .in("message_id", worklist.length ? worklist : ["__none__"]);
  const byMessage = (cacheRows ?? [])
    .filter((r) => r.lender_id)
    .map((r) => ({ lenderId: r.lender_id as string, extraction: (r.extraction ?? { items: [], last_contact_date: null }) as Extraction }));
  const tracker = aggregateTracker(lenders, byMessage);
  const rows = trackerToRows(tracker);

  await appendLenderActivity(db, runId, `Exported ${format.toUpperCase()} (${rows.length} items)`);

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Lender Pendencies");
    ws.addRow(EXPORT_HEADERS);
    rows.forEach((r) => ws.addRow(r));
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="lender-pendencies-${runId}.xlsx"`,
      },
    });
  }

  const csv = rowsToCsv(EXPORT_HEADERS, rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lender-pendencies-${runId}.csv"`,
    },
  });
}
