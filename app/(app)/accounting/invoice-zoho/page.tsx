import { requireDepartmentAccess } from "@/lib/auth/guards";
import { getConnection } from "@/lib/google/connection";
import { LENDER_FOLLOWUP_SCOPES } from "@/lib/google/scopes";
import { createAdminClient } from "@/utils/supabase/admin";
import { InvoicePageClient } from "@/components/invoice/InvoicePageClient";
import { DEFAULT_CONSTANTS } from "@/lib/invoice/schema";
import type { InvoiceConfigT, InvoiceProfile, InvoiceRow, InvoiceRunSummary } from "@/components/invoice/types";

export default async function InvoiceZohoPage() {
  const { user, department, role } = await requireDepartmentAccess("finance");
  const canManage = role === "admin" || role === "super";
  const conn = await getConnection(user.id, LENDER_FOLLOWUP_SCOPES);
  const db = createAdminClient();

  // Load config + profiles directly (don't call the API route from the server).
  // Seed a default profile/config if none exists, mirroring the config GET route.
  let config: InvoiceConfigT | null = null;
  let profiles: InvoiceProfile[] = [];
  try {
    const { data: existing } = await db
      .from("invoice_mapping_profiles")
      .select("*")
      .eq("department_id", department.id)
      .order("created_at");
    profiles = (existing ?? []) as InvoiceProfile[];
    if (!profiles.length) {
      const { data: seeded } = await db
        .from("invoice_mapping_profiles")
        .insert({ department_id: department.id, name: "Car Rental", constants: DEFAULT_CONSTANTS, active: true })
        .select("*")
        .single();
      profiles = seeded ? [seeded as InvoiceProfile] : [];
    }
    const { data: cfg } = await db
      .from("invoice_config")
      .select("*")
      .eq("department_id", department.id)
      .maybeSingle();
    config = (cfg as InvoiceConfigT | null) ?? null;
    if (!config) {
      const { data: c } = await db
        .from("invoice_config")
        .insert({ department_id: department.id, profile_id: profiles[0]?.id ?? null })
        .select("*")
        .single();
      config = (c as InvoiceConfigT | null) ?? null;
    }
  } catch {
    config = null;
    profiles = [];
  }

  // Latest run + its rows for the grid on load.
  let latestRun: InvoiceRunSummary | null = null;
  let latestRows: InvoiceRow[] = [];
  let runs: InvoiceRunSummary[] = [];
  let resume: { runId: string; total: number; processed: number } | null = null;
  try {
    const { data: runList } = await db
      .from("invoice_runs")
      .select("id, created_at, created_by_email, status, counts")
      .eq("department_id", department.id)
      .order("created_at", { ascending: false })
      .limit(25);
    runs = (runList ?? []) as InvoiceRunSummary[];
    latestRun = runs[0] ?? null;

    if (latestRun) {
      const { data: rows } = await db
        .from("invoice_rows")
        .select("*")
        .eq("run_id", latestRun.id)
        .order("created_at");
      latestRows = (rows ?? []) as InvoiceRow[];
    }

    const { data: runningRun } = await db
      .from("invoice_runs")
      .select("id, cursor, worklist")
      .eq("department_id", department.id)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    resume = runningRun
      ? {
          runId: runningRun.id as string,
          total: Array.isArray(runningRun.worklist) ? runningRun.worklist.length : 0,
          processed: (runningRun.cursor as number) ?? 0,
        }
      : null;
  } catch {
    runs = [];
    latestRun = null;
    latestRows = [];
    resume = null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">Invoice → Zoho Bills</h1>
        <p className="mb-6 text-sm text-gray-500">
          OCR invoice emails from a Gmail label into the 36-column Zoho purchase-bill template, then export a Zoho-ready Excel.
        </p>
      </div>
      <InvoicePageClient
        connected={!!conn}
        connectedEmail={conn?.google_email ?? null}
        config={config}
        profiles={profiles}
        latestRunId={latestRun?.id ?? null}
        latestRows={latestRows}
        runs={runs}
        resume={resume}
        canManage={canManage}
      />
    </div>
  );
}
