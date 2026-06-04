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

  // Persist the sheet's lender columns in order (for the grid's column order + names/owners).
  const gridColumns = parsed.lenders.map((pl) => {
    const l = byNorm.get(normalizeLenderName(pl.name));
    return {
      lender_id: l?.id ?? null,
      name: l?.name ?? pl.name,
      owner: l?.owner ?? pl.owner ?? null,
      items: parsed.items.filter((it) => it.lenderName === pl.name).map((it) => it.item),
    };
  });

  // Replace the sheet-sourced editable items with this import's contents.
  await db.from("lender_items").delete().eq("department_id", departmentId).eq("source", "sheet");
  const itemRows = parsed.items
    .map((it, idx) => {
      const l = byNorm.get(normalizeLenderName(it.lenderName));
      if (!l) return null;
      return { department_id: departmentId, lender_id: l.id, position: idx, text: it.item, source: "sheet" };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  for (let i = 0; i < itemRows.length; i += 500) {
    await db.from("lender_items").insert(itemRows.slice(i, i + 500));
  }

  const lendersWithItems = new Set(itemRows.map((r) => r.lender_id)).size;
  const counts = { unread_total: 0, matched: 0, queued: 0, lenders_with_items: lendersWithItems, open_items: itemRows.length };

  const { data: run } = await db
    .from("lender_runs")
    .insert({
      department_id: departmentId,
      created_by_email: createdByEmail,
      status: "imported",
      worklist: [],
      cursor: 0,
      counts,
      summary: { source: "sheet-import", grid: { columns: gridColumns } },
      activities: [
        { at: new Date().toISOString(), message: `Imported ${parsed.lenders.length} lenders and ${itemRows.length} pending items from a sheet` },
      ],
    })
    .select("id")
    .single();

  return {
    runId: run?.id ?? null,
    lenders: parsed.lenders.length,
    lendersCreated,
    lendersUpdated,
    items: itemRows.length,
    lendersWithItems,
  };
}
