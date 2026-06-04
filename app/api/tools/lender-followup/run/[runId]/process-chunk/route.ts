import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { searchMessageRefs, getFull } from "@/lib/google/gmail";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";
import { buildLenderQuery } from "@/lib/lender/searchQuery";
import { buildExtractPrompt } from "@/lib/lender/prompts";
import { parseExtraction } from "@/lib/lender/extract";
import { geminiJson } from "@/lib/gemini/client";
import { appendLenderActivity } from "@/lib/lender/activity";
import type { Lender } from "@/lib/lender/types";

// One lender per invocation keeps each request well under the serverless time limit
// even when a lender has many matching threads.
export const maxDuration = 60;

const CHUNK = 1;        // lenders per invocation
const SEARCH_MAX = 15;  // messages searched per lender
const CONCURRENCY = 3;  // simultaneous thread extractions

type DB = ReturnType<typeof createAdminClient>;

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const { departmentId, userId } = await requireFinance();
    const db = createAdminClient();

    const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
    if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

    const worklist: string[] = Array.isArray(run.worklist) ? run.worklist : [];
    const cursor: number = run.cursor ?? 0;
    if (cursor >= worklist.length) return finalize(db, runId, worklist.length);

    const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);
    const slice = worklist.slice(cursor, cursor + CHUNK);
    const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId).in("id", slice);
    const lenders = (lendersData ?? []) as Lender[];

    let foundThreads = 0;
    const newItems: Record<string, unknown>[] = [];

    for (const lender of lenders) {
      try {
        const query = buildLenderQuery(lender);
        if (!query) continue;
        const refs = await withRetry(() => searchMessageRefs(accessToken, query, SEARCH_MAX));

        // One message per thread (newest first from search), so we don't extract a thread twice.
        const seen = new Set<string>();
        const threadMsgs: { id: string; threadId: string }[] = [];
        for (const r of refs) {
          if (seen.has(r.threadId)) continue;
          seen.add(r.threadId);
          threadMsgs.push(r);
        }
        foundThreads += threadMsgs.length;

        const perThread = await mapWithConcurrency(threadMsgs, CONCURRENCY, async (ref) => {
          try {
            const full = await withRetry(() => getFull(accessToken, ref.id));
            const prompt = buildExtractPrompt(lender.name, [{ id: ref.id, date: full.date, body: full.bodyText.slice(0, 12000) }]);
            const text = await withRetry(() => geminiJson(prompt));
            const ext = parseExtraction(text, ref.id);
            await db.from("lender_message_cache").upsert(
              {
                department_id: departmentId,
                message_id: ref.id,
                lender_id: lender.id,
                thread_id: ref.threadId,
                from_email: full.from,
                subject: full.subject,
                internal_date: full.internalDate,
                snippet: "",
                extraction: ext,
              },
              { onConflict: "department_id,message_id" },
            );
            return ext.items.map((it) => ({
              run_id: runId,
              lender_id: lender.id,
              lender_name: lender.name,
              owner: lender.owner ?? null,
              item: it.item,
              status: it.status,
              last_update_date: it.last_update_date,
              direction: it.direction,
              source_message_id: it.source_message_id || ref.id,
              thread_id: ref.threadId,
            }));
          } catch {
            // One thread failing (rate limit, parse, Gmail) must not fail the whole scan.
            return [] as Record<string, unknown>[];
          }
        });
        for (const arr of perThread) newItems.push(...arr);
      } catch {
        // Skip this lender on a search/Gmail error and keep going.
        continue;
      }
    }

    if (newItems.length) await db.from("lender_run_items").insert(newItems);

    const newCursor = cursor + slice.length;
    const counts = {
      ...(run.counts ?? {}),
      matched: (run.counts?.matched ?? 0) + foundThreads,
      open_items: (run.counts?.open_items ?? 0) + newItems.length,
    };
    await db.from("lender_runs").update({ cursor: newCursor, counts }).eq("id", runId);

    if (newCursor >= worklist.length) return finalize(db, runId, worklist.length);
    return NextResponse.json({ processed: newCursor, total: worklist.length, matched: counts.matched, queued: 0, done: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Processing error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function finalize(db: DB, runId: string, total: number) {
  const { data: items } = await db.from("lender_run_items").select("lender_id").eq("run_id", runId);
  const lendersWithItems = new Set((items ?? []).map((r) => r.lender_id)).size;
  const openItems = (items ?? []).length;
  const { data: run } = await db.from("lender_runs").select("counts").eq("id", runId).single();
  const counts = { ...(run?.counts ?? {}), lenders_with_items: lendersWithItems, open_items: openItems, queued: 0 };
  await db.from("lender_runs").update({ status: "done", counts }).eq("id", runId);
  await appendLenderActivity(db, runId, `Done — ${openItems} undone tasks found across ${lendersWithItems} lenders`);
  return NextResponse.json({ processed: total, total, matched: counts.matched ?? 0, queued: 0, done: true });
}
