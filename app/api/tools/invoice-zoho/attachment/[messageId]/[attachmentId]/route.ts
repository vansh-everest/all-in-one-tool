import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getAttachment } from "@/lib/google/gmail";

// Streams a source invoice attachment for the audit drawer, after verifying it was
// processed by this department.
export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string; attachmentId: string }> }) {
  const { messageId, attachmentId } = await params;
  const { departmentId, userId } = await requireFinance();
  const db = createAdminClient();

  const { data: processed } = await db
    .from("invoice_processed")
    .select("id")
    .eq("department_id", departmentId)
    .eq("message_id", messageId)
    .eq("attachment_id", attachmentId)
    .maybeSingle();
  if (!processed) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Stored mime type for the right Content-Type.
  const { data: row } = await db
    .from("invoice_rows")
    .select("mime_type")
    .eq("department_id", departmentId)
    .eq("source_message_id", messageId)
    .eq("attachment_id", attachmentId)
    .limit(1)
    .maybeSingle();
  const mime = (row?.mime_type as string | undefined) || "application/octet-stream";

  let accessToken: string;
  try {
    ({ accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES));
  } catch (e) {
    if (e instanceof ReconsentRequired) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }

  const base64 = await getAttachment(accessToken, messageId, attachmentId);
  const bytes = Buffer.from(base64, "base64");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": "inline",
    },
  });
}
