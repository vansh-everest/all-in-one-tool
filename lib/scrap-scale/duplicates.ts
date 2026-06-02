function normalize(txn: string): string {
  return txn.replace(/\s+/g, "").toUpperCase();
}

export function markDuplicates(
  rows: { row_index: number; txnIds: string[] }[],
): Map<number, boolean> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.txnIds) {
      if (!t) continue;
      const key = normalize(t);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const result = new Map<number, boolean>();
  for (const r of rows) {
    const dup = r.txnIds.some((t) => t && (counts.get(normalize(t)) ?? 0) > 1);
    result.set(r.row_index, dup);
  }
  return result;
}
