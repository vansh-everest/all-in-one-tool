export type SsDetail = { name?: string; amount: number | null; readable?: boolean };

/**
 * Render a per-screenshot breakdown like "SS1: 6708; SS2: 3000 | Total: 9708".
 * Used in the drill-down, write-back tab, and exports so each screenshot's
 * contribution and the row total are visible alongside the expected amount.
 */
export function breakdownString(details: SsDetail[]): string {
  if (details.length === 0) return "";
  const parts = details.map((d, i) => `SS${i + 1}: ${d.amount == null ? "unreadable" : d.amount}`);
  const total = details.reduce((s, d) => s + (d.amount ?? 0), 0);
  return `${parts.join("; ")} | Total: ${total}`;
}
