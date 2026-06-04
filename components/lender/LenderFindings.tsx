"use client";
import type { Finding } from "@/lib/lender/types";

/**
 * Master view of the latest scan: every matched email thread (with or without an extracted
 * task), so you can always see what matched — vendor, subject, date, tasks, and a mail link.
 */
export function LenderFindings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  const withTasks = findings.filter((f) => f.items.length).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-medium text-ink">Matched emails ({findings.length})</h2>
        <span className="text-xs text-ink-tertiary">{withTasks} with tasks · {findings.length - withTasks} matched with no task</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {findings.map((f, i) => {
          const has = f.items.length > 0;
          return (
            <div key={f.source_message_id ?? i} className={`rounded-2xl border p-3 shadow-cal-sm ${has ? "border-amber-200 bg-amber-50" : "border-line bg-surface"}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-ink" title={f.lender_name}>{f.lender_name}</span>
                <span className="shrink-0 text-[11px] text-ink-tertiary">{f.owner ?? "—"}</span>
              </div>
              <div className="mb-1 truncate text-xs text-ink-secondary" title={f.subject}>{f.subject}</div>
              <div className="mb-2 text-[11px] text-ink-tertiary" suppressHydrationWarning>
                {f.email_date ? `📅 ${new Date(f.email_date).toLocaleString()}` : "date unknown"}
              </div>
              {has ? (
                <ul className="space-y-1 text-xs text-ink">
                  {f.items.map((it, j) => (
                    <li key={j} className="whitespace-pre-wrap border-t border-amber-200 pt-1">• {it}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-tertiary">Matched this vendor, but no task was extracted from the email.</p>
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
          );
        })}
      </div>
    </div>
  );
}
