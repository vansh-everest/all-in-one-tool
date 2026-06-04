import type { createAdminClient } from "@/utils/supabase/admin";
import type { Extraction, Finding, GridColumn, GridItem, StoredSheetColumn, UnifiedGrid } from "./types";

type DB = ReturnType<typeof createAdminClient>;
type LenderMeta = Map<string, { name: string; owner: string | null }>;

/** Matched email threads for a specific run (vendor, subject, date, extracted tasks). */
export async function buildRunFindings(db: DB, departmentId: string, runId: string, lenderById?: LenderMeta): Promise<Finding[]> {
  let meta = lenderById;
  if (!meta) {
    meta = new Map();
    const { data } = await db.from("lenders").select("id, name, owner").eq("department_id", departmentId);
    for (const l of data ?? []) meta.set(l.id as string, { name: l.name as string, owner: (l.owner as string) ?? null });
  }
  const { data: cache } = await db
    .from("lender_message_cache")
    .select("message_id, lender_id, subject, internal_date, extraction")
    .eq("department_id", departmentId)
    .eq("run_id", runId);
  const findings: Finding[] = [];
  for (const row of cache ?? []) {
    const lenderId = (row.lender_id as string) ?? null;
    const lender = lenderId ? meta.get(lenderId) : undefined;
    const ext = (row.extraction ?? { items: [], last_contact_date: null }) as Extraction;
    findings.push({
      lender_id: lenderId,
      lender_name: lender?.name ?? "(unknown)",
      owner: lender?.owner ?? null,
      subject: (row.subject as string) ?? "(no subject)",
      email_date: (row.internal_date as string) ?? null,
      source_message_id: (row.message_id as string) ?? null,
      items: ext.items.map((i) => i.item),
    });
  }
  findings.sort((a, b) => (b.email_date ?? "").localeCompare(a.email_date ?? ""));
  return findings;
}

/**
 * Build the unified per-lender grid from lender_items (the single editable source of truth):
 * sheet imports, email-found tasks, and manual adds are all rows there. Column order follows
 * the imported sheet. Also returns per-thread findings (incl. matched threads with no task)
 * from the latest email run's run-scoped message cache.
 */
export async function buildUnifiedGrid(db: DB, departmentId: string): Promise<UnifiedGrid> {
  const { data: lendersData } = await db.from("lenders").select("id, name, owner").eq("department_id", departmentId);
  const lenderById = new Map<string, { name: string; owner: string | null }>();
  for (const l of lendersData ?? []) lenderById.set(l.id as string, { name: l.name as string, owner: (l.owner as string) ?? null });

  // Column order from the most recent import.
  const { data: importedRun } = await db
    .from("lender_runs")
    .select("summary")
    .eq("department_id", departmentId)
    .eq("status", "imported")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sheetColumns: StoredSheetColumn[] = (importedRun?.summary?.grid?.columns ?? []) as StoredSheetColumn[];
  const order: string[] = sheetColumns.map((c) => c.lender_id).filter((x): x is string => !!x);

  // All editable items.
  const { data: itemRows } = await db
    .from("lender_items")
    .select("id, lender_id, text, source, source_message_id, email_date, done, position, created_at")
    .eq("department_id", departmentId)
    .order("position")
    .order("created_at");
  const itemsByLender = new Map<string, GridItem[]>();
  for (const it of itemRows ?? []) {
    const key = (it.lender_id as string) ?? "none";
    const arr = itemsByLender.get(key) ?? [];
    arr.push({
      id: it.id as string,
      text: (it.text as string) ?? "",
      done: !!it.done,
      source: (it.source as GridItem["source"]) ?? "manual",
      source_message_id: (it.source_message_id as string) ?? null,
      email_date: (it.email_date as string) ?? null,
    });
    itemsByLender.set(key, arr);
  }

  // Build columns: imported order first, then any other lenders (with items, or all active).
  const columns: GridColumn[] = [];
  const used = new Set<string>();
  const pushCol = (lenderId: string) => {
    used.add(lenderId);
    const meta = lenderById.get(lenderId);
    columns.push({ lender_id: lenderId, name: meta?.name ?? "(unknown)", owner: meta?.owner ?? null, items: itemsByLender.get(lenderId) ?? [] });
  };
  for (const id of order) if (lenderById.has(id) && !used.has(id)) pushCol(id);
  // Remaining lenders (e.g. added after import) sorted by name.
  const remaining = [...lenderById.keys()].filter((id) => !used.has(id)).sort((a, b) => (lenderById.get(a)!.name).localeCompare(lenderById.get(b)!.name));
  for (const id of remaining) pushCol(id);
  // Items with no lender (shouldn't normally happen) as a trailing column.
  if (itemsByLender.has("none")) columns.push({ lender_id: null, name: "(unassigned)", owner: null, items: itemsByLender.get("none")! });

  // Findings from the latest completed email run (run-scoped message cache).
  const { data: emailRun } = await db
    .from("lender_runs")
    .select("id")
    .eq("department_id", departmentId)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const findings = emailRun?.id ? await buildRunFindings(db, departmentId, emailRun.id, lenderById) : [];

  const allItems = columns.flatMap((c) => c.items);
  return {
    columns,
    counts: {
      lenders_with_items: columns.filter((c) => c.items.some((i) => !i.done)).length,
      open_items: allItems.filter((i) => !i.done).length,
      sheet_items: allItems.filter((i) => i.source === "sheet").length,
      email_items: allItems.filter((i) => i.source === "email").length,
      done: allItems.filter((i) => i.done).length,
    },
    findings,
  };
}
