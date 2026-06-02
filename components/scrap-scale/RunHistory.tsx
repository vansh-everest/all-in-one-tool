"use client";
import { Fragment, useState } from "react";

type Run = {
  id: string;
  spreadsheet_id: string;
  sheet_title: string | null;
  status: string;
  total_rows: number;
  summary: { flagged?: number; duplicates?: number; sumExtracted?: number } | null;
  results_tab_name: string | null;
  created_at: string;
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export function RunHistory({ runs }: { runs: Run[] }) {
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const runA = runs.find((r) => r.id === a);
  const runB = runs.find((r) => r.id === b);

  if (!runs.length) return null;

  const pick = (id: string) => (a === id ? setA(null) : b === id ? setB(null) : !a ? setA(id) : setB(id));

  return (
    <div>
      <h2 className="mb-3 text-lg font-medium text-gray-900">Run history</h2>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Sheet/tab</th>
              <th className="px-3 py-2">Rows</th>
              <th className="px-3 py-2">Flagged</th>
              <th className="px-3 py-2">Duplicates</th>
              <th className="px-3 py-2">Σ Extracted</th>
              <th className="px-3 py-2">Results tab</th>
              <th className="px-3 py-2">Compare</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-gray-900">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-gray-600">{r.sheet_title ?? r.spreadsheet_id.slice(0, 8)}</td>
                <td className="px-3 py-2 text-gray-900">{r.total_rows}</td>
                <td className="px-3 py-2 text-gray-900">{r.summary?.flagged ?? "—"}</td>
                <td className="px-3 py-2 text-gray-900">{r.summary?.duplicates ?? "—"}</td>
                <td className="px-3 py-2 text-gray-900">
                  {r.summary?.sumExtracted != null ? `₹${r.summary.sumExtracted.toLocaleString("en-IN")}` : "—"}
                </td>
                <td className="px-3 py-2 text-gray-600">{r.results_tab_name ?? "—"}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => pick(r.id)}
                    className={`rounded border px-2 py-0.5 text-xs ${a === r.id ? "bg-indigo-600 text-white" : b === r.id ? "bg-indigo-400 text-white" : ""}`}
                  >
                    {a === r.id ? "A" : b === r.id ? "B" : "pick"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {runA && runB && (
        <div className="mt-4 rounded-xl border bg-white p-4 text-sm">
          <h3 className="mb-2 font-medium text-gray-900">Compare A vs B</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-gray-500">Metric</div>
            <div className="text-gray-500">A ({new Date(runA.created_at).toLocaleDateString()})</div>
            <div className="text-gray-500">B ({new Date(runB.created_at).toLocaleDateString()})</div>
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
                  <div className="text-gray-900">{label}</div>
                  <div className="text-gray-900">{av}</div>
                  <div className={av !== bv ? "font-semibold text-indigo-700" : "text-gray-900"}>
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
