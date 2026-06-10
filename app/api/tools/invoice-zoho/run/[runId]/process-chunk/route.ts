import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { getFullRaw, listAttachments, getAttachment } from "@/lib/google/gmail";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";
import { geminiExtractInvoice } from "@/lib/invoice/ocr";
import { mapInvoiceToRow, computeFlags } from "@/lib/invoice/mapping";
import { appendInvoiceActivity } from "@/lib/invoice/activity";

// One small batch of messages per invocation keeps each request under the serverless
// time limit even when a message carries several attachments.
export const maxDuration = 60;

const CHUNK = 2;        // messages per invocation
const CONCURRENCY = 2;  // simultaneous attachment OCRs within a message

type DB = ReturnType<typeof createAdminClient>;

const isRate = (e: unknown) => /\b429\b|quota|rate limit|rate-limit|exhausted/i.test(e instanceof Error ? e.message : String(e));

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const { departmentId, userId } = await requireAccounting();
    const db = createAdminClient();

    const { data: run } = await db.from("invoice_runs").select("*").eq("id", runId).single();
    if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

    const worklist: string[] = Array.isArray(run.worklist) ? run.worklist : [];
    const cursor: number = run.cursor ?? 0;
    if (cursor >= worklist.length) return finalize(db, run, runId, worklist.length);

    const constants: Record<string, string | number> = (run.summary?.constants ?? {}) as Record<string, string | number>;
    const { accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);
    const slice = worklist.slice(cursor, cursor + CHUNK);

    let invoices = 0;
    let rows = 0;
    let flagged = 0;
    let duplicates = 0;
    let rateLimited = false;

    for (const messageId of slice) {
      try {
        const full = await withRetry(() => getFullRaw(accessToken, messageId));
        const attachments = listAttachments(full.payload);

        // Skip attachments already processed for this (dept, message, attachment) triple.
        const attIds = attachments.map((a) => a.attachmentId);
        let alreadyIds = new Set<string>();
        if (attIds.length) {
          const { data: seen } = await db
            .from("invoice_processed")
            .select("attachment_id")
            .eq("department_id", departmentId)
            .eq("message_id", messageId)
            .in("attachment_id", attIds);
          alreadyIds = new Set((seen ?? []).map((r) => r.attachment_id as string));
        }
        const todo = attachments.filter((a) => !alreadyIds.has(a.attachmentId));
        duplicates += attachments.length - todo.length;

        const results = await mapWithConcurrency(todo, CONCURRENCY, async (att) => {
          try {
            const base64 = await withRetry(() => getAttachment(accessToken, messageId, att.attachmentId));
            const ocr = await withRetry(() => geminiExtractInvoice(base64, att.mimeType, messageId, att.attachmentId));
            const mapped = mapInvoiceToRow(ocr, constants);
            const flags = computeFlags(ocr, mapped);
            return { att, ocr, mapped, flags, error: false as const };
          } catch (e) {
            // A rate-limit must pause the whole run (re-thrown to the message handler);
            // any other single-attachment error becomes an ocr-error row so it's visible.
            if (isRate(e)) throw e;
            return { att, ocr: null, mapped: null, flags: ["ocr-error"], error: true as const };
          }
        });

        for (const r of results) {
          const grandTotal = r.ocr?.grand_total ?? null;
          const confidence = r.ocr?.confidence ?? null;
          await db.from("invoice_rows").insert({
            run_id: runId,
            department_id: departmentId,
            source_message_id: messageId,
            attachment_id: r.att.attachmentId,
            file_name: r.att.filename,
            mime_type: r.att.mimeType,
            ocr: r.ocr,
            mapped: r.mapped,
            flags: r.flags,
            confidence,
            grand_total: grandTotal,
            reconciled: !r.flags.includes("totals-mismatch"),
          });
          await db.from("invoice_processed").insert({
            department_id: departmentId,
            message_id: messageId,
            attachment_id: r.att.attachmentId,
            run_id: runId,
          });
          rows += 1;
          if (!r.error) invoices += 1;
          if (r.flags.length) flagged += 1;
        }
      } catch (e) {
        if (isRate(e)) { rateLimited = true; break; } // all keys exhausted — pause, don't advance
        continue; // non-rate error: skip this message and keep going
      }
    }

    const counts = {
      ...(run.counts ?? {}),
      invoices: (run.counts?.invoices ?? 0) + invoices,
      rows: (run.counts?.rows ?? 0) + rows,
      flagged: (run.counts?.flagged ?? 0) + flagged,
      duplicates: (run.counts?.duplicates ?? 0) + duplicates,
    };

    // Rate-limited: persist what we got, but DON'T advance — the client waits and retries
    // this same slice once a key frees up (the run resumes exactly where it paused).
    if (rateLimited) {
      await db.from("invoice_runs").update({ counts }).eq("id", runId);
      return NextResponse.json({ processed: cursor, total: worklist.length, counts, rateLimited: true, done: false });
    }

    const newCursor = cursor + slice.length;
    await db.from("invoice_runs").update({ cursor: newCursor, counts }).eq("id", runId);

    if (newCursor >= worklist.length) return finalize(db, { ...run, counts }, runId, worklist.length);
    return NextResponse.json({ processed: newCursor, total: worklist.length, counts, done: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Processing error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function finalize(db: DB, run: { department_id: string; counts?: Record<string, number>; summary?: { today?: string } }, runId: string, total: number) {
  const today = typeof run.summary?.today === "string" && run.summary.today ? run.summary.today : new Date().toISOString().slice(0, 10);
  await db.from("invoice_runs").update({ status: "done" }).eq("id", runId);
  await db.from("invoice_config").update({ last_run_date: today, updated_at: new Date().toISOString() }).eq("department_id", run.department_id);
  const counts = run.counts ?? {};
  await appendInvoiceActivity(
    db,
    runId,
    `Done — ${counts.invoices ?? 0} invoices, ${counts.rows ?? 0} rows, ${counts.flagged ?? 0} flagged, ${counts.duplicates ?? 0} duplicates`,
  );
  return NextResponse.json({ processed: total, total, counts, done: true });
}
