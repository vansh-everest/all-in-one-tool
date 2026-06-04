import type { createAdminClient } from "@/utils/supabase/admin";
import { normalizeLenderName } from "./importSheet";
import type { Direction, Finding, GridColumn, GridItem, StoredSheetColumn, UnifiedGrid } from "./types";

type DB = ReturnType<typeof createAdminClient>;

const dirOf = (v: unknown): Direction =>
  v === "awaiting_lender" || v === "action_on_us" ? v : "unclear";

/**
 * Build the unified per-lender grid: the imported sheet's columns/items, with the latest
 * email run's extracted undone tasks merged in (deduped against sheet items, tagged with
 * their email source + date). Also returns per-thread findings for the review cards.
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

  type EmailEntry = GridItem & { lender_id: string | null; lender_name: string; owner: string | null };
  const emailByLender = new Map<string, EmailEntry[]>();
  const findings: Finding[] = [];

  if (emailRun?.id) {
    const { data: items } = await db
      .from("lender_run_items")
      .select("lender_id, lender_name, owner, item, status, last_update_date, direction, source_message_id")
      .eq("run_id", emailRun.id);
    const rows = items ?? [];

    // Pull the source emails' subject + date from the message cache.
    const msgIds = [...new Set(rows.map((r) => r.source_message_id as string).filter(Boolean))];
    const cacheById = new Map<string, { subject: string | null; internal_date: string | null }>();
    if (msgIds.length) {
      const { data: cache } = await db
        .from("lender_message_cache")
        .select("message_id, subject, internal_date")
        .eq("department_id", departmentId)
        .in("message_id", msgIds);
      for (const c of cache ?? []) cacheById.set(c.message_id as string, { subject: (c.subject as string) ?? null, internal_date: (c.internal_date as string) ?? null });
    }

    const findingByMsg = new Map<string, Finding>();
    for (const it of rows) {
      const lenderKey = (it.lender_id as string) ?? `name:${normalizeLenderName(it.lender_name as string)}`;
      const srcId = (it.source_message_id as string) || null;
      const meta = srcId ? cacheById.get(srcId) : undefined;
      const emailDate = meta?.internal_date ?? null;
      const subject = meta?.subject ?? null;

      const arr = emailByLender.get(lenderKey) ?? [];
      arr.push({
        lender_id: (it.lender_id as string) ?? null,
        lender_name: (it.lender_name as string) ?? "(unknown)",
        owner: (it.owner as string) ?? null,
        text: (it.item as string) ?? "",
        status: (it.status as string) ?? "",
        last_update_date: (it.last_update_date as string) ?? null,
        direction: dirOf(it.direction),
        source_message_id: srcId,
        email_date: emailDate,
        subject,
        source: "email",
      });
      emailByLender.set(lenderKey, arr);

      // Group into one finding card per source email.
      const fkey = srcId ?? `${lenderKey}:${subject ?? ""}`;
      let f = findingByMsg.get(fkey);
      if (!f) {
        f = {
          lender_id: (it.lender_id as string) ?? null,
          lender_name: (it.lender_name as string) ?? "(unknown)",
          owner: (it.owner as string) ?? null,
          subject: subject ?? "(no subject)",
          email_date: emailDate,
          source_message_id: srcId,
          items: [],
        };
        findingByMsg.set(fkey, f);
      }
      if (it.item) f.items.push(it.item as string);
    }
    findings.push(...findingByMsg.values());
    findings.sort((a, b) => (b.email_date ?? "").localeCompare(a.email_date ?? ""));
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
      email_date: null,
      subject: null,
      source: "sheet" as const,
    }));
    const sheetNorm = new Set(sheetItems.map((i) => normalizeLenderName(i.text)));
    const emailItems = (emailByLender.get(key) ?? []).filter((e) => !sheetNorm.has(normalizeLenderName(e.text)));
    columns.push({ lender_id: sc.lender_id, name: sc.name, owner: sc.owner, items: [...sheetItems, ...emailItems.map(strip)] });
  }

  // Lenders that only have email findings (not in the imported sheet) get appended.
  for (const [key, items] of emailByLender) {
    if (usedKeys.has(key)) continue;
    columns.push({ lender_id: items[0].lender_id, name: items[0].lender_name, owner: items[0].owner, items: items.map(strip) });
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
    findings,
  };
}

function strip(e: GridItem & { lender_id?: string | null }): GridItem {
  return {
    text: e.text,
    status: e.status,
    last_update_date: e.last_update_date,
    direction: e.direction,
    source_message_id: e.source_message_id,
    email_date: e.email_date,
    subject: e.subject,
    source: e.source,
  };
}
