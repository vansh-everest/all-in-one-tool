"use client";
import { useState } from "react";
import type { ColumnFilter, ConditionOp } from "@/lib/scrap-scale/filters";

const TEXT_OPS: { v: ConditionOp; label: string }[] = [
  { v: "contains", label: "contains" },
  { v: "not_contains", label: "does not contain" },
  { v: "equals", label: "is exactly" },
  { v: "starts_with", label: "starts with" },
  { v: "ends_with", label: "ends with" },
  { v: "empty", label: "is empty" },
  { v: "not_empty", label: "is not empty" },
];
const NUM_OPS: { v: ConditionOp; label: string }[] = [
  { v: "eq", label: "=" },
  { v: "neq", label: "≠" },
  { v: "gt", label: ">" },
  { v: "gte", label: "≥" },
  { v: "lt", label: "<" },
  { v: "lte", label: "≤" },
  { v: "between", label: "between" },
];
const DATE_OPS: { v: ConditionOp; label: string }[] = [
  { v: "date_is", label: "is" },
  { v: "date_before", label: "before" },
  { v: "date_after", label: "after" },
  { v: "date_between", label: "between" },
];

type ColType = "text" | "number" | "date";
type ColumnValues = { values: { value: string; count: number }[]; type: ColType };

export function FilterPanel({
  headers,
  filters,
  onChange,
  loadValues,
}: {
  headers: string[];
  filters: ColumnFilter[];
  onChange: (f: ColumnFilter[]) => void;
  loadValues: (index: number) => Promise<ColumnValues>;
}) {
  const [valueCache, setValueCache] = useState<Record<number, ColumnValues>>({});

  function update(i: number, patch: Partial<ColumnFilter>) {
    onChange(filters.map((f, idx) => (idx === i ? ({ ...f, ...patch } as ColumnFilter) : f)));
  }
  function remove(i: number) {
    onChange(filters.filter((_, idx) => idx !== i));
  }
  async function ensureValues(index: number) {
    if (valueCache[index]) return;
    const data = await loadValues(index);
    setValueCache((c) => ({ ...c, [index]: data }));
  }
  async function addValuesFilter() {
    onChange([...filters, { index: 0, mode: "values", values: [] }]);
    await ensureValues(0);
  }
  function addConditionFilter() {
    onChange([...filters, { index: 0, mode: "condition", op: "contains", value: "" }]);
  }
  function opsFor(type: ColType) {
    return type === "number" ? NUM_OPS : type === "date" ? DATE_OPS : TEXT_OPS;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">Filters — only rows matching all filters are processed</span>
        <div className="flex gap-2">
          <button onClick={addValuesFilter} className="rounded border px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
            + By values
          </button>
          <button onClick={addConditionFilter} className="rounded border px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
            + By condition
          </button>
        </div>
      </div>
      {filters.length === 0 && <p className="text-xs text-gray-400">No filters — all rows will be processed.</p>}
      {filters.map((f, i) => {
        const type = valueCache[f.index]?.type ?? "text";
        return (
          <div key={i} className="rounded border p-2">
            <div className="mb-2 flex items-center gap-2">
              <select
                value={f.index}
                onChange={(e) => {
                  const index = Number(e.target.value);
                  update(i, { index });
                  if (f.mode === "values") ensureValues(index);
                }}
                className="rounded border px-2 py-1 text-sm text-gray-900"
              >
                {headers.map((h, idx) => (
                  <option key={idx} value={idx}>
                    {h || `(col ${idx + 1})`}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-400">{f.mode === "values" ? "by values" : "by condition"}</span>
              <button onClick={() => remove(i)} className="ml-auto rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                Remove
              </button>
            </div>

            {f.mode === "values" ? (
              <div className="max-h-40 overflow-y-auto rounded border p-2">
                {(valueCache[f.index]?.values ?? []).map(({ value, count }) => {
                  const checked = f.values.includes(value);
                  return (
                    <label key={value} className="flex items-center gap-2 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          update(i, {
                            values: e.target.checked ? [...f.values, value] : f.values.filter((v) => v !== value),
                          } as Partial<ColumnFilter>)
                        }
                      />
                      <span className="truncate">{value || "(blank)"}</span>
                      <span className="ml-auto text-xs text-gray-400">{count}</span>
                    </label>
                  );
                })}
                {!valueCache[f.index] && <span className="text-xs text-gray-400">Loading values…</span>}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={f.op}
                  onChange={(e) => update(i, { op: e.target.value as ConditionOp })}
                  className="rounded border px-2 py-1 text-sm text-gray-900"
                >
                  {opsFor(type).map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {f.op !== "empty" && f.op !== "not_empty" && (
                  <input
                    value={f.value ?? ""}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder="value"
                    className="rounded border px-2 py-1 text-sm text-gray-900"
                  />
                )}
                {(f.op === "between" || f.op === "date_between") && (
                  <input
                    value={f.value2 ?? ""}
                    onChange={(e) => update(i, { value2: e.target.value })}
                    placeholder="and"
                    className="rounded border px-2 py-1 text-sm text-gray-900"
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
