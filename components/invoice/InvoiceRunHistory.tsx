"use client";
import { Fragment, useState } from "react";
import type { InvoiceRow, InvoiceRunSummary } from "./types";

const billNumber = (r: InvoiceRow) => String((r.mapped ?? {})["Bill Number"] ?? "").trim();

// Build a quick A-vs-B diff keyed by Bill Number: new, removed, changed.
function diffByBill(aRows: InvoiceRow[], bRows: InvoiceRow[]) {
  const aMap = new Map<string, InvoiceRow>();
  const bMap = new Map<string, InvoiceRow>();
  for (const r of aRows) { const k = billNumber(r); if (k) aMap.set(k, r); }
  for (const r of bRows) { const k = billNumber(r); if (k) bMap.set(k, r); }
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [k] of bMap) if (!aMap.has(k)) added.push(k);
  for (const [k] of aMap) if (!bMap.has(k)) removed.push(k);
  for (const [k, br] of bMap) {
    const ar = aMap.get(k);
    if (ar && JSON.stringify(ar.mapped ?? {}) !== JSON.stringify(br.mapped ?? {})) changed.push(k);
  }
  return { added, removed, changed };
}

export function InvoiceRunHistory({ runs, canManage = false }: { runs: InvoiceRunSummary[]; canManage?: boolean }) {
  const [list, setList] = useState<InvoiceRunSummary[]>(runs);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, InvoiceRow[]>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);

  if (!list.length) return null;

  async function fetchRows(id: string): Promise<InvoiceRow[]> {
    if (cache[id]) return cache[id];
    const res = await fetch(`/api/tools/invoice-zoho/run/${id}`);
    const data = await res.json().catch(() => ({ rows: [] }));
    const rows = (data.rows ?? []) as InvoiceRow[];
    setCache((c) => ({ ...c, [id]: rows }));
    return rows;
  }

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    await fetchRows(id);
  }

  async function pick(id: string) {
    if (a === id) { setA(null); return; }
    if (b === id) { setB(null); return; }
    if (!a) setA(id);
    else setB(id);
    await fetchRows(id);
  }

  async function del(id: string) {
    if (!confirm("Delete this run permanently? This also removes its rows and cannot be undone.")) return;
    setDeleting(id);
    const res = await fetch(`/api/tools/invoice-zoho/run/${id}`, { method: "DELETE" });
    setDeleting(null);
    if (res.ok) {
      setList((l) => l.filter((r) => r.id !== id));
      if (openId === id) setOpenId(null);
      if (a === id) setA(null);
      if (b === id) setB(null);
    } else {
      alert((await res.json().catch(() => ({}))).error ?? "Delete failed");
    }
  }

  const colSpan = canManage ? 8 : 7;
  const diff = a && b && cache[a] && cache[b] ? diffByBill(cache[a], cache[b]) : null;

  return (
    <div>
      <h2 className="mb-3 text-lg font-medium text-ink">Run history</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-cal">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-ink-tertiary">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Run by</th>
              <th className="px-3 py-2">Invoices</th>
              <th className="px-3 py-2">Rows</th>
              <th className="px-3 py-2">Flagged</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2">Compare</th>
              {canManage && <th className="px-3 py-2">Delete</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-line-light">
                  <td className="px-3 py-2 text-ink" suppressHydrationWarning>{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.created_by_email ?? "—"}</td>
                  <td className="px-3 py-2 text-ink">{r.counts?.invoices ?? "—"}</td>
                  <td className="px-3 py-2 text-ink">{r.counts?.rows ?? "—"}</td>
                  <td className="px-3 py-2 text-ink">{r.counts?.flagged ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.status}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => toggle(r.id)} className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-secondary">
                      {openId === r.id ? "Hide" : "View"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => pick(r.id)}
                      className={`rounded border border-line px-2 py-0.5 text-xs ${a === r.id ? "bg-brand text-white" : b === r.id ? "bg-brand/60 text-white" : ""}`}
                    >
                      {a === r.id ? "A" : b === r.id ? "B" : "pick"}
                    </button>
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <button onClick={() => del(r.id)} disabled={deleting === r.id} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
                        {deleting === r.id ? "…" : "Delete"}
                      </button>
                    </td>
                  )}
                </tr>
                {openId === r.id && (
                  <tr className="bg-surface-secondary/40">
                    <td colSpan={colSpan} className="px-4 py-3">
                      {!cache[r.id] ? (
                        <p className="text-xs text-ink-tertiary">Loading rows…</p>
                      ) : cache[r.id].length === 0 ? (
                        <p className="text-xs text-ink-tertiary">No rows recorded for this run.</p>
                      ) : (
                        <div className="max-h-64 overflow-auto rounded-lg border border-line">
                          <table className="min-w-full text-xs">
                            <thead className="bg-surface-secondary text-ink-tertiary">
                              <tr>
                                <th className="px-2 py-1 text-left">Bill #</th>
                                <th className="px-2 py-1 text-left">Vendor</th>
                                <th className="px-2 py-1 text-left">Item total</th>
                                <th className="px-2 py-1 text-left">Grand total</th>
                                <th className="px-2 py-1 text-left">Flags</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cache[r.id].map((row) => {
                                const m = row.mapped ?? {};
                                return (
                                  <tr key={row.id} className={`border-t border-line-light ${(row.flags?.length ?? 0) > 0 ? "bg-amber-50" : ""}`}>
                                    <td className="px-2 py-1">{String(m["Bill Number"] ?? "—")}</td>
                                    <td className="px-2 py-1">{String(m["Vendor Name"] ?? "—")}</td>
                                    <td className="px-2 py-1">{String(m["Item Total"] ?? "—")}</td>
                                    <td className="px-2 py-1">{row.grand_total ?? "—"}</td>
                                    <td className="px-2 py-1 text-amber-800">{(row.flags ?? []).join(", ") || "—"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {a && b && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-sm shadow-cal">
          <h3 className="mb-2 font-medium text-ink">Compare A vs B (by Bill Number)</h3>
          {!diff ? (
            <p className="text-xs text-ink-tertiary">Loading both runs…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="mb-1 text-xs font-semibold text-green-700">New in B ({diff.added.length})</div>
                <ul className="space-y-0.5 text-xs text-ink">{diff.added.map((k) => <li key={k}>• {k}</li>)}{diff.added.length === 0 && <li className="text-ink-tertiary">none</li>}</ul>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-red-600">Removed in B ({diff.removed.length})</div>
                <ul className="space-y-0.5 text-xs text-ink">{diff.removed.map((k) => <li key={k}>• {k}</li>)}{diff.removed.length === 0 && <li className="text-ink-tertiary">none</li>}</ul>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-brand">Changed ({diff.changed.length})</div>
                <ul className="space-y-0.5 text-xs text-ink">{diff.changed.map((k) => <li key={k}>• {k}</li>)}{diff.changed.length === 0 && <li className="text-ink-tertiary">none</li>}</ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
