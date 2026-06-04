import type { createAdminClient } from "@/utils/supabase/admin";
import { normalizeLenderName } from "./importSheet";
import type { Direction, GridColumn, GridItem, StoredSheetColumn, UnifiedGrid } from "./types";

type DB = ReturnType<typeof createAdminClient>;

const dirOf = (v: unknown): Direction =>
  v === "awaiting_lender" || v === "action_on_us" ? v : "unclear";

/**
 * Build the unified per-lender grid: the imported sheet's columns/items, with the latest
 * email run's extracted undone tasks merged in (deduped against sheet items, tagged with
 * their email source). This is the single source of truth the tracker renders.
 */
export async function buildUnifiedGrid(db: DB, departmentId: string): Promise<UnifiedGrid> {
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

  // Email-found items from the most recent completed email run.
  const { data: emailRun } = await db
    .from("lender_runs")
    .select("id")
    .eq("department_id", departmentId)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  type EmailItem = { lender_id: string | null; lender_name: string; owner: string | null } & GridItem;
  const emailByLender = new Map<string, EmailItem[]>();
  if (emailRun?.id) {
    const { data: items } = await db
      .from("lender_run_items")
      .select("lender_id, lender_name, owner, item, status, last_update_date, direction, source_message_id")
      .eq("run_id", emailRun.id);
    for (const it of items ?? []) {
      const key = (it.lender_id as string) ?? `name:${normalizeLenderName(it.lender_name as string)}`;
      const arr = emailByLender.get(key) ?? [];
      arr.push({
        lender_id: (it.lender_id as string) ?? null,
        lender_name: (it.lender_name as string) ?? "(unknown)",
        owner: (it.owner as string) ?? null,
        text: (it.item as string) ?? "",
        status: (it.status as string) ?? "",
        last_update_date: (it.last_update_date as string) ?? null,
        direction: dirOf(it.direction),
        source_message_id: (it.source_message_id as string) || null,
        source: "email",
      });
      emailByLender.set(key, arr);
    }
  }

  const columns: GridColumn[] = [];
  const usedKeys = new Set<string>();

  for (const sc of sheetColumns) {
    const key = sc.lender_id ?? `name:${normalizeLenderName(sc.name)}`;
    usedKeys.add(key);
    const sheetItems: GridItem[] = (sc.items ?? []).map((text) => ({
      text,
      status: "",
      last_update_date: null,
      direction: "unclear" as Direction,
      source_message_id: null,
      source: "sheet" as const,
    }));
    const sheetNorm = new Set(sheetItems.map((i) => normalizeLenderName(i.text)));
    const emailItems = (emailByLender.get(key) ?? []).filter((e) => !sheetNorm.has(normalizeLenderName(e.text)));
    columns.push({
      lender_id: sc.lender_id,
      name: sc.name,
      owner: sc.owner,
      items: [...sheetItems, ...emailItems.map(stripLender)],
    });
  }

  // Lenders that only have email findings (not in the imported sheet) get appended.
  for (const [key, items] of emailByLender) {
    if (usedKeys.has(key)) continue;
    columns.push({
      lender_id: items[0].lender_id,
      name: items[0].lender_name,
      owner: items[0].owner,
      items: items.map(stripLender),
    });
  }

  const open_items = columns.reduce((s, c) => s + c.items.length, 0);
  const sheet_items = columns.reduce((s, c) => s + c.items.filter((i) => i.source === "sheet").length, 0);
  return {
    columns,
    counts: {
      lenders_with_items: columns.filter((c) => c.items.length > 0).length,
      open_items,
      sheet_items,
      email_items: open_items - sheet_items,
    },
  };
}

function stripLender(e: { text: string; status: string; last_update_date: string | null; direction: Direction; source_message_id: string | null; source: "sheet" | "email" }): GridItem {
  return {
    text: e.text,
    status: e.status,
    last_update_date: e.last_update_date,
    direction: e.direction,
    source_message_id: e.source_message_id,
    source: e.source,
  };
}
