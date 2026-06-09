"use client";
import { useState } from "react";
import { ZOHO_HEADERS } from "@/lib/invoice/schema";
import type { InvoiceRow } from "./types";

const cell = (v: string | number | null | undefined) => (v == null || v === "" ? "" : String(v));

export function InvoiceGrid({ rows }: { rows: InvoiceRow[] }) {
  const [sel, setSel] = useState<InvoiceRow | null>(null);

  if (!rows.length) {
    return <p className="text-sm text-ink-tertiary">No bills yet — set a Gmail label in Config, then Run.</p>;
  }

  const attachmentUrl =
    sel?.source_message_id && sel?.attachment_id
      ? `/api/tools/invoice-zoho/attachment/${encodeURIComponent(sel.source_message_id)}/${encodeURIComponent(sel.attachment_id)}`
      : null;
  const isPdf = (sel?.mime_type ?? "").includes("pdf");

  return (
    <>
      <p className="text-xs text-ink-tertiary">
        Each row is one invoice mapped to the 36 Zoho columns. <span className="rounded-sm bg-amber-50 px-1 ring-1 ring-line">Amber</span> rows have flags — click any row to audit the source invoice, the OCR-read values, and the mapped output.
      </p>
      <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight: "80vh" }}>
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 border border-[#1e3a5f] bg-[#1f4e79] px-2 py-1 text-white">#</th>
              {ZOHO_HEADERS.map((h) => (
                <th key={h} className="border border-[#1e3a5f] bg-[#1f4e79] px-2 py-1 text-left font-semibold text-white" style={{ minWidth: 140 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const flagged = (row.flags?.length ?? 0) > 0;
              const m = row.mapped ?? {};
              return (
                <tr
                  key={row.id}
                  onClick={() => setSel(row)}
                  className={`cursor-pointer align-top hover:ring-1 hover:ring-brand/40 ${flagged ? "bg-amber-50" : "bg-surface"}`}
                >
                  <td className="sticky left-0 z-10 border border-line-light bg-surface-secondary px-2 py-1 text-center text-ink-tertiary">{i + 1}</td>
                  {ZOHO_HEADERS.map((h) => (
                    <td key={h} className="border border-line-light px-2 py-1 text-ink" style={{ minWidth: 140, maxWidth: 280 }}>
                      <span className="block truncate" title={cell(m[h])}>{cell(m[h])}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Notion-style audit drawer */}
      {sel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSel(null)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-5 shadow-cal-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-ink-tertiary">{sel.file_name ?? "Invoice"}</div>
                <h3 className="text-sm font-semibold text-ink">Audit invoice</h3>
              </div>
              <button onClick={() => setSel(null)} className="rounded p-1 text-ink-tertiary hover:bg-surface-secondary">✕</button>
            </div>

            {(sel.flags?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sel.flags!.map((f) => (
                  <span key={f} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{f}</span>
                ))}
              </div>
            )}

            {/* Source invoice */}
            {attachmentUrl && (
              <div className="rounded-lg border border-line">
                {isPdf ? (
                  <iframe src={attachmentUrl} className="h-[40vh] w-full rounded-lg" title="Source invoice" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={attachmentUrl} alt="Source invoice" className="max-h-[40vh] w-full rounded-lg object-contain" />
                )}
              </div>
            )}

            {/* OCR vs mapped */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-xs font-semibold text-ink-secondary">OCR read</h4>
                <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-surface-secondary/40 p-2 text-[11px] text-ink">
                  {JSON.stringify(sel.ocr ?? {}, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold text-ink-secondary">Mapped (Zoho columns)</h4>
                <div className="max-h-64 overflow-auto rounded-lg border border-line">
                  <table className="min-w-full text-[11px]">
                    <tbody>
                      {ZOHO_HEADERS.map((h) => (
                        <tr key={h} className="border-t border-line-light">
                          <td className="px-2 py-1 text-ink-tertiary">{h}</td>
                          <td className="px-2 py-1 text-ink">{cell((sel.mapped ?? {})[h])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
