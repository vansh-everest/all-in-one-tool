"use client";
import { Fragment, useState } from "react";
import type { Finding } from "@/lib/lender/types";

type Run = {
  id: string;
  created_at: string;
  created_by_email: string | null;
  status: string;
  counts: { matched?: number; open_items?: number; lenders_with_items?: number } | null;
};

export function LenderRunHistory({ runs, canManage = false }: { runs: Run[]; canManage?: boolean }) {
  const [list, setList] = useState<Run[]>(runs);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, Finding[]>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  if (!list.length) return null;

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!cache[id]) {
      const res = await fetch(`/api/tools/lender-followup/run/${id}`);
      const data = await res.json().catch(() => ({ findings: [] }));
      setCache((c) => ({ ...c, [id]: (data.findings ?? []) as Finding[] }));
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this run permanently?")) return;
    setDeleting(id);
    const res = await fetch(`/api/tools/lender-followup/run/${id}`, { method: "DELETE" });
    setDeleting(null);
    if (res.ok) {
      setList((l) => l.filter((r) => r.id !== id));
      if (openId === id) setOpenId(null);
    } else {
      alert((await res.json().catch(() => ({}))).error ?? "Delete failed");
    }
  }

  const colSpan = canManage ? 7 : 6;

  return (
    <div>
      <h2 className="mb-3 text-lg font-medium text-ink">Run history</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-cal">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-ink-tertiary">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Run by</th>
              <th className="px-3 py-2">Matched</th>
              <th className="px-3 py-2">Open items</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Details</th>
              {canManage && <th className="px-3 py-2">Delete</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-line-light">
                  <td className="px-3 py-2 text-ink" suppressHydrationWarning>{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.created_by_email ?? "—"}</td>
                  <td className="px-3 py-2 text-ink">{r.counts?.matched ?? "—"}</td>
                  <td className="px-3 py-2 text-ink">{r.counts?.open_items ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.status}</td>
                  <td className="px-3 py-2">
                    {r.status !== "imported" && (
                      <button onClick={() => toggle(r.id)} className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-secondary">
                        {openId === r.id ? "Hide" : "View"}
                      </button>
                    )}
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
                        <p className="text-xs text-ink-tertiary">Loading matched threads…</p>
                      ) : cache[r.id].length === 0 ? (
                        <p className="text-xs text-ink-tertiary">No matched-thread details recorded for this run.</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {cache[r.id].map((f, i) => (
                            <div key={f.source_message_id ?? i} className="rounded-lg border border-line bg-surface p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-semibold text-ink" title={f.lender_name}>{f.lender_name}</span>
                                <span className="shrink-0 text-[10px] text-ink-tertiary" suppressHydrationWarning>{f.email_date ? new Date(f.email_date).toLocaleDateString() : ""}</span>
                              </div>
                              <div className="mb-1 truncate text-[11px] text-ink-secondary" title={f.subject}>{f.subject}</div>
                              {f.items.length ? (
                                <ul className="text-[11px] text-ink">{f.items.map((it, j) => <li key={j}>• {it}</li>)}</ul>
                              ) : (
                                <p className="text-[11px] text-ink-tertiary">matched — no task extracted</p>
                              )}
                              {f.source_message_id && (
                                <a href={`/api/tools/lender-followup/message/${f.source_message_id}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] text-brand hover:underline">✉ view email</a>
                              )}
                            </div>
                          ))}
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
    </div>
  );
}
