"use client";

type Run = {
  id: string;
  created_at: string;
  created_by_email: string | null;
  status: string;
  counts: { matched?: number; open_items?: number; lenders_with_items?: number; queued?: number } | null;
};

export function LenderRunHistory({ runs }: { runs: Run[] }) {
  if (!runs.length) return null;
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
              <th className="px-3 py-2">Lenders</th>
              <th className="px-3 py-2">Queued</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-line-light">
                <td className="px-3 py-2 text-ink">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.created_by_email ?? "—"}</td>
                <td className="px-3 py-2 text-ink">{r.counts?.matched ?? "—"}</td>
                <td className="px-3 py-2 text-ink">{r.counts?.open_items ?? "—"}</td>
                <td className="px-3 py-2 text-ink">{r.counts?.lenders_with_items ?? "—"}</td>
                <td className="px-3 py-2 text-ink">{r.counts?.queued ?? "—"}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
