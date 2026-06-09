export function gmailDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${y}/${m}/${d}`;
}

/** Gmail's `after:` is exclusive of the given day's start, so subtract one day to include `sinceDate`. */
export function buildInvoiceQuery(label: string, sinceDate: string | null): string {
  const base = `label:"${label.replace(/"/g, "")}"`;
  if (!sinceDate) return base;
  const dt = new Date(sinceDate + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${base} after:${gmailDate(dt.toISOString())}`;
}
