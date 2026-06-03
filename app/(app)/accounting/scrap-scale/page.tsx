import { requireDepartmentAccess } from "@/lib/auth/guards";
import { getConnection } from "@/lib/google/connection";
import { ScrapScaleApp } from "@/components/scrap-scale/ScrapScaleApp";
import { RunHistory } from "@/components/scrap-scale/RunHistory";
import { createAdminClient } from "@/utils/supabase/admin";

export default async function ScrapScalePage() {
  const { user, department } = await requireDepartmentAccess("accounting");
  const conn = await getConnection(user.id);
  const supabase = createAdminClient();
  const { data: runs } = await supabase
    .from("scrap_scale_runs")
    .select("id, spreadsheet_id, sheet_title, status, total_rows, summary, results_tab_name, created_at, created_by_email, activities")
    .eq("department_id", department.id)
    .order("created_at", { ascending: false })
    .limit(25);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">Scrap Scale</h1>
        <p className="mb-6 text-sm text-gray-500">Reconcile payment screenshots against Total Fund Collection.</p>
        <ScrapScaleApp connected={!!conn} connectedEmail={conn?.google_email ?? null} />
      </div>
      <RunHistory runs={runs ?? []} />
    </div>
  );
}
