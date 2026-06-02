export type FilterOp = "contains" | "equals" | "not_empty" | "empty";

export type ColumnFilter = {
  index: number;
  op: FilterOp;
  value?: string;
};

const needsValue = (op: FilterOp) => op === "contains" || op === "equals";

function cellMatches(cell: string, f: ColumnFilter): boolean {
  const c = (cell ?? "").trim();
  const v = (f.value ?? "").trim().toLowerCase();
  switch (f.op) {
    case "empty":
      return c === "";
    case "not_empty":
      return c !== "";
    case "equals":
      return c.toLowerCase() === v;
    case "contains":
      return c.toLowerCase().includes(v);
    default:
      return true;
  }
}

/**
 * A row passes when it matches EVERY filter (AND semantics). A contains/equals
 * filter with a blank value is ignored (treated as no constraint), so a
 * half-filled filter row in the UI doesn't silently drop everything.
 */
export function rowPassesFilters(row: string[], filters: ColumnFilter[]): boolean {
  return filters.every((f) => {
    if (needsValue(f.op) && !(f.value ?? "").trim()) return true;
    return cellMatches(row[f.index] ?? "", f);
  });
}
