import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getFull } from "@/lib/google/gmail";
import { withRetry } from "@/lib/scrap-scale/queue";
import { buildExtractPrompt } from "@/lib/lender/prompts";
import { parseExtraction } from "@/lib/lender/extract";
import { geminiJson } from "@/lib/gemini/client";
import { appendLenderActivity } from "@/lib/lender/activity";
import type { Lender } from "@/lib/lender/types";

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId, userId, email } = await requireFinance();
  const body = await req.json();
  const messageId: string = body?.messageId;
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = createAdminClient();
  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const { data: metaRow } = await db
    .from("lender_message_cache")
    .select("message_id, from_email, subject, snippet, thread_id, internal_date")
    .eq("department_id", departmentId)
    .eq("message_id", messageId)
    .single();
  if (!metaRow) return NextResponse.json({ error: "message not found" }, { status: 404 });
  const fromEmail = (metaRow.from_email as string)?.toLowerCase() ?? "";

  // IGNORE: add sender to ignore list, drop from queue.
  if (body.action === "ignore") {
    if (fromEmail) {
      await db.from("lender_ignored_senders").upsert(
        { department_id: departmentId, email: fromEmail, created_by_email: email },
        { onConflict: "department_id,email" },
      );
    }
    const remaining = (Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : []).filter((id: string) => id !== messageId);
    await db.from("lender_runs").update({
      summary: { ...(run.summary ?? {}), queued_ids: remaining },
      counts: { ...(run.counts ?? {}), queued: remaining.length },
    }).eq("id", runId);
    await appendLenderActivity(db, runId, `Marked ${fromEmail || messageId} as not-a-lender (ignored)`);
    return NextResponse.json({ ignored: messageId, queued: remaining.length });
  }

  // ASSIGN: learn the sender, extract, promote to matched.
  const lenderId: string = body.lenderId;
  if (!lenderId) return NextResponse.json({ error: "lenderId required" }, { status: 400 });
  const { data: lenderData } = await db
    .from("lenders")
    .select("*")
    .eq("id", lenderId)
    .eq("department_id", departmentId)
    .single();
  const lender = lenderData as Lender | null;
  if (!lender) return NextResponse.json({ error: "lender not found" }, { status: 404 });

  // Learning: append sender to known_sender_emails (dedup).
  if (fromEmail && !lender.known_sender_emails.map((e) => e.toLowerCase()).includes(fromEmail)) {
    await db.from("lenders").update({ known_sender_emails: [...lender.known_sender_emails, fromEmail] }).eq("id", lenderId);
  }

  const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);
  const full = await withRetry(() => getFull(accessToken, messageId));
  const prompt = buildExtractPrompt(lender.name, [{ id: messageId, date: full.date, body: full.bodyText.slice(0, 12000) }]);
  const text = await withRetry(() => geminiJson(prompt));
  const extraction = parseExtraction(text, messageId);
  await db.from("lender_message_cache").upsert(
    {
      department_id: departmentId,
      message_id: messageId,
      lender_id: lenderId,
      thread_id: full.threadId,
      from_email: fromEmail,
      subject: full.subject,
      internal_date: full.internalDate,
      snippet: metaRow.snippet as string,
      extraction,
    },
    { onConflict: "department_id,message_id" },
  );

  const remaining = (Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : []).filter((id: string) => id !== messageId);
  await db.from("lender_runs").update({
    summary: { ...(run.summary ?? {}), queued_ids: remaining },
    counts: { ...(run.counts ?? {}), matched: (run.counts?.matched ?? 0) + 1, queued: remaining.length },
  }).eq("id", runId);
  await appendLenderActivity(db, runId, `Assigned ${fromEmail || messageId} → ${lender.name} (learned sender)`);

  return NextResponse.json({ assigned: messageId, lenderId, queued: remaining.length });
}
