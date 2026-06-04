import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { GRID_EXPORT_HEADERS, gridToRows, rowsToCsv } from "@/lib/lender/exportRows";
import { buildUnifiedGrid } from "@/lib/lender/grid";

// Exports the current unified tracker (imported sheet + merged email findings) for the department.
export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  await params; // runId is part of the route shape but the export is the department's unified grid.
  const { departmentId } = await requireFinance();
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const db = createAdminClient();

  const grid = await buildUnifiedGrid(db, departmentId);
  const rows = gridToRows(grid);

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Lender Pendencies");
    ws.addRow(GRID_EXPORT_HEADERS);
    rows.forEach((r) => ws.addRow(r));
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="lender-pendencies.xlsx"`,
      },
    });
  }

  const csv = rowsToCsv(GRID_EXPORT_HEADERS, rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lender-pendencies.csv"`,
    },
  });
}
