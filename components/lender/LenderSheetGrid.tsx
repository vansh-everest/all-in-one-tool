"use client";
import { useState } from "react";
import type { GridColumn, GridItem, UnifiedGrid } from "@/lib/lender/types";

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

/** A single editable cell — text saves on blur, done toggles, and it can be deleted. */
function Cell({ item, onChange, onDelete }: { item: GridItem; onChange: (patch: Partial<GridItem>) => void; onDelete: () => void }) {
  const [text, setText] = useState(item.text);
  const email = item.source === "email";
  const manual = item.source === "manual";
  const bg = item.done ? "bg-green-50" : email ? "bg-amber-50" : manual ? "bg-sky-50" : "bg-surface";
  return (
    <td className={`border border-line-light px-1 py-1 align-top ${bg}`} style={{ minWidth: 210, maxWidth: 340 }}>
      <div className="flex items-start gap-1">
        <input
          type="checkbox"
          checked={item.done}
          title="Mark done"
          onChange={(e) => { onChange({ done: e.target.checked }); if (item.id) api(`/api/tools/lender-followup/item/${item.id}`, "PATCH", { done: e.target.checked }); }}
          className="mt-1"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const t = text.trim();
            if (item.id && t !== item.text) { onChange({ text: t }); api(`/api/tools/lender-followup/item/${item.id}`, "PATCH", { text: t }); }
          }}
          rows={Math.max(1, Math.ceil((text.length || 1) / 32))}
          className={`w-full resize-y rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink hover:border-line focus:border-brand focus:bg-white focus:outline-none ${item.done ? "text-ink-tertiary line-through" : ""}`}
        />
        <button onClick={() => { if (item.id) { api(`/api/tools/lender-followup/item/${item.id}`, "DELETE"); onDelete(); } }} className="shrink-0 text-[11px] text-red-400 hover:text-red-600" title="Delete">✕</button>
      </div>
      {email && (
        <div className="pl-5 text-[10px] text-ink-tertiary">
          {item.email_date && <span suppressHydrationWarning>📅 {new Date(item.email_date).toLocaleDateString()} </span>}
          {item.source_message_id && (
            <a href={`/api/tools/lender-followup/message/${item.source_message_id}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">✉ mail</a>
          )}
        </div>
      )}
    </td>
  );
}

/**
 * Google-Sheets-style editable matrix: lenders are columns (owner band + name band header).
 * Every cell is editable like a spreadsheet — type to edit (saves on blur), check to mark
 * done, ✕ to delete, and "+" at the bottom of a column to add a row. Email-found cells are
 * amber (with date + mail link), manual cells sky, done cells green.
 */
export function LenderSheetGrid({ grid, ownerFilter }: { grid: UnifiedGrid; ownerFilter: string }) {
  const [cols, setCols] = useState<GridColumn[]>(grid.columns);

  const update = (lenderKey: string | null, fn: (items: GridItem[]) => GridItem[]) =>
    setCols((cur) => cur.map((c) => (c.lender_id === lenderKey ? { ...c, items: fn(c.items) } : c)));

  async function addRow(col: GridColumn) {
    if (!col.lender_id) return;
    const res = await api("/api/tools/lender-followup/item", "POST", { lenderId: col.lender_id, text: "" });
    if (!res.ok) return;
    const { id } = await res.json();
    update(col.lender_id, (items) => [...items, { id, text: "", done: false, source: "manual", source_message_id: null, email_date: null }]);
  }

  const view = cols.filter((c) => !ownerFilter || c.owner === ownerFilter);
  if (!view.length) return <p className="text-sm text-ink-tertiary">No lender pendencies yet — import the sheet or run an email scan.</p>;

  const maxRows = Math.max(1, ...view.map((c) => c.items.length));
  const rowIdx = Array.from({ length: maxRows }, (_, i) => i);

  return (
    <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight: "80vh" }}>
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 w-10 border border-[#1e3a5f] bg-[#1f4e79] px-2 py-1 text-white">&nbsp;</th>
            {view.map((c, i) => (
              <th key={`o${i}`} className="border border-[#1e3a5f] bg-[#2e5f8f] px-2 py-1 font-medium text-white" style={{ minWidth: 210 }}>{c.owner ?? "—"}</th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 z-20 w-10 border border-[#1e3a5f] bg-[#1f4e79] px-2 py-1 text-white">Sr.</th>
            {view.map((c, i) => (
              <th key={`n${i}`} className="border border-[#1e3a5f] bg-[#1f4e79] px-2 py-1 text-left font-semibold text-white" style={{ minWidth: 210 }}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIdx.map((r) => (
            <tr key={r} className="align-top">
              <td className="sticky left-0 z-10 border border-line-light bg-surface-secondary px-2 py-1 text-center text-ink-tertiary">{r + 1}</td>
              {view.map((c, ci) => {
                const it = c.items[r];
                if (!it) return <td key={ci} className="border border-line-light bg-surface px-2 py-1" style={{ minWidth: 210 }} />;
                return (
                  <Cell
                    key={it.id ?? ci}
                    item={it}
                    onChange={(patch) => update(c.lender_id, (items) => items.map((x) => (x.id === it.id ? { ...x, ...patch } : x)))}
                    onDelete={() => update(c.lender_id, (items) => items.filter((x) => x.id !== it.id))}
                  />
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="sticky left-0 z-10 border border-line-light bg-surface-secondary px-2 py-1" />
            {view.map((c, ci) => (
              <td key={ci} className="border border-line-light bg-surface px-2 py-1">
                <button onClick={() => addRow(c)} className="text-[11px] text-brand hover:underline">+ add</button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
