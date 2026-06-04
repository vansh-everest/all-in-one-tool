"use client";
import type { UnifiedGrid } from "@/lib/lender/types";

/**
 * Renders the unified tracker as a Google-Sheets-style matrix: lenders are columns
 * (owner band + name band header, like the source sheet), each column lists its pending
 * items down the rows. Email-found items are tinted and link to their source mail.
 */
export function LenderSheetGrid({ grid, ownerFilter }: { grid: UnifiedGrid; ownerFilter: string }) {
  const columns = grid.columns.filter((c) => !ownerFilter || c.owner === ownerFilter);
  if (!columns.length) return <p className="text-sm text-ink-tertiary">No lender pendencies yet — import the sheet or run an email scan.</p>;

  const maxRows = Math.max(1, ...columns.map((c) => c.items.length));
  const rowIdx = Array.from({ length: maxRows }, (_, i) => i);

  return (
    <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight: "75vh" }}>
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          {/* Owner band */}
          <tr>
            <th className="sticky left-0 z-20 w-12 border border-[#1e3a5f] bg-[#1f4e79] px-2 py-1 text-white">&nbsp;</th>
            {columns.map((c, i) => (
              <th key={`o${i}`} className="border border-[#1e3a5f] bg-[#2e5f8f] px-2 py-1 font-medium text-white" style={{ minWidth: 200 }}>
                {c.owner ?? "—"}
              </th>
            ))}
          </tr>
          {/* Lender name band */}
          <tr>
            <th className="sticky left-0 z-20 w-12 border border-[#1e3a5f] bg-[#1f4e79] px-2 py-1 text-white">Sr.</th>
            {columns.map((c, i) => (
              <th key={`n${i}`} className="border border-[#1e3a5f] bg-[#1f4e79] px-2 py-1 text-left font-semibold text-white" style={{ minWidth: 200 }}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIdx.map((r) => (
            <tr key={r} className="align-top">
              <td className="sticky left-0 z-10 border border-line-light bg-surface-secondary px-2 py-1 text-center text-ink-tertiary">{r + 1}</td>
              {columns.map((c, ci) => {
                const it = c.items[r];
                if (!it) return <td key={ci} className="border border-line-light bg-surface px-2 py-1" style={{ minWidth: 200 }} />;
                const email = it.source === "email";
                return (
                  <td
                    key={ci}
                    className={`border border-line-light px-2 py-1 ${email ? "bg-amber-50" : "bg-surface"}`}
                    style={{ minWidth: 200, maxWidth: 320 }}
                  >
                    <span className="whitespace-pre-wrap text-ink">{it.text}</span>
                    {it.status && <span className="ml-1 rounded bg-surface-secondary px-1 text-[10px] text-ink-secondary">{it.status}</span>}
                    {email && (
                      <span className="mt-0.5 block text-[10px] text-ink-tertiary">
                        {it.email_date && <span suppressHydrationWarning>📅 {new Date(it.email_date).toLocaleDateString()} </span>}
                        {it.source_message_id && (
                          <a
                            href={`/api/tools/lender-followup/message/${it.source_message_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand hover:underline"
                          >
                            ✉ view mail
                          </a>
                        )}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
