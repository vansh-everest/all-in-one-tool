import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { extractSpreadsheetId } from "@/lib/scrap-scale/links";
import { getSpreadsheetMeta, readValues } from "@/lib/google/sheets";
import { detectColumns } from "@/lib/scrap-scale/columns";

export async function POST(req: NextRequest) {
  const { departmentId } = await requireAccounting();
  const { url, tab } = await req.json();
  const spreadsheetId = extractSpreadsheetId(url ?? "");
  if (!spreadsheetId) {
    return NextResponse.json({ error: "Could not find a spreadsheet id in that URL." }, { status: 400 });
  }

  let accessToken: string;
  try {
    ({ accessToken } = await getAccessToken(departmentId, SCRAP_SCALE_SCOPES));
  } catch (e) {
    if (e instanceof ReconsentRequired) return NextResponse.json({ error: "reconsent_required" }, { status: 409 });
    throw e;
  }

  const meta = await getSpreadsheetMeta(spreadsheetId, accessToken);
  const sheetTab = tab && meta.sheets.includes(tab) ? tab : meta.sheets[0];
  const values = await readValues(spreadsheetId, sheetTab, accessToken);
  const headers = values[0] ?? [];
  const sample = values.slice(1, 21);
  const detection = detectColumns(headers, sample);

  return NextResponse.json({
    spreadsheetId,
    sheetTab,
    sheets: meta.sheets,
    headers,
    detection,
    rowCount: Math.max(values.length - 1, 0),
  });
}
