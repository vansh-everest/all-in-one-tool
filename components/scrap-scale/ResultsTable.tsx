"use client";
import { Fragment, useState } from "react";

export type ResultRow = {
  id: string;
  row_index: number;
  submitted_by: string | null;
  links: string[];
  expected_amount: number | null;
  extracted_amount: number | null;
  difference: number | null;
  flagged: boolean | null;
  duplicate: boolean;
  status: string;
  ocr_details: { file_id: string; amount: number | null; txn_id: string | null }[] | null;
};

export function ResultsTable({ rows }: { rows: ResultRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const badge = (r: ResultRow) => {
    if (r.status === "note-row") return <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">note</span>;
    if (r.status === "needs-review") return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">needs review</span>;
    if (r.flagged) return <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">flagged</span>;
    return <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">ok</span>;
  };
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="px-2 py-2">#</th>
          <th className="px-2 py-2">Submitted by</th>
          <th className="px-2 py-2">Expected</th>
          <th className="px-2 py-2">Extracted</th>
          <th className="px-2 py-2">Difference</th>
          <th className="px-2 py-2">Dup?</th>
          <th className="px-2 py-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.id}>
            <tr className="border-t hover:bg-gray-50">
              <td className="px-2 py-2 text-gray-900">{r.row_index}</td>
              <td className="px-2 py-2 text-gray-900">{r.submitted_by ?? "—"}</td>
              <td className="px-2 py-2 text-gray-900">{r.expected_amount ?? "—"}</td>
              <td className="px-2 py-2">
                <button
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  className="font-medium text-indigo-700 hover:underline disabled:text-gray-400"
                  disabled={!r.links.length}
                >
                  {r.extracted_amount ?? "—"}
                </button>
              </td>
              <td className={`px-2 py-2 ${Number(r.difference) !== 0 ? "text-red-600" : "text-gray-900"}`}>
                {r.difference ?? "—"}
              </td>
              <td className="px-2 py-2">{r.duplicate ? "⚠️" : ""}</td>
              <td className="px-2 py-2">{badge(r)}</td>
            </tr>
            {open === r.id && (
              <tr className="bg-gray-50">
                <td colSpan={7} className="px-4 py-3">
                  <div className="flex flex-wrap gap-4">
                    {(r.ocr_details ?? []).map((d) => (
                      <div key={d.file_id} className="w-48">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/tools/scrap-scale/image?file=${d.file_id}`} alt="screenshot" className="rounded border" />
                        <div className="mt-1 text-xs text-gray-600">
                          amount: <b>{d.amount ?? "unreadable"}</b>
                          {d.txn_id ? ` · txn ${d.txn_id}` : ""}
                        </div>
                      </div>
                    ))}
                    {(r.ocr_details ?? []).length === 0 && <span className="text-xs text-gray-500">No screenshots for this row.</span>}
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
