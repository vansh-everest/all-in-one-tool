// app/api/tools/lender-followup/message/[messageId]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getFull } from "@/lib/google/gmail";

export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const { departmentId, userId } = await requireFinance();
  const db = createAdminClient();

  // Only serve content for a message this department has already seen (matched or queued).
  const { data: row } = await db
    .from("lender_message_cache")
    .select("message_id, subject, from_email, extraction")
    .eq("department_id", departmentId)
    .eq("message_id", messageId)
    .single();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);
  const full = await getFull(accessToken, messageId); // readonly — never changes read-state
  return NextResponse.json({
    id: full.id,
    subject: full.subject,
    from: full.from,
    date: full.date,
    bodyText: full.bodyText,
    extraction: row.extraction ?? null,
  });
}
