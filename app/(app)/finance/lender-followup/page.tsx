import { requireDepartmentAccess } from "@/lib/auth/guards";
import { getConnection } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { createAdminClient } from "@/utils/supabase/admin";
import { LenderFollowupPageClient } from "@/components/lender/LenderFollowupPageClient";
import type { Lender, TrackerLender, RunCounts, PendencyItem, Direction } from "@/lib/lender/types";

export default async function LenderFollowupPage() {
  const { user, department, role } = await requireDepartmentAccess("finance");
  const canManage = role === "admin" || role === "super";
  const conn = await getConnection(user.id, LENDER_FOLLOWUP_SCOPES);
  const db = createAdminClient();
  const { data: lenders } = await db.from("lenders").select("*").eq("department_id", department.id).order("name");
  const { data: runs } = await db
    .from("lender_runs")
    .select("id, created_at, created_by_email, status, counts")
    .eq("department_id", department.id)
    .order("created_at", { ascending: false })
    .limit(25);

  // Load the latest instance's saved items as the initial tracker (e.g. a sheet import),
  // so the page shows lender pendencies on load without re-running an email scan.
  const latest = runs?.[0] ?? null;
  let initialTracker: TrackerLender[] = [];
  let initialCounts: RunCounts | null = null;
  if (latest) {
    const { data: items } = await db
      .from("lender_run_items")
      .select("lender_id, lender_name, owner, item, status, last_update_date, direction, source_message_id")
      .eq("run_id", latest.id);
    const groups = new Map<string, TrackerLender>();
    for (const it of items ?? []) {
      const key = (it.lender_id as string) ?? (it.lender_name as string);
      let g = groups.get(key);
      if (!g) {
        g = { lender_id: (it.lender_id as string) ?? null, lender_name: (it.lender_name as string) ?? "(unknown)", owner: (it.owner as string) ?? null, items: [] };
        groups.set(key, g);
      }
      const item: PendencyItem = {
        item: (it.item as string) ?? "",
        status: (it.status as string) ?? "",
        last_update_date: (it.last_update_date as string) ?? null,
        direction: ((it.direction as Direction) ?? "unclear"),
        source_message_id: (it.source_message_id as string) ?? "",
      };
      g.items.push(item);
    }
    initialTracker = [...groups.values()].sort((a, b) => a.lender_name.localeCompare(b.lender_name));
    initialCounts = (latest.counts as RunCounts) ?? null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">Lender Follow-up Tracker</h1>
        <p className="mb-6 text-sm text-gray-500">Open pending items per lender, from unread Gmail (read-only).</p>
      </div>
      <LenderFollowupPageClient
        connected={!!conn}
        connectedEmail={conn?.google_email ?? null}
        lenders={(lenders ?? []) as Lender[]}
        runs={runs ?? []}
        canManage={canManage}
        initialRunId={latest?.id ?? null}
        initialTracker={initialTracker}
        initialCounts={initialCounts}
      />
    </div>
  );
}
