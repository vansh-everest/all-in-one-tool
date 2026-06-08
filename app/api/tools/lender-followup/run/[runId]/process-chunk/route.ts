import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { searchMessageRefs, getFull } from "@/lib/google/gmail";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";
import { buildLenderQuery } from "@/lib/lender/searchQuery";
import { normalizeLenderName as norm } from "@/lib/lender/importSheet";
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

const isRate = (e: unknown) => /\b429\b|quota|rate limit|rate-limit|exhausted/i.test(e instanceof Error ? e.message : String(e));

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

    const mode: "new" | "all" = run.summary?.mode === "all" ? "all" : "new";
    const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);
    const slice = worklist.slice(cursor, cursor + CHUNK);
    const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId).in("id", slice);
    const lenders = (lendersData ?? []) as Lender[];

    let foundThreads = 0;
    let emailsExamined = 0;
    let rateLimited = false;
    const newItems: Record<string, unknown>[] = [];
    // Per-run record of every matched thread (reliable per run, unlike the shared cache).
    const matches: Record<string, unknown>[] = [];

    for (const lender of lenders) {
      try {
        const query = buildLenderQuery(lender);
        if (!query) continue;
        const refs = await withRetry(() => searchMessageRefs(accessToken, query, SEARCH_MAX));
        emailsExamined += refs.length;

        // One message per thread (newest first from search), so we don't extract a thread twice.
        const seen = new Set<string>();
        let threadMsgs: { id: string; threadId: string }[] = [];
        for (const r of refs) {
          if (seen.has(r.threadId)) continue;
          seen.add(r.threadId);
          threadMsgs.push(r);
        }
        // "new" mode: skip messages we've already checked in a previous scan.
        if (mode === "new" && threadMsgs.length) {
          const ids = threadMsgs.map((t) => t.id);
          const { data: alreadySeen } = await db.from("lender_message_cache").select("message_id").eq("department_id", departmentId).in("message_id", ids);
          const seenIds = new Set((alreadySeen ?? []).map((r) => r.message_id as string));
          threadMsgs = threadMsgs.filter((t) => !seenIds.has(t.id));
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
                run_id: runId,
              },
              { onConflict: "department_id,message_id" },
            );
            const tasks = ext.items.map((it) => ({
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
              email_date: full.internalDate,
            }));
            const match = {
              message_id: ref.id,
              lender_id: lender.id,
              lender_name: lender.name,
              owner: lender.owner ?? null,
              subject: full.subject,
              email_date: full.internalDate,
              items: ext.items.map((it) => it.item),
            };
            return { tasks, match };
          } catch (e) {
            // A rate-limit must pause the whole run (re-thrown to the lender handler);
            // any other single-thread error just skips that thread.
            if (isRate(e)) throw e;
            return { tasks: [] as Record<string, unknown>[], match: null as Record<string, unknown> | null };
          }
        });
        const lenderTasks = perThread.flatMap((p) => p.tasks);
        for (const p of perThread) if (p.match) matches.push(p.match);
        for (const t of lenderTasks) newItems.push(t);

        // Add the found tasks to the editable grid (lender_items), skipping ones already present.
        if (lenderTasks.length) {
          const { data: existing } = await db.from("lender_items").select("text").eq("department_id", departmentId).eq("lender_id", lender.id);
          const seenText = new Set((existing ?? []).map((r) => norm(r.text as string)));
          const toAdd = [];
          for (const t of lenderTasks) {
            const key = norm(t.item as string);
            if (!key || seenText.has(key)) continue;
            seenText.add(key);
            toAdd.push({
              department_id: departmentId,
              lender_id: lender.id,
              position: 1000,
              text: t.item as string,
              source: "email",
              source_message_id: (t.source_message_id as string) || null,
              email_date: (t.email_date as string) || null,
            });
          }
          if (toAdd.length) await db.from("lender_items").insert(toAdd);
        }
      } catch (e) {
        if (isRate(e)) { rateLimited = true; break; } // all keys exhausted — pause, don't advance
        continue; // non-rate error: skip this lender and keep going
      }
    }

    // lender_run_items has no email_date column — strip it before inserting.
    if (newItems.length) {
      const runItems = newItems.map((t) => {
        const { email_date: _drop, ...rest } = t as Record<string, unknown>;
        void _drop;
        return rest;
      });
      await db.from("lender_run_items").insert(runItems);
    }

    const counts = {
      ...(run.counts ?? {}),
      matched: (run.counts?.matched ?? 0) + foundThreads,
      open_items: (run.counts?.open_items ?? 0) + newItems.length,
      emails_examined: (run.counts?.emails_examined ?? 0) + emailsExamined,
    };
    const prevMatches: Record<string, unknown>[] = Array.isArray(run.summary?.matches) ? run.summary.matches : [];
    const summary = { ...(run.summary ?? {}), matches: [...prevMatches, ...matches] };

    // Rate-limited: persist whatever we got, but DON'T advance — the client waits and retries
    // this same lender once a key frees up (the run resumes exactly where it paused).
    if (rateLimited) {
      await db.from("lender_runs").update({ counts, summary }).eq("id", runId);
      return NextResponse.json({ processed: cursor, total: worklist.length, matched: counts.matched, emailsExamined: counts.emails_examined, rateLimited: true, done: false });
    }

    const newCursor = cursor + slice.length;
    await db.from("lender_runs").update({ cursor: newCursor, counts, summary }).eq("id", runId);

    if (newCursor >= worklist.length) return finalize(db, runId, worklist.length);
    return NextResponse.json({ processed: newCursor, total: worklist.length, matched: counts.matched, emailsExamined: counts.emails_examined, queued: 0, done: false });
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
  const matched = run?.counts?.matched ?? 0;
  const counts = { ...(run?.counts ?? {}), lenders_with_items: lendersWithItems, open_items: openItems, queued: 0 };
  await db.from("lender_runs").update({ status: "done", counts }).eq("id", runId);
  await appendLenderActivity(db, runId, `Done — ${matched} matched threads, ${openItems} tasks across ${lendersWithItems} lenders`);
  return NextResponse.json({ processed: total, total, matched, queued: 0, done: true });
}
