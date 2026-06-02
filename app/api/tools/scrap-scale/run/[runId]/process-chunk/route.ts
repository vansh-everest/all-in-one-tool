import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { downloadFile } from "@/lib/google/drive";
import { geminiExtract } from "@/lib/scrap-scale/ocr";
import { computeRow, type OcrUnit } from "@/lib/scrap-scale/compute";
import { markDuplicates } from "@/lib/scrap-scale/duplicates";
import { mapWithConcurrency, withRetry } from "@/lib/scrap-scale/queue";

const CHUNK = 8; // rows per invocation (keeps under serverless time limit)
const CONCURRENCY = 5; // simultaneous OCR/Drive ops

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireAccounting();
  const supabase = await createClient();
  const force = req.nextUrl.searchParams.get("force") === "1";

  const { data: run } = await supabase.from("scrap_scale_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const { data: pending } = await supabase
    .from("scrap_scale_run_rows")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("row_index")
    .limit(CHUNK);

  if (!pending || pending.length === 0) {
    return await finalize(supabase, runId);
  }

  const { accessToken } = await getAccessToken(departmentId, SCRAP_SCALE_SCOPES);

  for (const row of pending) {
    const units = await mapWithConcurrency(row.links as string[], CONCURRENCY, async (fileId) => {
      if (!force) {
        const { data: cached } = await supabase.from("ocr_cache").select("*").eq("file_id", fileId).maybeSingle();
        if (cached) {
          return {
            amount: cached.amount as number | null,
            readable: cached.amount !== null,
            file_id: fileId,
            txn_id: cached.txn_id as string | null,
            detail: cached.raw_json,
          };
        }
      }
      try {
        const { base64, mimeType } = await withRetry(() => downloadFile(fileId, accessToken));
        const ocr = await withRetry(() => geminiExtract(base64, mimeType));
        await supabase.from("ocr_cache").upsert({
          file_id: fileId,
          department_id: departmentId,
          amount: ocr.amount,
          currency: ocr.currency,
          txn_id: ocr.txn_id,
          date: ocr.date,
          confidence: ocr.confidence,
          raw_json: ocr,
          fetched_at: new Date().toISOString(),
        });
        return { amount: ocr.amount, readable: ocr.amount !== null, file_id: fileId, txn_id: ocr.txn_id, detail: ocr };
      } catch (e) {
        return { amount: null, readable: false, file_id: fileId, txn_id: null, detail: { error: String(e) } };
      }
    });

    const ocrUnits: OcrUnit[] = units.map((u) => ({ amount: u.amount, readable: u.readable }));
    const c = computeRow({ expected: row.expected_amount, ocr: ocrUnits, hasLinks: (row.links as string[]).length > 0 });
    await supabase
      .from("scrap_scale_run_rows")
      .update({
        extracted_amount: c.extracted,
        difference: c.difference,
        flagged: c.flagged,
        status: c.status,
        ocr_details: units.map((u) => ({ file_id: u.file_id, amount: u.amount, txn_id: u.txn_id, detail: u.detail })),
      })
      .eq("id", row.id);
  }

  const { count } = await supabase
    .from("scrap_scale_run_rows")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .neq("status", "pending");
  await supabase.from("scrap_scale_runs").update({ processed_rows: count ?? 0 }).eq("id", runId);

  const { data: subtotalRows } = await supabase
    .from("scrap_scale_run_rows")
    .select("extracted_amount")
    .eq("run_id", runId);
  const subtotal = (subtotalRows ?? []).reduce((s, r) => s + (Number(r.extracted_amount) || 0), 0);

  return NextResponse.json({ processed: count ?? 0, total: run.total_rows, subtotal, done: false });
}

async function finalize(supabase: SupabaseServer, runId: string) {
  const { data: rows } = await supabase
    .from("scrap_scale_run_rows")
    .select("id, row_index, ocr_details, extracted_amount, difference, flagged, status, duplicate")
    .eq("run_id", runId);
  const all = rows ?? [];

  const dups = markDuplicates(
    all.map((r) => ({
      row_index: r.row_index as number,
      txnIds: (((r.ocr_details as { txn_id: string | null }[]) ?? []).map((d) => d.txn_id ?? "")).filter(Boolean),
    })),
  );
  for (const r of all) {
    const isDup = dups.get(r.row_index as number) ?? false;
    if (isDup !== r.duplicate) await supabase.from("scrap_scale_run_rows").update({ duplicate: isDup }).eq("id", r.id);
  }

  const summary = {
    totalRows: all.length,
    reconciled: all.filter((r) => r.status !== "note-row" && Number(r.difference) === 0).length,
    flagged: all.filter((r) => r.flagged).length,
    duplicates: [...dups.values()].filter(Boolean).length,
    needsReview: all.filter((r) => r.status === "needs-review").length,
    noteRows: all.filter((r) => r.status === "note-row").length,
    sumExtracted: all.reduce((s, r) => s + (Number(r.extracted_amount) || 0), 0),
  };
  await supabase.from("scrap_scale_runs").update({ status: "done", summary }).eq("id", runId);
  return NextResponse.json({ processed: all.length, total: all.length, subtotal: summary.sumExtracted, done: true, summary });
}
