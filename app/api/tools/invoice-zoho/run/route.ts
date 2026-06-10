import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { getAccessToken, ReconsentRequired } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { appendInvoiceActivity } from "@/lib/invoice/activity";
import { buildInvoiceQuery } from "@/lib/invoice/gmailQuery";
import { searchMessageRefs } from "@/lib/google/gmail";

const SEARCH_MAX = 200;

export async function POST(req: NextRequest) {
  const { departmentId, userId, email } = await requireAccounting();
  const body = await req.json().catch(() => ({}));

  const db = createAdminClient();

  const { data: config } = await db.from("invoice_config").select("*").eq("department_id", departmentId).maybeSingle();
  const label = typeof config?.gmail_label === "string" ? config.gmail_label.trim() : "";
  if (!label) return NextResponse.json({ error: "Set a Gmail label in the config first" }, { status: 400 });

  // Active mapping profile: the one selected in config, else the first active.
  let profileId: string | null = config?.profile_id ?? null;
  let constants: Record<string, string | number> = {};
  if (profileId) {
    const { data: p } = await db.from("invoice_mapping_profiles").select("*").eq("id", profileId).eq("department_id", departmentId).maybeSingle();
    if (p) constants = (p.constants ?? {}) as Record<string, string | number>;
  }
  if (!profileId) {
    const { data: p } = await db.from("invoice_mapping_profiles").select("*").eq("department_id", departmentId).eq("active", true).order("created_at").limit(1).maybeSingle();
    if (p) { profileId = p.id as string; constants = (p.constants ?? {}) as Record<string, string | number>; }
  }

  // Server date comes from the client to avoid timezone pitfalls; fall back to UTC today.
  const today: string = typeof body?.today === "string" && body.today ? body.today.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const since: string = typeof config?.last_run_date === "string" && config.last_run_date ? config.last_run_date : today;

  // Verify Gmail access up front; per-message fetches happen in process-chunk.
  let accessToken: string;
  try {
    ({ accessToken } = await getAccessToken(userId, LENDER_FOLLOWUP_SCOPES));
  } catch (e) {
    if (e instanceof ReconsentRequired) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }

  const refs = await searchMessageRefs(accessToken, buildInvoiceQuery(label, since), SEARCH_MAX);
  // Unique message ids (newest first from search).
  const seen = new Set<string>();
  const worklist: string[] = [];
  for (const r of refs) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    worklist.push(r.id);
  }

  const { data: run, error } = await db
    .from("invoice_runs")
    .insert({
      department_id: departmentId,
      created_by_email: email,
      status: "running",
      label,
      since_date: since,
      worklist,
      cursor: 0,
      counts: { messages: worklist.length, invoices: 0, rows: 0, flagged: 0, duplicates: 0 },
      summary: { profile_id: profileId, constants, today },
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await appendInvoiceActivity(db, run.id, `Run started — ${worklist.length} messages since ${since}`);
  return NextResponse.json({ runId: run.id, total: worklist.length });
}
