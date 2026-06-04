import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getFull } from "@/lib/google/gmail";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";
import { buildClassifyPrompt, buildExtractPrompt } from "@/lib/lender/prompts";
import { parseClassification } from "@/lib/lender/classify";
import { parseExtraction } from "@/lib/lender/extract";
import { geminiJson } from "@/lib/gemini/client";
import { appendLenderActivity } from "@/lib/lender/activity";
import type { Lender } from "@/lib/lender/types";

const BATCH = 50;            // queued emails classified per click
const CONCURRENCY = 5;
const THRESHOLD = Number(process.env.LENDER_CLASSIFY_THRESHOLD ?? "0.75");

export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId, userId } = await requireFinance();
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const queuedIds: string[] = Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : [];
  if (!queuedIds.length) return NextResponse.json({ classified: 0, matched: run.counts?.matched ?? 0, queued: 0 });

  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = ((lendersData ?? []) as Lender[]).filter((l) => l.active);
  const lenderList = lenders.map((l) => ({ id: l.id, name: l.name }));

  const batch = queuedIds.slice(0, BATCH);
  const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);

  // Classify each queued email on subject+snippet from its cached metadata row.
  const { data: metaRows } = await db
    .from("lender_message_cache")
    .select("message_id, subject, snippet")
    .eq("department_id", departmentId)
    .in("message_id", batch);
  const metaById = new Map((metaRows ?? []).map((r) => [r.message_id as string, r]));

  const newlyMatched: string[] = [];
  await mapWithConcurrency(batch, CONCURRENCY, async (id) => {
    const meta = metaById.get(id);
    if (!meta) return;
    const prompt = buildClassifyPrompt(lenderList, { subject: (meta.subject as string) ?? "", snippet: (meta.snippet as string) ?? "" });
    const text = await withRetry(() => geminiJson(prompt));
    const { lenderId } = parseClassification(text, THRESHOLD);
    if (!lenderId || !lenders.some((l) => l.id === lenderId)) return;

    // Promote: fetch full + extract, write cache row as matched.
    const full = await withRetry(() => getFull(accessToken, id));
    const lenderName = lenders.find((l) => l.id === lenderId)?.name ?? "lender";
    const ePrompt = buildExtractPrompt(lenderName, [{ id, date: full.date, body: full.bodyText.slice(0, 12000) }]);
    const eText = await withRetry(() => geminiJson(ePrompt));
    const extraction = parseExtraction(eText, id);
    await db.from("lender_message_cache").upsert(
      {
        department_id: departmentId,
        message_id: id,
        lender_id: lenderId,
        thread_id: full.threadId,
        from_email: "", // unchanged; metadata already cached
        subject: full.subject,
        internal_date: full.internalDate,
        snippet: meta.snippet as string,
        extraction,
      },
      { onConflict: "department_id,message_id" },
    );
    newlyMatched.push(id);
  });

  const remaining = queuedIds.filter((id) => !newlyMatched.includes(id));
  const counts = {
    ...(run.counts ?? {}),
    matched: (run.counts?.matched ?? 0) + newlyMatched.length,
    queued: remaining.length,
  };
  await db
    .from("lender_runs")
    .update({ counts, summary: { ...(run.summary ?? {}), queued_ids: remaining } })
    .eq("id", runId);
  await appendLenderActivity(db, runId, `AI classified ${batch.length} queued — matched ${newlyMatched.length}`);

  return NextResponse.json({ classified: batch.length, matched: counts.matched, queued: counts.queued });
}
