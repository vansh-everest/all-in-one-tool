"use client";
import type { Finding } from "@/lib/lender/types";

/** Review cards: one per email thread found in the latest scan, with its date + extracted tasks. */
export function LenderFindings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium text-ink">Found in email ({findings.length})</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {findings.map((f, i) => (
          <div key={f.source_message_id ?? i} className="rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-cal-sm">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-ink" title={f.lender_name}>{f.lender_name}</span>
              <span className="shrink-0 text-[11px] text-ink-tertiary">{f.owner ?? "—"}</span>
            </div>
            <div className="mb-1 flex items-center gap-2 text-xs text-ink-secondary">
              <span className="truncate" title={f.subject}>{f.subject}</span>
            </div>
            <div className="mb-2 text-[11px] text-ink-tertiary" suppressHydrationWarning>
              {f.email_date ? `📅 ${new Date(f.email_date).toLocaleString()}` : "date unknown"}
            </div>
            {f.items.length ? (
              <ul className="space-y-1 text-xs text-ink">
                {f.items.map((it, j) => (
                  <li key={j} className="whitespace-pre-wrap border-t border-amber-200 pt-1">• {it}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-tertiary">Matched thread — no open task extracted.</p>
            )}
            {f.source_message_id && (
              <a
                href={`/api/tools/lender-followup/message/${f.source_message_id}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-[11px] text-brand hover:underline"
              >
                ✉ view email
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
