// app/api/tools/lender-followup/run/[runId]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { aggregateTracker } from "@/lib/lender/aggregate";
import type { Lender, Extraction } from "@/lib/lender/types";

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { departmentId } = await requireFinance();
  const db = createAdminClient();

  const { data: run } = await db.from("lender_runs").select("*").eq("id", runId).single();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const worklist: string[] = Array.isArray(run.worklist) ? run.worklist : [];
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  const lenders = (lendersData ?? []) as Lender[];

  const { data: cacheRows } = await db
    .from("lender_message_cache")
    .select("message_id, lender_id, extraction")
    .eq("department_id", departmentId)
    .in("message_id", worklist.length ? worklist : ["__none__"]);
  const byMessage = (cacheRows ?? [])
    .filter((r) => r.lender_id)
    .map((r) => ({ lenderId: r.lender_id as string, extraction: (r.extraction ?? { items: [], last_contact_date: null }) as Extraction }));
  const tracker = aggregateTracker(lenders, byMessage);

  // Review queue = queued metadata (fetch lightweight rows from cache if present, else just ids).
  const queuedIds: string[] = Array.isArray(run.summary?.queued_ids) ? run.summary.queued_ids : [];
  const { data: queueMeta } = await db
    .from("lender_message_cache")
    .select("message_id, from_email, subject, snippet, internal_date")
    .eq("department_id", departmentId)
    .in("message_id", queuedIds.length ? queuedIds : ["__none__"]);

  return NextResponse.json({ run, tracker, queue: { ids: queuedIds, meta: queueMeta ?? [] } });
}
