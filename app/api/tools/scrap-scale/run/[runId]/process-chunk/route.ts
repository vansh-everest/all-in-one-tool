import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken } from "@/lib/google/connection";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";
import { resolveDriveFiles, extractOneFile, type FileExtraction } from "@/lib/scrap-scale/extract";
import { computeRow, type OcrUnit } from "@/lib/scrap-scale/compute";
import { markDuplicates } from "@/lib/scrap-scale/duplicates";
import { mapWithConcurrency } from "@/lib/scrap-scale/queue";

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
    // Expand each Drive link into the actual files to OCR (folders → children).
    const { files, errors } = await resolveDriveFiles(row.links as string[], accessToken);

    const fileResults = await mapWithConcurrency(files, CONCURRENCY, async (file) => {
      if (!force) {
        const { data: cached } = await supabase
          .from("ocr_cache")
          .select("raw_json")
          .eq("file_id", file.id)
          .maybeSingle();
        const fx = cached?.raw_json as Partial<FileExtraction> | undefined;
        // Reuse the cache only for successful prior reads in the new shape; stale
        // null/legacy entries (e.g. from before the pipeline fix) get re-OCR'd.
        if (fx && fx.readable && Array.isArray(fx.payments)) {
          return { ...fx, file_id: file.id, name: file.name, mimeType: file.mimeType } as FileExtraction;
        }
      }
      const result = await extractOneFile(file, accessToken);
      await supabase.from("ocr_cache").upsert({
        file_id: file.id,
        department_id: departmentId,
        amount: result.amount,
        currency: "INR",
        txn_id: result.txn_ids[0] ?? null,
        date: null,
        confidence: 0,
        raw_json: result,
        fetched_at: new Date().toISOString(),
      });
      return result;
    });

    const ocrUnits: OcrUnit[] = fileResults.map((f) => ({ amount: f.amount, readable: f.readable }));
    // A link we couldn't resolve, or a row whose links yielded no files, must not
    // silently read as a clean zero — surface it as needs-review.
    if (errors.length > 0 || fileResults.length === 0) ocrUnits.push({ amount: null, readable: false });

    const c = computeRow({ expected: row.expected_amount, ocr: ocrUnits, hasLinks: (row.links as string[]).length > 0 });

    const details = [
      ...fileResults.map((f) => ({
        file_id: f.file_id,
        name: f.name,
        mimeType: f.mimeType,
        amount: f.amount,
        txn_ids: f.txn_ids,
        readable: f.readable,
        error: f.error,
      })),
      ...errors.map((e) => ({
        file_id: e.id,
        name: "(unreadable link)",
        mimeType: "",
        amount: null,
        txn_ids: [] as string[],
        readable: false,
        error: e.error,
      })),
    ];

    await supabase
      .from("scrap_scale_run_rows")
      .update({
        extracted_amount: c.extracted,
        difference: c.difference,
        flagged: c.flagged,
        status: c.status,
        ocr_details: details,
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
      txnIds: ((r.ocr_details as { txn_ids?: string[] }[]) ?? []).flatMap((d) => d.txn_ids ?? []).filter(Boolean),
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
