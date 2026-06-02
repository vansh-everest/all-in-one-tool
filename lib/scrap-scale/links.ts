const ID_PATTERNS = [/[?&]id=([a-zA-Z0-9_-]+)/, /\/file\/d\/([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/];

export function parseDriveFileIds(cell: string): string[] {
  if (!cell) return [];
  const tokens = cell.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const token of tokens) {
    for (const re of ID_PATTERNS) {
      const m = token.match(re);
      if (m) {
        if (!ids.includes(m[1])) ids.push(m[1]);
        break;
      }
    }
  }
  return ids;
}

export function extractSpreadsheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}
