export type TextOp =
  | "contains"
  | "not_contains"
  | "equals"
  | "starts_with"
  | "ends_with"
  | "empty"
  | "not_empty";
export type NumOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between";
export type DateOp = "date_is" | "date_before" | "date_after" | "date_between";
export type ConditionOp = TextOp | NumOp | DateOp;

export type ColumnFilter =
  | { index: number; mode: "values"; values: string[] }
  | { index: number; mode: "condition"; op: ConditionOp; value?: string; value2?: string };

const valuelessOps = new Set<ConditionOp>(["empty", "not_empty"]);
const TEXT_OPS = new Set<ConditionOp>([
  "contains",
  "not_contains",
  "equals",
  "starts_with",
  "ends_with",
  "empty",
  "not_empty",
]);
const NUM_OPS = new Set<ConditionOp>(["eq", "neq", "gt", "gte", "lt", "lte", "between"]);

function num(s: string): number | null {
  const t = s.replace(/[^0-9.\-]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse dd/mm/yyyy or ISO yyyy-mm-dd to a UTC timestamp (ms), else null. */
export function parseDate(s: string): number | null {
  const t = s.trim();
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function textMatch(cell: string, op: TextOp, v: string): boolean {
  const c = cell.trim().toLowerCase();
  const val = v.trim().toLowerCase();
  switch (op) {
    case "empty": return c === "";
    case "not_empty": return c !== "";
    case "contains": return c.includes(val);
    case "not_contains": return !c.includes(val);
    case "equals": return c === val;
    case "starts_with": return c.startsWith(val);
    case "ends_with": return c.endsWith(val);
  }
}

function numMatch(cell: string, op: NumOp, v: string, v2?: string): boolean {
  const c = num(cell);
  const a = num(v);
  if (c === null || a === null) return false;
  switch (op) {
    case "eq": return c === a;
    case "neq": return c !== a;
    case "gt": return c > a;
    case "gte": return c >= a;
    case "lt": return c < a;
    case "lte": return c <= a;
    case "between": {
      const b = num(v2 ?? "");
      return b !== null && c >= Math.min(a, b) && c <= Math.max(a, b);
    }
  }
}

function dateMatch(cell: string, op: DateOp, v: string, v2?: string): boolean {
  const c = parseDate(cell);
  const a = parseDate(v);
  if (c === null || a === null) return false;
  switch (op) {
    case "date_is": return c === a;
    case "date_before": return c < a;
    case "date_after": return c > a;
    case "date_between": {
      const b = parseDate(v2 ?? "");
      return b !== null && c >= Math.min(a, b) && c <= Math.max(a, b);
    }
  }
}

function conditionPasses(cell: string, op: ConditionOp, value?: string, value2?: string): boolean {
  if (valuelessOps.has(op)) return textMatch(cell, op as TextOp, "");
  if (!(value ?? "").trim()) return true; // blank value = no constraint
  if (TEXT_OPS.has(op)) return textMatch(cell, op as TextOp, value!);
  if (NUM_OPS.has(op)) return numMatch(cell, op as NumOp, value!, value2);
  return dateMatch(cell, op as DateOp, value!, value2);
}

/** A row is kept iff it satisfies EVERY filter (AND across columns). */
export function rowPassesFilters(row: string[], filters: ColumnFilter[]): boolean {
  return filters.every((f) => {
    const cell = row[f.index] ?? "";
    if (f.mode === "values") {
      if (!f.values?.length) return true;
      const set = new Set(f.values.map((v) => v.trim().toLowerCase()));
      return set.has(cell.trim().toLowerCase());
    }
    return conditionPasses(cell, f.op, f.value, f.value2);
  });
}
