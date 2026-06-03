import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { downloadFile } from "@/lib/google/drive";

export async function GET(req: NextRequest) {
  const { userId } = await requireAccounting();
  const fileId = req.nextUrl.searchParams.get("file");
  if (!fileId) return NextResponse.json({ error: "missing file" }, { status: 400 });
  const { accessToken } = await getAccessToken(userId, SCRAP_SCALE_SCOPES);
  const { base64, mimeType } = await downloadFile(fileId, accessToken);
  return new NextResponse(Buffer.from(base64, "base64"), {
    headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=300" },
  });
}
