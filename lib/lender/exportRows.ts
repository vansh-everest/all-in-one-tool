import type { TrackerLender, UnifiedGrid } from "./types";

export const EXPORT_HEADERS = [
  "Lender", "Owner", "Item", "Status", "Last Update", "Direction", "Source Message",
];

export function trackerToRows(tracker: TrackerLender[]): string[][] {
  const rows: string[][] = [];
  for (const t of tracker) {
    for (const it of t.items) {
      rows.push([
        t.lender_name,
        t.owner ?? "",
        it.item,
        it.status,
        it.last_update_date ?? "",
        it.direction,
        it.source_message_id,
      ]);
    }
  }
  return rows;
}

export const GRID_EXPORT_HEADERS = ["Lender", "Owner", "Item", "Source", "Status", "Last Update"];

/** One row per grid item, tagged with its origin (sheet vs email). */
export function gridToRows(grid: UnifiedGrid): string[][] {
  const rows: string[][] = [];
  for (const col of grid.columns) {
    for (const it of col.items) {
      rows.push([col.name, col.owner ?? "", it.text, it.source, it.status, it.last_update_date ?? ""]);
    }
  }
  return rows;
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function rowsToCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\n");
}
