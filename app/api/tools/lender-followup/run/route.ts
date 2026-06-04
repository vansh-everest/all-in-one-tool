import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { appendLenderActivity } from "@/lib/lender/activity";
import { buildLenderQuery } from "@/lib/lender/searchQuery";
import type { Lender } from "@/lib/lender/types";

export async function POST() {
  const { departmentId, userId, email } = await requireFinance();
  // Verify Gmail access up front; the per-lender searches happen in process-chunk.
  try {
    await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES);
  } catch (e) {
    if (e instanceof ReconsentRequired) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }

  const db = createAdminClient();
  const { data: lendersData } = await db.from("lenders").select("*").eq("department_id", departmentId);
  // Only lenders that are active AND have something searchable (name, alias, domain, or sender).
  const lenders = ((lendersData ?? []) as Lender[]).filter((l) => l.active && buildLenderQuery(l));
  const worklist = lenders.map((l) => l.id);

  const { data: run, error } = await db
    .from("lender_runs")
    .insert({
      department_id: departmentId,
      created_by_email: email,
      status: "running",
      worklist,
      cursor: 0,
      counts: { unread_total: 0, matched: 0, queued: 0, lenders_with_items: 0, open_items: 0, lenders_total: worklist.length },
      summary: { mode: "email-search" },
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await appendLenderActivity(db, run.id, `Run started — keyword-searching unread mail for ${worklist.length} lenders`);
  return NextResponse.json({ runId: run.id, total: worklist.length });
}
