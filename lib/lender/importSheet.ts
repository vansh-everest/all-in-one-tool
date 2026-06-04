export type ParsedLender = { name: string; owner: string | null };
export type ParsedItem = { lenderName: string; item: string };
export type ParsedImport = { lenders: ParsedLender[]; items: ParsedItem[] };

/** Normalize a lender name for matching across spelling/casing/punctuation differences. */
export function normalizeLenderName(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parse the "Pendencies with Lenders" matrix layout, where lenders are COLUMNS:
 *   - a header row contains "Sr. No." in one column and lender names to its right
 *   - the row directly above the header row holds each lender's owner
 *   - every subsequent row holds one pending item per lender column (blank = none)
 * Columns whose header is empty or literally "Non Lender" are ignored.
 */
export function parsePendencyMatrix(rows: string[][]): ParsedImport {
  let headerRow = -1;
  let srCol = -1;
  for (let r = 0; r < rows.length; r++) {
    const c = (rows[r] ?? []).findIndex((cell) => normalizeLenderName(cell) === "srno");
    if (c >= 0) {
      headerRow = r;
      srCol = c;
      break;
    }
  }
  if (headerRow < 0) return { lenders: [], items: [] };

  const header = rows[headerRow] ?? [];
  const ownerRow = headerRow > 0 ? rows[headerRow - 1] ?? [] : [];

  const cols: { col: number; name: string; owner: string | null }[] = [];
  for (let c = srCol + 1; c < header.length; c++) {
    const name = (header[c] ?? "").trim();
    if (!name || normalizeLenderName(name) === "nonlender") continue;
    cols.push({ col: c, name, owner: (ownerRow[c] ?? "").trim() || null });
  }

  const items: ParsedItem[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (const c of cols) {
      const val = (row[c.col] ?? "").trim();
      if (val) items.push({ lenderName: c.name, item: val });
    }
  }

  return { lenders: cols.map((c) => ({ name: c.name, owner: c.owner })), items };
}
