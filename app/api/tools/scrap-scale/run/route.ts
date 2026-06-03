import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { readValues } from "@/lib/google/sheets";
import { parseDriveFileIds } from "@/lib/scrap-scale/links";
import { rowPassesFilters, type ColumnFilter } from "@/lib/scrap-scale/filters";

export async function POST(req: NextRequest) {
  try {
    const { departmentId, userId, email } = await requireAccounting();
    const { spreadsheetId, sheetTab, columns, filters } = await req.json();
    if (!spreadsheetId || !columns?.link) {
      return NextResponse.json({ error: "Missing spreadsheet or link column." }, { status: 400 });
    }
    const activeFilters: ColumnFilter[] = Array.isArray(filters) ? filters : [];

    let accessToken: string;
    try {
      ({ accessToken } = await getAccessToken(userId, SCRAP_SCALE_SCOPES));
    } catch (e) {
      if (e instanceof ReconsentRequired) return NextResponse.json({ error: "reconsent_required" }, { status: 409 });
      throw e;
    }

    const values = await readValues(spreadsheetId, sheetTab, accessToken);
    const dataRows = values.slice(1);
    const supabase = createAdminClient();

    // Keep each data row's original sheet position (1-based, excluding the
    // header) so write-back can line results back up with the source tab, then
    // drop rows that don't match the user's column filters.
    const rows = dataRows
      .map((row, i) => ({ row, pos: i + 1 }))
      .filter(({ row }) => rowPassesFilters(row, activeFilters))
      .map(({ row, pos }) => {
        const links = parseDriveFileIds(row[columns.link.index] ?? "");
        const expectedRaw = columns.expected ? row[columns.expected.index] ?? "" : "";
        const expected = expectedRaw === "" ? null : Number(String(expectedRaw).replace(/[^0-9.\-]/g, "")) || null;
        return {
          run_id: "",
          row_index: pos,
          submitted_by: columns.name ? row[columns.name.index] ?? null : null,
          scrap_sold_date: columns.date ? row[columns.date.index] ?? null : null,
          links,
          expected_amount: expected,
          status: links.length === 0 ? "note-row" : "pending",
        };
      });

    const noteRows = rows.filter((r) => r.status === "note-row").length;
    const now = new Date().toISOString();
    const activities = [
      { at: now, message: `Run started by ${email}` },
      {
        at: now,
        message: `Columns — link: "${columns.link?.header ?? "—"}", expected: "${columns.expected?.header ?? "—"}", date: "${columns.date?.header ?? "—"}"`,
      },
      { at: now, message: activeFilters.length ? `${activeFilters.length} filter(s) applied` : "No filters applied" },
      { at: now, message: `${rows.length} rows queued (${noteRows} note rows with no link)` },
    ];

    const { data: run, error: runErr } = await supabase
      .from("scrap_scale_runs")
      .insert({
        department_id: departmentId,
        created_by: userId,
        created_by_email: email,
        spreadsheet_id: spreadsheetId,
        sheet_title: sheetTab,
        detected_columns: { ...columns, filters: activeFilters },
        status: "processing",
        total_rows: rows.length,
        activities,
      })
      .select("id")
      .single();
    if (runErr) throw runErr;

    for (const r of rows) r.run_id = run.id;

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("scrap_scale_run_rows").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    await supabase.from("scrap_scale_runs").update({ processed_rows: noteRows }).eq("id", run.id);

    return NextResponse.json({ runId: run.id, totalRows: rows.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error starting the run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
