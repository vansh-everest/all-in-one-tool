import type { createAdminClient } from "@/utils/supabase/admin";
import { normalizeLenderName } from "./importSheet";
import type { Direction, Extraction, Finding, GridColumn, GridItem, StoredSheetColumn, UnifiedGrid } from "./types";

type DB = ReturnType<typeof createAdminClient>;

const dirOf = (v: unknown): Direction =>
  v === "awaiting_lender" || v === "action_on_us" ? v : "unclear";

const sheetItem = (text: string): GridItem => ({
  text, status: "", last_update_date: null, direction: "unclear", source_message_id: null,
  email_date: null, subject: null, manual_id: null, source: "sheet",
});

/**
 * Build the unified per-lender grid: the imported sheet's columns, the latest email run's
 * extracted tasks (merged in, deduped, tagged with the source email + date), and any
 * manually-added items. Also returns per-thread findings (including matched threads that
 * produced no task) for the review cards.
 */
export async function buildUnifiedGrid(db: DB, departmentId: string): Promise<UnifiedGrid> {
  // lender id -> {name, owner} for labelling email/manual-only columns.
  const { data: lendersData } = await db.from("lenders").select("id, name, owner").eq("department_id", departmentId);
  const lenderById = new Map<string, { name: string; owner: string | null }>();
  for (const l of lendersData ?? []) lenderById.set(l.id as string, { name: l.name as string, owner: (l.owner as string) ?? null });

  // Sheet columns from the most recent import.
  const { data: importedRun } = await db
    .from("lender_runs")
    .select("summary")
    .eq("department_id", departmentId)
    .eq("status", "imported")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sheetColumns: StoredSheetColumn[] = (importedRun?.summary?.grid?.columns ?? []) as StoredSheetColumn[];

  // Email findings from the most recent completed email run (run-scoped message cache, so
  // even matched threads that produced no task are surfaced as findings).
  const { data: emailRun } = await db
    .from("lender_runs")
    .select("id")
    .eq("department_id", departmentId)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const emailByLender = new Map<string, GridItem[]>();
  const findings: Finding[] = [];
  if (emailRun?.id) {
    const { data: cache } = await db
      .from("lender_message_cache")
      .select("message_id, lender_id, thread_id, subject, internal_date, extraction")
      .eq("department_id", departmentId)
      .eq("run_id", emailRun.id);
    for (const row of cache ?? []) {
      const lenderId = (row.lender_id as string) ?? null;
      const key = lenderId ?? "none";
      const ext = (row.extraction ?? { items: [], last_contact_date: null }) as Extraction;
      const emailDate = (row.internal_date as string) ?? null;
      const subject = (row.subject as string) ?? null;
      const srcId = (row.message_id as string) ?? null;

      const arr = emailByLender.get(key) ?? [];
      for (const it of ext.items) {
        arr.push({
          text: it.item,
          status: it.status,
          last_update_date: it.last_update_date,
          direction: dirOf(it.direction),
          source_message_id: srcId,
          email_date: emailDate,
          subject,
          manual_id: null,
          source: "email",
        });
      }
      emailByLender.set(key, arr);

      const lender = lenderId ? lenderById.get(lenderId) : undefined;
      findings.push({
        lender_id: lenderId,
        lender_name: lender?.name ?? "(unknown)",
        owner: lender?.owner ?? null,
        subject: subject ?? "(no subject)",
        email_date: emailDate,
        source_message_id: srcId,
        items: ext.items.map((i) => i.item),
      });
    }
    findings.sort((a, b) => (b.email_date ?? "").localeCompare(a.email_date ?? ""));
  }

  // Manually-added items.
  const { data: manualRows } = await db
    .from("lender_manual_items")
    .select("id, lender_id, item")
    .eq("department_id", departmentId)
    .order("created_at");
  const manualByLender = new Map<string, GridItem[]>();
  for (const m of manualRows ?? []) {
    const key = (m.lender_id as string) ?? "none";
    const arr = manualByLender.get(key) ?? [];
    arr.push({
      text: (m.item as string) ?? "",
      status: "", last_update_date: null, direction: "unclear",
      source_message_id: null, email_date: null, subject: null,
      manual_id: m.id as string, source: "manual",
    });
    manualByLender.set(key, arr);
  }

  const columns: GridColumn[] = [];
  const usedKeys = new Set<string>();

  const mergeFor = (key: string, sheetItems: GridItem[]): GridItem[] => {
    const sheetNorm = new Set(sheetItems.map((i) => normalizeLenderName(i.text)));
    const email = (emailByLender.get(key) ?? []).filter((e) => !sheetNorm.has(normalizeLenderName(e.text)));
    const manual = manualByLender.get(key) ?? [];
    return [...sheetItems, ...email, ...manual];
  };

  for (const sc of sheetColumns) {
    const key = sc.lender_id ?? "none";
    usedKeys.add(key);
    columns.push({ lender_id: sc.lender_id, name: sc.name, owner: sc.owner, items: mergeFor(key, (sc.items ?? []).map(sheetItem)) });
  }

  // Lenders with only email/manual items (not in the imported sheet) get appended.
  const extraKeys = new Set<string>([...emailByLender.keys(), ...manualByLender.keys()].filter((k) => !usedKeys.has(k)));
  for (const key of extraKeys) {
    const lender = key !== "none" ? lenderById.get(key) : undefined;
    columns.push({ lender_id: key === "none" ? null : key, name: lender?.name ?? "(unassigned)", owner: lender?.owner ?? null, items: mergeFor(key, []) });
  }

  const open_items = columns.reduce((s, c) => s + c.items.length, 0);
  const sheet_items = columns.reduce((s, c) => s + c.items.filter((i) => i.source === "sheet").length, 0);
  const email_items = columns.reduce((s, c) => s + c.items.filter((i) => i.source === "email").length, 0);
  return {
    columns,
    counts: { lenders_with_items: columns.filter((c) => c.items.length > 0).length, open_items, sheet_items, email_items },
    findings,
  };
}
