import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { SCOPES } from "@/lib/google/scopes";
import { extractSpreadsheetId } from "@/lib/scrap-scale/links";
import { getSpreadsheetMeta, readValues } from "@/lib/google/sheets";
import { parsePendencyMatrix } from "@/lib/lender/importSheet";
import { applyImport } from "@/lib/lender/applyImport";

export async function POST(req: NextRequest) {
  const { departmentId, userId, email } = await requireFinance();
  const body = await req.json().catch(() => ({}));
  const id = extractSpreadsheetId(body?.url ?? "");
  if (!id) return NextResponse.json({ error: "Invalid Google Sheet URL" }, { status: 400 });

  let accessToken: string;
  try {
    // Reading a sheet needs the Sheets scope (granted via the same Google sign-in as Scrap Scale).
    ({ accessToken } = await getAccessToken(userId, [SCOPES.sheets]));
  } catch (e) {
    if (e instanceof ReconsentRequired) {
      return NextResponse.json(
        { error: "Google Sheets access missing — sign out and sign in again to grant it." },
        { status: 409 },
      );
    }
    throw e;
  }

  const meta = await getSpreadsheetMeta(id, accessToken);
  const tab = body?.tab || meta.sheets.find((s) => /pendenc/i.test(s)) || meta.sheets[0];
  if (!tab) return NextResponse.json({ error: "Spreadsheet has no readable tabs" }, { status: 422 });

  const rows = await readValues(id, tab, accessToken);
  const parsed = parsePendencyMatrix(rows);
  if (!parsed.lenders.length) {
    return NextResponse.json(
      { error: "No lender columns found — expected a 'Sr. No.' header row with lender names across the columns." },
      { status: 422 },
    );
  }

  const db = createAdminClient();
  const summary = await applyImport(db, departmentId, email, parsed);
  return NextResponse.json({ ...summary, tab });
}
