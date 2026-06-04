import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { listUnreadIds } from "@/lib/google/gmail";
import { appendLenderActivity } from "@/lib/lender/activity";

export async function POST() {
  const { departmentId, userId, email } = await requireFinance();
  let accessToken: string;
  try {
    ({ accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES));
  } catch (e) {
    if (e instanceof ReconsentRequired) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }

  const ids = await listUnreadIds(accessToken);
  const db = createAdminClient();
  const { data: run, error } = await db
    .from("lender_runs")
    .insert({
      department_id: departmentId,
      created_by_email: email,
      status: "running",
      worklist: ids,
      cursor: 0,
      counts: { unread_total: ids.length, matched: 0, queued: 0, lenders_with_items: 0, open_items: 0 },
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await appendLenderActivity(db, run.id, `Run started — ${ids.length} unread emails to scan`);
  return NextResponse.json({ runId: run.id, total: ids.length });
}
