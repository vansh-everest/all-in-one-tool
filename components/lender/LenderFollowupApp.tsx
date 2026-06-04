"use client";
import { useState } from "react";
import { SignOutButton } from "@clerk/nextjs";
import type { Lender, TrackerLender, RunCounts } from "@/lib/lender/types";

type QueueMeta = { message_id: string; from_email: string; subject: string; snippet: string };
type RunData = {
  run: { id: string; status: string; counts: RunCounts };
  tracker: TrackerLender[];
  queue: { ids: string[]; meta: QueueMeta[] };
};

const PRIVACY =
  "Only emails matched to a lender have their full content fetched and sent to Gemini. All other unread mail is read as metadata only (sender, subject, date) and is never sent anywhere. Email is never marked read.";

export function LenderFollowupApp({
  connected,
  connectedEmail,
  lenders,
}: {
  connected: boolean;
  connectedEmail: string | null;
  lenders: Lender[];
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [data, setData] = useState<RunData | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; matched: number; queued: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const owners = [...new Set(lenders.map((l) => l.owner).filter(Boolean))] as string[];

  async function refresh(id: string) {
    const res = await fetch(`/api/tools/lender-followup/run/${id}`);
    if (res.ok) setData(await res.json());
  }

  async function run() {
    setError(null);
    setBusy(true);
    setData(null);
    const res = await fetch("/api/tools/lender-followup/run", { method: "POST" });
    if (res.status === 409) {
      setBusy(false);
      setError("Gmail access missing — sign out and sign in again to grant gmail.readonly.");
      return;
    }
    if (!res.ok) {
      setBusy(false);
      setError((await res.json().catch(() => ({}))).error ?? "Run failed");
      return;
    }
    const { runId: id, total } = await res.json();
    setRunId(id);
    setProgress({ processed: 0, total, matched: 0, queued: 0 });
    let done = false;
    while (!done) {
      const cr = await fetch(`/api/tools/lender-followup/run/${id}/process-chunk`, { method: "POST" });
      if (!cr.ok) { setError("Processing error"); break; }
      const p = await cr.json();
      setProgress({ processed: p.processed, total: p.total, matched: p.matched, queued: p.queued });
      done = p.done;
    }
    await refresh(id);
    setBusy(false);
  }

  async function classifyQueue() {
    if (!runId) return;
    setBusy(true);
    const res = await fetch(`/api/tools/lender-followup/run/${runId}/classify-queue`, { method: "POST" });
    setBusy(false);
    if (res.ok) await refresh(runId);
  }

  async function assign(messageId: string, lenderId: string) {
    if (!runId) return;
    await fetch(`/api/tools/lender-followup/run/${runId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, lenderId }),
    });
    await refresh(runId);
  }

  async function ignore(messageId: string) {
    if (!runId) return;
    await fetch(`/api/tools/lender-followup/run/${runId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, action: "ignore" }),
    });
    await refresh(runId);
  }

  if (!connected) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-cal">
        <p className="mb-1 text-sm text-gray-700">Gmail (read-only) access isn&apos;t granted yet.</p>
        <p className="mb-4 text-sm text-gray-600">
          Sign out and sign back in with Google — the sign-in asks for read-only Gmail permission. Email is never marked read.
        </p>
        <SignOutButton>
          <button className="inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white">Sign out &amp; sign back in</button>
        </SignOutButton>
      </div>
    );
  }

  const tracker = (data?.tracker ?? []).filter((t) => !ownerFilter || t.owner === ownerFilter);

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-line-light bg-surface-secondary/50 px-3 py-2 text-xs text-ink-tertiary">{PRIVACY}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-500">Using Gmail access for {connectedEmail ?? "your account"}</span>
        <button onClick={run} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Running…" : "Run"}
        </button>
        {progress && (
          <span className="text-sm text-gray-600">
            {progress.processed}/{progress.total} scanned · {progress.matched} matched · {progress.queued} queued
          </span>
        )}
      </div>
      {progress && progress.total > 0 && (
        <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Lenders with items: <b>{data.run.counts.lenders_with_items}</b></span>
            <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Open items: <b>{data.run.counts.open_items}</b></span>
            <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Matched: <b>{data.run.counts.matched}</b></span>
            <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">In review queue: <b>{data.run.counts.queued}</b></span>
            <div className="ml-auto flex items-center gap-2">
              {owners.length > 0 && (
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="rounded border border-line px-2 py-1 text-sm text-gray-900">
                  <option value="">All owners</option>
                  {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              <a href={`/api/tools/lender-followup/run/${data.run.id}/export?format=csv`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-secondary">CSV</a>
              <a href={`/api/tools/lender-followup/run/${data.run.id}/export?format=xlsx`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-secondary">Excel</a>
            </div>
          </div>

          {/* Tracker */}
          <div className="space-y-4">
            {tracker.map((t) => (
              <div key={t.lender_id ?? t.lender_name} className="rounded-2xl border border-line bg-surface p-4 shadow-cal">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-medium text-ink">{t.lender_name}</h3>
                  <span className="text-xs text-ink-tertiary">{t.owner ?? "—"} · {t.items.length} open</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {t.items.map((it, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 border-t border-line-light py-1">
                      <span className="text-ink">{it.item}</span>
                      <span className="rounded bg-surface-secondary px-2 py-0.5 text-xs text-ink-secondary">{it.status}</span>
                      <span className="text-xs text-ink-tertiary">{it.last_update_date ?? ""}</span>
                      <span className="text-xs text-ink-tertiary">[{it.direction}]</span>
                      <a href={`/api/tools/lender-followup/message/${it.source_message_id}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-brand hover:underline">view email</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {tracker.length === 0 && <p className="text-sm text-ink-tertiary">No lender pendencies yet.</p>}
          </div>

          {/* Review queue */}
          {data.queue.ids.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-cal">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium text-ink">Needs assignment ({data.queue.ids.length})</h3>
                <button onClick={classifyQueue} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-secondary disabled:opacity-50">
                  Classify queue (AI)
                </button>
              </div>
              <ul className="space-y-2 text-sm">
                {data.queue.meta.map((m) => (
                  <li key={m.message_id} className="flex flex-wrap items-center gap-2 border-t border-line-light py-2">
                    <span className="text-ink-secondary">{m.from_email}</span>
                    <span className="text-ink">{m.subject}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <select
                        defaultValue=""
                        onChange={(e) => e.target.value && assign(m.message_id, e.target.value)}
                        className="rounded border border-line px-2 py-1 text-xs text-gray-900"
                      >
                        <option value="">Assign to…</option>
                        {lenders.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                      <button onClick={() => ignore(m.message_id)} className="rounded border border-line px-2 py-1 text-xs text-ink-tertiary hover:bg-surface-secondary">
                        Not a lender
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
