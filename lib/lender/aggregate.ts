import type { Extraction, Lender, RunCounts, TrackerLender } from "./types";

/** Group extracted items by matched lender. Lenders with no items are omitted. */
export function aggregateTracker(
  lenders: Lender[],
  byMessage: { lenderId: string; extraction: Extraction }[],
): TrackerLender[] {
  const byId = new Map<string, Lender>(lenders.map((l) => [l.id, l]));
  const groups = new Map<string, TrackerLender>();
  for (const { lenderId, extraction } of byMessage) {
    if (!extraction.items.length) continue;
    const l = byId.get(lenderId);
    let g = groups.get(lenderId);
    if (!g) {
      g = { lender_id: lenderId, lender_name: l?.name ?? "(unknown)", owner: l?.owner ?? null, items: [] };
      groups.set(lenderId, g);
    }
    g.items.push(...extraction.items);
  }
  return [...groups.values()].sort((a, b) => a.lender_name.localeCompare(b.lender_name));
}

export function computeCounts(
  tracker: TrackerLender[],
  raw: { unreadTotal: number; matched: number; queued: number },
): RunCounts {
  return {
    unread_total: raw.unreadTotal,
    matched: raw.matched,
    queued: raw.queued,
    lenders_with_items: tracker.length,
    open_items: tracker.reduce((s, t) => s + t.items.length, 0),
  };
}
