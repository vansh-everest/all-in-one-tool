import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { parseDriveFileIds } from "@/lib/scrap-scale/links";
import { resolveDriveFiles, extractOneFile } from "@/lib/scrap-scale/extract";

const MAX_FILES = 10; // diagnostic cap so a folder link can't run forever

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAccounting();
    const { url } = await req.json();
    const linkIds = parseDriveFileIds(String(url ?? ""));
    if (linkIds.length === 0) {
      return NextResponse.json({ error: "No Google Drive link/id found in that text." }, { status: 400 });
    }

    let accessToken: string;
    try {
      ({ accessToken } = await getAccessToken(userId, SCRAP_SCALE_SCOPES));
    } catch (e) {
      if (e instanceof ReconsentRequired) return NextResponse.json({ error: "reconsent_required" }, { status: 409 });
      throw e;
    }

    const { files, errors } = await resolveDriveFiles(linkIds, accessToken);
    const capped = files.slice(0, MAX_FILES);
    const results = [];
    for (const file of capped) {
      results.push(await extractOneFile(file, accessToken));
    }

    return NextResponse.json({
      linkIds,
      fileCount: files.length,
      truncated: files.length > MAX_FILES,
      resolveErrors: errors,
      results: results.map((r) => ({
        file_id: r.file_id,
        name: r.name,
        mimeType: r.mimeType,
        amount: r.amount,
        payments: r.payments,
        txn_ids: r.txn_ids,
        readable: r.readable,
        error: r.error,
        notes: r.notes,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error testing the link.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
