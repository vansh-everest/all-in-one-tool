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
  sample,
  filters,
  onChange,
  loadValues,
}: {
  headers: string[];
  sample: string[][];
  filters: ColumnFilter[];
  onChange: (f: ColumnFilter[]) => void;
  loadValues: (index: number) => Promise<ColumnValues>;
}) {
  const [mode, setMode] = useState<"sheet" | "manual">("sheet");
  const [valueCache, setValueCache] = useState<Record<number, ColumnValues>>({});
  const [openCol, setOpenCol] = useState<number | null>(null);
  const [colSearch, setColSearch] = useState<Record<number, string>>({});
  const [colSort, setColSort] = useState<Record<number, "az" | "za">>({});

  async function ensureValues(index: number) {
    if (valueCache[index]) return;
    const data = await loadValues(index);
    setValueCache((c) => ({ ...c, [index]: data }));
  }

  // ----- "filter by values" helpers (shared by Sheet view + Manual) -----
  function valuesFilter(index: number): Extract<ColumnFilter, { mode: "values" }> | undefined {
    return filters.find((f) => f.mode === "values" && f.index === index) as
      | Extract<ColumnFilter, { mode: "values" }>
      | undefined;
  }
  function setValues(index: number, values: string[]) {
    const others = filters.filter((f) => !(f.mode === "values" && f.index === index));
    onChange(values.length ? [...others, { index, mode: "values", values }] : others);
  }
  function toggleValue(index: number, value: string) {
    const cur = valuesFilter(index)?.values ?? [];
    setValues(index, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  }

  async function openColumn(index: number) {
    if (openCol === index) {
      setOpenCol(null);
      return;
    }
    setOpenCol(index);
    await ensureValues(index);
  }

  // ----- Manual mode helpers -----
  function update(i: number, patch: Partial<ColumnFilter>) {
    onChange(filters.map((f, idx) => (idx === i ? ({ ...f, ...patch } as ColumnFilter) : f)));
  }
  function removeAt(i: number) {
    onChange(filters.filter((_, idx) => idx !== i));
  }
  async function addValuesFilter() {
    onChange([...filters, { index: 0, mode: "values", values: [] }]);
    await ensureValues(0);
  }
  function addConditionFilter() {
    onChange([...filters, { index: 0, mode: "condition", op: "contains", value: "" }]);
  }
  const opsFor = (type: ColType) => (type === "number" ? NUM_OPS : type === "date" ? DATE_OPS : TEXT_OPS);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-secondary">Filters — only rows matching all filters are processed</span>
        <div className="inline-flex rounded-lg bg-surface-secondary p-0.5 text-xs">
          {(["sheet", "manual"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 transition-colors ${
                mode === m ? "bg-surface font-medium text-ink shadow-cal-sm" : "text-ink-tertiary hover:text-ink-secondary"
              }`}
            >
              {m === "sheet" ? "Sheet view" : "Manual"}
            </button>
          ))}
        </div>
      </div>

      {mode === "sheet" ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-surface-secondary">
                {headers.map((h, i) => {
                  const active = !!valuesFilter(i)?.values.length;
                  return (
                    <th key={i} className="relative whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-medium text-ink-secondary">
                      <div className="flex items-center gap-1">
                        <span className="max-w-[160px] truncate" title={h}>
                          {h || `(col ${i + 1})`}
                        </span>
                        <button
                          onClick={() => openColumn(i)}
                          className={`rounded px-1 leading-none ${active ? "bg-brand text-white" : "text-ink-tertiary hover:bg-line"}`}
                          title="Filter this column"
                        >
                          ▾
                        </button>
                      </div>
                      {openCol === i && (() => {
                        const all = valueCache[i]?.values ?? [];
                        const sort = colSort[i] ?? "az";
                        const q = (colSearch[i] ?? "").toLowerCase();
                        const shown = all
                          .filter(({ value }) => !q || (value || "(blank)").toLowerCase().includes(q))
                          .slice()
                          .sort((a, b) => (sort === "az" ? a.value.localeCompare(b.value) : b.value.localeCompare(a.value)));
                        const sel = valuesFilter(i)?.values ?? [];
                        return (
                          <div className="absolute left-0 z-20 mt-1 w-64 rounded-lg border border-line bg-surface p-2 text-ink shadow-cal-lg">
                            <div className="mb-1 flex items-center gap-2 text-[11px]">
                              <button className={`rounded px-1 ${sort === "az" ? "bg-brand text-white" : "hover:bg-line"}`} onClick={() => setColSort((s) => ({ ...s, [i]: "az" }))}>A→Z</button>
                              <button className={`rounded px-1 ${sort === "za" ? "bg-brand text-white" : "hover:bg-line"}`} onClick={() => setColSort((s) => ({ ...s, [i]: "za" }))}>Z→A</button>
                              <button className="ml-auto text-ink-tertiary hover:underline" onClick={() => setOpenCol(null)}>Done</button>
                            </div>
                            <input
                              value={colSearch[i] ?? ""}
                              onChange={(e) => setColSearch((s) => ({ ...s, [i]: e.target.value }))}
                              placeholder="Search values…"
                              className="mb-1 w-full rounded border border-line px-2 py-1 text-[12px] text-gray-900"
                            />
                            <div className="mb-1 flex items-center justify-between text-[11px]">
                              <button className="text-brand hover:underline" onClick={() => setValues(i, [...new Set([...sel, ...shown.map((v) => v.value)])])}>
                                Select all{q ? " (shown)" : ""}
                              </button>
                              <button className="text-ink-tertiary hover:underline" onClick={() => setValues(i, [])}>Clear</button>
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                              {!valueCache[i] && <p className="text-[11px] text-ink-tertiary">Loading…</p>}
                              {valueCache[i] && shown.length === 0 && <p className="text-[11px] text-ink-tertiary">No matches.</p>}
                              {shown.map(({ value, count }) => (
                                <label key={value} className="flex items-center gap-2 py-0.5 text-[12px] text-ink">
                                  <input type="checkbox" checked={sel.includes(value)} onChange={() => toggleValue(i, value)} />
                                  <span className="truncate">{value || "(blank)"}</span>
                                  <span className="ml-auto text-[11px] text-ink-tertiary">{count}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sample.map((row, ri) => (
                <tr key={ri} className="even:bg-surface-secondary/40">
                  {headers.map((_, ci) => (
                    <td key={ci} className="max-w-[180px] truncate whitespace-nowrap border-b border-line-light px-2 py-1 text-ink" title={row[ci] ?? ""}>
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button onClick={addValuesFilter} className="rounded border border-line px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-secondary">
              + By values
            </button>
            <button onClick={addConditionFilter} className="rounded border border-line px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-secondary">
              + By condition
            </button>
          </div>
          {filters.map((f, i) => {
            const type = valueCache[f.index]?.type ?? "text";
            return (
              <div key={i} className="rounded-lg border border-line p-2">
                <div className="mb-2 flex items-center gap-2">
                  <select
                    value={f.index}
                    onChange={(e) => {
                      const index = Number(e.target.value);
                      update(i, { index });
                      if (f.mode === "values") ensureValues(index);
                    }}
                    className="rounded border border-line px-2 py-1 text-sm text-gray-900"
                  >
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {h || `(col ${idx + 1})`}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-ink-tertiary">{f.mode === "values" ? "by values" : "by condition"}</span>
                  <button onClick={() => removeAt(i)} className="ml-auto rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                    Remove
                  </button>
                </div>
                {f.mode === "values" ? (
                  <div className="max-h-40 overflow-y-auto rounded border border-line p-2">
                    {(valueCache[f.index]?.values ?? []).map(({ value, count }) => (
                      <label key={value} className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={f.values.includes(value)}
                          onChange={(e) =>
                            update(i, {
                              values: e.target.checked ? [...f.values, value] : f.values.filter((v) => v !== value),
                            } as Partial<ColumnFilter>)
                          }
                        />
                        <span className="truncate">{value || "(blank)"}</span>
                        <span className="ml-auto text-xs text-ink-tertiary">{count}</span>
                      </label>
                    ))}
                    {!valueCache[f.index] && <span className="text-xs text-ink-tertiary">Loading values…</span>}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={f.op} onChange={(e) => update(i, { op: e.target.value as ConditionOp })} className="rounded border border-line px-2 py-1 text-sm text-gray-900">
                      {opsFor(type).map((o) => (
                        <option key={o.v} value={o.v}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {f.op !== "empty" && f.op !== "not_empty" && (
                      <input value={f.value ?? ""} onChange={(e) => update(i, { value: e.target.value })} placeholder="value" className="rounded border border-line px-2 py-1 text-sm text-gray-900" />
                    )}
                    {(f.op === "between" || f.op === "date_between") && (
                      <input value={f.value2 ?? ""} onChange={(e) => update(i, { value2: e.target.value })} placeholder="and" className="rounded border border-line px-2 py-1 text-sm text-gray-900" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Active filter summary (shared) */}
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-tertiary">Active:</span>
          {filters.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-brand">
              {headers[f.index] || `col ${f.index + 1}`}
              {f.mode === "values" ? ` ∈ {${f.values.length}}` : ` ${f.op}`}
              <button onClick={() => removeAt(i)} className="ml-0.5 leading-none hover:text-red-600">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
