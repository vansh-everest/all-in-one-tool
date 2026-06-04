import { requireDepartmentAccess } from "@/lib/auth/guards";
import { getConnection } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { createAdminClient } from "@/utils/supabase/admin";
import { LenderFollowupPageClient } from "@/components/lender/LenderFollowupPageClient";
import { buildUnifiedGrid } from "@/lib/lender/grid";
import type { Lender, UnifiedGrid } from "@/lib/lender/types";

const EMPTY_GRID: UnifiedGrid = { columns: [], counts: { lenders_with_items: 0, open_items: 0, sheet_items: 0, email_items: 0, done: 0 }, findings: [] };

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

  // The tracker is the unified grid: the imported sheet with the latest email run merged in.
  // Never let a grid-build hiccup 500 the whole page — fall back to an empty grid.
  let grid: UnifiedGrid = EMPTY_GRID;
  try {
    grid = await buildUnifiedGrid(db, department.id);
  } catch {
    grid = EMPTY_GRID;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">Lender Follow-up Tracker</h1>
        <p className="mb-6 text-sm text-gray-500">Open pending items per lender — your imported sheet, kept current from unread Gmail (read-only).</p>
      </div>
      <LenderFollowupPageClient
        connected={!!conn}
        connectedEmail={conn?.google_email ?? null}
        lenders={(lenders ?? []) as Lender[]}
        runs={runs ?? []}
        canManage={canManage}
        grid={grid}
      />
    </div>
  );
}
