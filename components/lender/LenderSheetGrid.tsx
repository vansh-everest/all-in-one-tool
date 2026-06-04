"use client";
import { useState } from "react";
import type { GridColumn, GridItem, UnifiedGrid } from "@/lib/lender/types";

async function api(path: string, method: string, body?: unknown) {
  return fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

type Selected = { lenderId: string | null; lenderName: string; item: GridItem };

/**
 * Google-Sheets-style matrix: lenders are columns (owner band + name band header).
 * Click any cell to open a Notion-style side panel to edit the text, mark it done, or
 * delete it. "+ add" at the bottom of a column adds a task. Email cells are amber (with
 * date + mail link), manual cells sky, done cells green.
 */
export function LenderSheetGrid({ grid, ownerFilter }: { grid: UnifiedGrid; ownerFilter: string }) {
  const [cols, setCols] = useState<GridColumn[]>(grid.columns);
  const [sel, setSel] = useState<Selected | null>(null);
  const [draft, setDraft] = useState("");

  const updateItems = (lenderId: string | null, fn: (items: GridItem[]) => GridItem[]) =>
    setCols((cur) => cur.map((c) => (c.lender_id === lenderId ? { ...c, items: fn(c.items) } : c)));

  function openCell(col: GridColumn, item: GridItem) {
    setSel({ lenderId: col.lender_id, lenderName: col.name, item });
    setDraft(item.text);
  }

  async function saveText() {
    if (!sel?.item.id) return;
    const t = draft.trim();
    updateItems(sel.lenderId, (items) => items.map((x) => (x.id === sel.item.id ? { ...x, text: t } : x)));
    setSel((s) => (s ? { ...s, item: { ...s.item, text: t } } : s));
    await api(`/api/tools/lender-followup/item/${sel.item.id}`, "PATCH", { text: t });
  }

  async function toggleDone() {
    if (!sel?.item.id) return;
    const done = !sel.item.done;
    updateItems(sel.lenderId, (items) => items.map((x) => (x.id === sel.item.id ? { ...x, done } : x)));
    setSel((s) => (s ? { ...s, item: { ...s.item, done } } : s));
    await api(`/api/tools/lender-followup/item/${sel.item.id}`, "PATCH", { done });
  }

  async function del() {
    if (!sel?.item.id) return;
    updateItems(sel.lenderId, (items) => items.filter((x) => x.id !== sel.item.id));
    await api(`/api/tools/lender-followup/item/${sel.item.id}`, "DELETE");
    setSel(null);
  }

  async function addRow(col: GridColumn) {
    if (!col.lender_id) return;
    const res = await api("/api/tools/lender-followup/item", "POST", { lenderId: col.lender_id, text: "" });
    if (!res.ok) return;
    const { id } = await res.json();
    const item: GridItem = { id, text: "", done: false, source: "manual", source_message_id: null, email_date: null };
    updateItems(col.lender_id, (items) => [...items, item]);
    openCell(col, item);
  }

  const view = cols.filter((c) => !ownerFilter || c.owner === ownerFilter);
  if (!view.length) return <p className="text-sm text-ink-tertiary">No lender pendencies yet — import the sheet or run an email scan.</p>;

  const maxRows = Math.max(1, ...view.map((c) => c.items.length));
  const rowIdx = Array.from({ length: maxRows }, (_, i) => i);

  return (
    <>
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
                  const bg = it.done ? "bg-green-50" : it.source === "email" ? "bg-amber-50" : it.source === "manual" ? "bg-sky-50" : "bg-surface";
                  return (
                    <td
                      key={it.id ?? ci}
                      onClick={() => openCell(c, it)}
                      className={`cursor-pointer border border-line-light px-2 py-1 hover:ring-1 hover:ring-brand/40 ${bg}`}
                      style={{ minWidth: 210, maxWidth: 340 }}
                    >
                      <span className={`whitespace-pre-wrap ${it.done ? "text-ink-tertiary line-through" : "text-ink"}`}>{it.text || <span className="text-ink-tertiary">(empty)</span>}</span>
                      {it.source === "email" && it.email_date && (
                        <span className="mt-0.5 block text-[10px] text-ink-tertiary" suppressHydrationWarning>📅 {new Date(it.email_date).toLocaleDateString()}</span>
                      )}
                    </td>
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

      {/* Notion-style editor drawer */}
      {sel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSel(null)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col gap-4 border-l border-line bg-surface p-5 shadow-cal-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-ink-tertiary">{sel.lenderName}</div>
                <h3 className="text-sm font-semibold text-ink">Edit task</h3>
              </div>
              <button onClick={() => setSel(null)} className="rounded p-1 text-ink-tertiary hover:bg-surface-secondary">✕</button>
            </div>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              rows={6}
              className="w-full resize-y rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              placeholder="Task / pending item…"
            />

            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={sel.item.done} onChange={toggleDone} />
              Mark as done
            </label>

            {sel.item.source === "email" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-ink-secondary">
                Found in email{sel.item.email_date && <> · <span suppressHydrationWarning>{new Date(sel.item.email_date).toLocaleString()}</span></>}
                {sel.item.source_message_id && (
                  <a href={`/api/tools/lender-followup/message/${sel.item.source_message_id}`} target="_blank" rel="noreferrer" className="ml-1 text-brand hover:underline">✉ view email</a>
                )}
              </div>
            )}

            <div className="mt-auto flex items-center justify-between">
              <button onClick={del} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">Delete</button>
              <button onClick={() => { saveText(); setSel(null); }} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white">Save</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
