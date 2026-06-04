import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getMetadata, getFull } from "@/lib/google/gmail";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";
import { matchLender } from "@/lib/lender/match";
import { filterIgnored } from "@/lib/lender/ignore";
import { parseExtraction } from "@/lib/lender/extract";
import { buildExtractPrompt } from "@/lib/lender/prompts";
import { geminiJson } from "@/lib/gemini/client";
import { aggregateTracker, computeCounts } from "@/lib/lender/aggregate";
import { appendLenderActivity } from "@/lib/lender/activity";
import type { Lender, EmailMeta, Extraction } from "@/lib/lender/types";

const CHUNK = 25;       // ids per invocation
const CONCURRENCY = 6;  // simultaneous Gmail/Gemini ops

type DB = ReturnType<typeof createAdminClient>;

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId, userId } = await requireFinance();
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const worklist: string[] = Array.isArray(run.worklist) ? run.worklist : [];
  const cursor: number = run.cursor ?? 0;
  if (cursor >= worklist.length) return finalize(db, runId, departmentId);

  const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);

  // Load active lenders + ignore set.
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = (lendersData ?? []) as Lender[];
  const { data: ignoredData } = await db
    .from("lender_ignored_senders")
    .select("email")
    .eq("department_id", departmentId);
  const ignored = new Set((ignoredData ?? []).map((r) => (r.email as string).toLowerCase()));

  const slice = worklist.slice(cursor, cursor + CHUNK);

  // 1. metadata
  const metas: EmailMeta[] = await mapWithConcurrency(slice, CONCURRENCY, (id) =>
    withRetry(() => getMetadata(accessToken, id)),
  );

  // 2. drop ignored, deterministic match
  const kept = filterIgnored(metas, ignored);
  const matched = kept.map((m) => ({ meta: m, lenderId: matchLender(m.fromEmail, lenders) }));
  const toExtract = matched.filter((x) => x.lenderId);
  const queued = matched.filter((x) => !x.lenderId).map((x) => x.meta.id);

  // 3. full + extract for matched, skipping already-cached message ids
  const cachedIds = await alreadyCached(db, departmentId, toExtract.map((x) => x.meta.id));
  const fresh = toExtract.filter((x) => !cachedIds.has(x.meta.id));
  await mapWithConcurrency(fresh, CONCURRENCY, async ({ meta, lenderId }) => {
    const full = await withRetry(() => getFull(accessToken, meta.id));
    const lenderName = lenders.find((l) => l.id === lenderId)?.name ?? "lender";
    const prompt = buildExtractPrompt(lenderName, [{ id: meta.id, date: full.date, body: full.bodyText.slice(0, 12000) }]);
    const text = await withRetry(() => geminiJson(prompt));
    const extraction = parseExtraction(text, meta.id);
    await db.from("lender_message_cache").upsert(
      {
        department_id: departmentId,
        message_id: meta.id,
        lender_id: lenderId,
        thread_id: meta.threadId,
        from_email: meta.fromEmail,
        subject: meta.subject,
        internal_date: meta.internalDate,
        snippet: meta.snippet,
        extraction,
      },
      { onConflict: "department_id,message_id" },
    );
  });

  // Cache queued senders' metadata (no extraction, no lender) so the review queue has context.
  const queuedMetas = matched.filter((x) => !x.lenderId).map((x) => x.meta);
  if (queuedMetas.length) {
    await db.from("lender_message_cache").upsert(
      queuedMetas.map((m) => ({
        department_id: departmentId,
        message_id: m.id,
        lender_id: null,
        thread_id: m.threadId,
        from_email: m.fromEmail,
        subject: m.subject,
        internal_date: m.internalDate,
        snippet: m.snippet,
        extraction: null,
      })),
      { onConflict: "department_id,message_id" },
    );
  }

  // 4. advance cursor + accumulate queued ids/counts
  const prevQueued: string[] = Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : [];
  const queuedIds = [...prevQueued, ...queued];
  const newCursor = cursor + slice.length;
  const counts = {
    ...(run.counts ?? {}),
    matched: (run.counts?.matched ?? 0) + toExtract.length,
    queued: queuedIds.length,
  };
  await db
    .from("lender_runs")
    .update({ cursor: newCursor, counts, summary: { ...(run.summary ?? {}), queued_ids: queuedIds } })
    .eq("id", runId);

  if (newCursor >= worklist.length) return finalize(db, runId, departmentId);
  return NextResponse.json({ processed: newCursor, total: worklist.length, matched: counts.matched, queued: counts.queued, done: false });
}

async function alreadyCached(db: DB, departmentId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await db
    .from("lender_message_cache")
    .select("message_id")
    .eq("department_id", departmentId)
    .in("message_id", ids);
  return new Set((data ?? []).map((r) => r.message_id as string));
}

async function finalize(db: DB, runId: string, departmentId: string) {
  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  const queuedIds: string[] = Array.isArray(run?.summary?.queued_ids) ? run!.summary.queued_ids : [];

  // Build tracker from all cached matched messages referenced by this run's matched set.
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = (lendersData ?? []) as Lender[];
  const worklist: string[] = Array.isArray(run?.worklist) ? run!.worklist : [];
  const { data: cacheRows } = await db
    .from("lender_message_cache")
    .select("message_id, lender_id, extraction")
    .eq("department_id", departmentId)
    .in("message_id", worklist.length ? worklist : ["__none__"]);

  const byMessage = (cacheRows ?? [])
    .filter((r) => r.lender_id)
    .map((r) => ({ lenderId: r.lender_id as string, extraction: (r.extraction ?? { items: [], last_contact_date: null }) as Extraction }));
  const tracker = aggregateTracker(lenders, byMessage);
  const counts = computeCounts(tracker, {
    unreadTotal: run?.counts?.unread_total ?? worklist.length,
    matched: run?.counts?.matched ?? byMessage.length,
    queued: queuedIds.length,
  });

  // Snapshot run items.
  await db.from("lender_run_items").delete().eq("run_id", runId);
  const items = tracker.flatMap((t) =>
    t.items.map((it) => ({
      run_id: runId,
      lender_id: t.lender_id,
      lender_name: t.lender_name,
      owner: t.owner,
      item: it.item,
      status: it.status,
      last_update_date: it.last_update_date,
      direction: it.direction,
      source_message_id: it.source_message_id,
      thread_id: null,
    })),
  );
  if (items.length) await db.from("lender_run_items").insert(items);

  await db
    .from("lender_runs")
    .update({ status: "done", counts, summary: { ...(run?.summary ?? {}), queued_ids: queuedIds } })
    .eq("id", runId);
  await appendLenderActivity(db, runId, `Done — ${counts.matched} matched, ${counts.open_items} open items across ${counts.lenders_with_items} lenders, ${counts.queued} queued for review`);

  return NextResponse.json({ processed: worklist.length, total: worklist.length, matched: counts.matched, queued: counts.queued, done: true });
}
