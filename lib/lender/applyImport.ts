import type { createAdminClient } from "@/utils/supabase/admin";
import { normalizeLenderName, type ParsedImport } from "./importSheet";

type DB = ReturnType<typeof createAdminClient>;

export type ImportSummary = {
  runId: string | null;
  lenders: number;
  lendersCreated: number;
  lendersUpdated: number;
  items: number;
  lendersWithItems: number;
};

type LenderRow = { id: string; name: string; owner: string | null };

/**
 * Apply a parsed pendency-matrix import: upsert lenders (matched by normalized name,
 * setting owners), then save the current pendencies as an "imported" instance whose
 * lender_run_items become the baseline tracker. Reused by the API route and the
 * one-off CSV loader.
 */
export async function applyImport(
  db: DB,
  departmentId: string,
  createdByEmail: string,
  parsed: ParsedImport,
): Promise<ImportSummary> {
  const { data: existing } = await db
    .from("lenders")
    .select("id, name, owner")
    .eq("department_id", departmentId);
  const byNorm = new Map<string, LenderRow>();
  (existing ?? []).forEach((l) => byNorm.set(normalizeLenderName(l.name as string), l as LenderRow));

  let lendersCreated = 0;
  let lendersUpdated = 0;
  for (const pl of parsed.lenders) {
    const key = normalizeLenderName(pl.name);
    const ex = byNorm.get(key);
    if (ex) {
      if (pl.owner && ex.owner !== pl.owner) {
        await db.from("lenders").update({ owner: pl.owner }).eq("id", ex.id);
        byNorm.set(key, { ...ex, owner: pl.owner });
        lendersUpdated++;
      }
    } else {
      const { data: ins } = await db
        .from("lenders")
        .insert({ department_id: departmentId, name: pl.name, owner: pl.owner, active: true })
        .select("id, name, owner")
        .single();
      if (ins) {
        byNorm.set(key, ins as LenderRow);
        lendersCreated++;
      }
    }
  }

  const itemRows = parsed.items
    .map((it) => {
      const l = byNorm.get(normalizeLenderName(it.lenderName));
      if (!l) return null;
      return {
        lender_id: l.id,
        lender_name: l.name,
        owner: l.owner ?? null,
        item: it.item,
        status: "",
        last_update_date: null as string | null,
        direction: "unclear",
        source_message_id: "",
        thread_id: null as string | null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const lendersWithItems = new Set(itemRows.map((r) => r.lender_id)).size;
  const counts = {
    unread_total: 0,
    matched: 0,
    queued: 0,
    lenders_with_items: lendersWithItems,
    open_items: itemRows.length,
  };

  const { data: run } = await db
    .from("lender_runs")
    .insert({
      department_id: departmentId,
      created_by_email: createdByEmail,
      status: "imported",
      worklist: [],
      cursor: 0,
      counts,
      summary: { source: "sheet-import" },
      activities: [
        { at: new Date().toISOString(), message: `Imported ${parsed.lenders.length} lenders and ${itemRows.length} pending items from a sheet` },
      ],
    })
    .select("id")
    .single();

  if (run?.id && itemRows.length) {
    const withRun = itemRows.map((r) => ({ ...r, run_id: run.id }));
    for (let i = 0; i < withRun.length; i += 500) {
      await db.from("lender_run_items").insert(withRun.slice(i, i + 500));
    }
  }

  return {
    runId: run?.id ?? null,
    lenders: parsed.lenders.length,
    lendersCreated,
    lendersUpdated,
    items: itemRows.length,
    lendersWithItems,
  };
}
