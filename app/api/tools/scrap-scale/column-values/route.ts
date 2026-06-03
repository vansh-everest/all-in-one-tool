import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { readValues } from "@/lib/google/sheets";
import { parseDate } from "@/lib/scrap-scale/filters";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAccounting();
    const { spreadsheetId, sheetTab, index } = await req.json();
    if (!spreadsheetId || typeof index !== "number") {
      return NextResponse.json({ error: "Missing spreadsheet or column index." }, { status: 400 });
    }
    let accessToken: string;
    try {
      ({ accessToken } = await getAccessToken(userId, SCRAP_SCALE_SCOPES));
    } catch (e) {
      if (e instanceof ReconsentRequired) return NextResponse.json({ error: "reconsent_required" }, { status: 409 });
      throw e;
    }

    const values = await readValues(spreadsheetId, sheetTab, accessToken);
    const cells = values.slice(1).map((r) => (r[index] ?? "").trim());
    const counts = new Map<string, number>();
    for (const c of cells) counts.set(c, (counts.get(c) ?? 0) + 1);
    const distinct = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 500);

    const nonEmpty = cells.filter(Boolean);
    const numericShare = nonEmpty.length
      ? nonEmpty.filter((c) => /^[₹$,.\s\d-]+$/.test(c) && /\d/.test(c)).length / nonEmpty.length
      : 0;
    const dateShare = nonEmpty.length
      ? nonEmpty.filter((c) => parseDate(c) !== null).length / nonEmpty.length
      : 0;
    const type = dateShare > 0.6 ? "date" : numericShare > 0.6 ? "number" : "text";

    return NextResponse.json({ values: distinct, type });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load column values." },
      { status: 500 },
    );
  }
}
