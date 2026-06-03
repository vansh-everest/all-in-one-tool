"use client";
import { Fragment, useState } from "react";

type Activity = { at: string; message: string };
type Run = {
  id: string;
  spreadsheet_id: string;
  sheet_title: string | null;
  status: string;
  total_rows: number;
  summary: { flagged?: number; duplicates?: number; sumExtracted?: number } | null;
  results_tab_name: string | null;
  created_at: string;
  created_by_email: string | null;
  activities: Activity[] | null;
};

type RunRow = {
  id: string;
  row_index: number;
  submitted_by: string | null;
  scrap_sold_date: string | null;
  expected_amount: number | null;
  extracted_amount: number | null;
  difference: number | null;
  status: string;
  duplicate: boolean;
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export function RunHistory({ runs, canDelete = false }: { runs: Run[]; canDelete?: boolean }) {
  const [list, setList] = useState<Run[]>(runs);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowsCache, setRowsCache] = useState<Record<string, RunRow[]>>({});
  const runA = list.find((r) => r.id === a);
  const runB = list.find((r) => r.id === b);

  if (!list.length) return null;

  const pick = (id: string) => (a === id ? setA(null) : b === id ? setB(null) : !a ? setA(id) : setB(id));

  async function deleteRun(id: string) {
    if (!confirm("Delete this run permanently? This also removes its row results and cannot be undone.")) return;
    setDeletingId(id);
    const res = await fetch(`/api/tools/scrap-scale/run/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert((body as { error?: string }).error ?? "Delete failed");
      return;
    }
    setList((cur) => cur.filter((r) => r.id !== id));
    if (a === id) setA(null);
    if (b === id) setB(null);
    if (openId === id) setOpenId(null);
  }

  async function toggleDetail(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!rowsCache[id]) {
      const res = await fetch(`/api/tools/scrap-scale/run/${id}`);
      const data = await res.json();
      setRowsCache((c) => ({ ...c, [id]: (data.rows ?? []) as RunRow[] }));
    }
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-medium text-ink">Run history</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-cal">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-ink-tertiary">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Run by</th>
              <th className="px-3 py-2">Sheet/tab</th>
              <th className="px-3 py-2">Rows</th>
              <th className="px-3 py-2">Flagged</th>
              <th className="px-3 py-2">Duplicates</th>
              <th className="px-3 py-2">Σ Extracted</th>
              <th className="px-3 py-2">Results tab</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2">Compare</th>
              {canDelete && <th className="px-3 py-2">Delete</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-line-light">
                  <td className="px-3 py-2 text-ink">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.created_by_email ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.sheet_title ?? r.spreadsheet_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-ink">{r.total_rows}</td>
                  <td className="px-3 py-2 text-ink">{r.summary?.flagged ?? "—"}</td>
                  <td className="px-3 py-2 text-ink">{r.summary?.duplicates ?? "—"}</td>
                  <td className="px-3 py-2 text-ink">
                    {r.summary?.sumExtracted != null ? `₹${r.summary.sumExtracted.toLocaleString("en-IN")}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">{r.results_tab_name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleDetail(r.id)} className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-secondary">
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
                  {canDelete && (
                    <td className="px-3 py-2">
                      <button
                        onClick={() => deleteRun(r.id)}
                        disabled={deletingId === r.id}
                        className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {deletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  )}
                </tr>
                {openId === r.id && (
                  <tr className="bg-surface-secondary/50">
                    <td colSpan={canDelete ? 11 : 10} className="px-4 py-3">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <h4 className="mb-1 text-xs font-semibold text-ink-secondary">Activity log</h4>
                          <ul className="space-y-1 text-xs text-ink">
                            {(r.activities ?? []).map((act, i) => (
                              <li key={i}>
                                <span className="text-ink-tertiary">{new Date(act.at).toLocaleTimeString()}</span> · {act.message}
                              </li>
                            ))}
                            {(r.activities ?? []).length === 0 && <li className="text-ink-tertiary">No activity recorded.</li>}
                          </ul>
                        </div>
                        <div>
                          <h4 className="mb-1 text-xs font-semibold text-ink-secondary">Rows</h4>
                          <div className="max-h-64 overflow-auto rounded-lg border border-line">
                            <table className="min-w-full text-xs">
                              <thead className="bg-surface-secondary text-ink-tertiary">
                                <tr>
                                  <th className="px-2 py-1 text-left">#</th>
                                  <th className="px-2 py-1 text-left">Submitted by</th>
                                  <th className="px-2 py-1 text-left">Sold date</th>
                                  <th className="px-2 py-1 text-left">Expected</th>
                                  <th className="px-2 py-1 text-left">Extracted</th>
                                  <th className="px-2 py-1 text-left">Diff</th>
                                  <th className="px-2 py-1 text-left">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(rowsCache[r.id] ?? []).map((row) => (
                                  <tr key={row.id} className="border-t border-line-light">
                                    <td className="px-2 py-1">{row.row_index}</td>
                                    <td className="px-2 py-1">{row.submitted_by ?? "—"}</td>
                                    <td className="px-2 py-1">{row.scrap_sold_date ?? "—"}</td>
                                    <td className="px-2 py-1">{row.expected_amount ?? "—"}</td>
                                    <td className="px-2 py-1">{row.extracted_amount ?? "—"}</td>
                                    <td className={`px-2 py-1 ${num(row.difference) !== 0 ? "text-red-600" : ""}`}>{row.difference ?? "—"}</td>
                                    <td className="px-2 py-1">
                                      {row.duplicate ? "dup · " : ""}
                                      {row.status}
                                    </td>
                                  </tr>
                                ))}
                                {!rowsCache[r.id] && (
                                  <tr>
                                    <td colSpan={7} className="px-2 py-2 text-ink-tertiary">
                                      Loading rows…
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {runA && runB && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-sm shadow-cal">
          <h3 className="mb-2 font-medium text-ink">Compare A vs B</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-ink-tertiary">Metric</div>
            <div className="text-ink-tertiary">A ({new Date(runA.created_at).toLocaleDateString()})</div>
            <div className="text-ink-tertiary">B ({new Date(runB.created_at).toLocaleDateString()})</div>
            {(
              [
                ["Rows", "total_rows"],
                ["Flagged", "flagged"],
                ["Duplicates", "duplicates"],
                ["Σ Extracted", "sumExtracted"],
              ] as const
            ).map(([label, kkey]) => {
              const av = kkey === "total_rows" ? runA.total_rows : num((runA.summary as Record<string, unknown> | null)?.[kkey]);
              const bv = kkey === "total_rows" ? runB.total_rows : num((runB.summary as Record<string, unknown> | null)?.[kkey]);
              return (
                <Fragment key={label}>
                  <div className="text-ink">{label}</div>
                  <div className="text-ink">{av}</div>
                  <div className={av !== bv ? "font-semibold text-brand" : "text-ink"}>
                    {bv} {av !== bv ? `(Δ ${bv - av})` : ""}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
