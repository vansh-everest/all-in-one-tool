"use client";
import { useState } from "react";
import { SignOutButton } from "@clerk/nextjs";
import type { UnifiedGrid } from "@/lib/lender/types";
import { LenderSheetGrid } from "./LenderSheetGrid";

const PRIVACY =
  "The scan searches unread mail for each lender's name / domain / known senders, and only those matching threads are read in full and sent to Gemini to extract pending tasks. All other unread mail is never opened or sent anywhere. Email is never marked read.";

// API download endpoint (built as a variable so Next's page-link lint rule doesn't flag it).
const EXPORT_PATH = "/api/tools/lender-followup/run/current/export";

export function LenderFollowupApp({
  connected,
  connectedEmail,
  grid,
}: {
  connected: boolean;
  connectedEmail: string | null;
  grid: UnifiedGrid;
}) {
  const [progress, setProgress] = useState<{ processed: number; total: number; matched: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [importUrl, setImportUrl] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const owners = [...new Set(grid.columns.map((c) => c.owner).filter(Boolean))] as string[];

  async function run() {
    setError(null);
    setBusy(true);
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
    setProgress({ processed: 0, total, matched: 0 });
    let done = false;
    let failed = false;
    while (!done) {
      const cr = await fetch(`/api/tools/lender-followup/run/${id}/process-chunk`, { method: "POST" });
      if (!cr.ok) {
        const body = await cr.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Processing error");
        failed = true;
        break;
      }
      const p = await cr.json();
      setProgress({ processed: p.processed, total: p.total, matched: p.matched });
      done = p.done;
    }
    setBusy(false);
    // Only reload on a clean finish; on error keep the message visible (no blind refresh).
    if (done && !failed) window.location.reload();
  }

  async function importFromSheet() {
    if (!importUrl.trim()) return;
    setError(null);
    setImportMsg(null);
    setBusy(true);
    const res = await fetch("/api/tools/lender-followup/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: importUrl.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Import failed");
      return;
    }
    const s = await res.json();
    setImportMsg(`Imported ${s.lenders} lenders (${s.lendersCreated} new, ${s.lendersUpdated} updated) and ${s.items} pending items. Reloading…`);
    setTimeout(() => window.location.reload(), 900);
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

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-line-light bg-surface-secondary/50 px-3 py-2 text-xs text-ink-tertiary">{PRIVACY}</p>

      {/* Import current pendencies from the "Pendencies with Lenders" sheet */}
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-cal">
        <h3 className="mb-1 text-sm font-medium text-ink">Import from sheet</h3>
        <p className="mb-2 text-xs text-ink-tertiary">
          Paste the &quot;Pendencies with Lenders&quot; Google Sheet link — the tool reads the lender columns and their owners,
          adds any missing lenders, and loads the current pending items as the tracker (cached for future).
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="min-w-[18rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm text-gray-900"
          />
          <button onClick={importFromSheet} disabled={busy || !importUrl.trim()} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Import
          </button>
        </div>
        {importMsg && <p className="mt-2 text-xs text-green-700">{importMsg}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-500">Using Gmail access for {connectedEmail ?? "your account"}</span>
        <button onClick={run} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Scanning…" : "Scan unread mail"}
        </button>
        {progress && (
          <span className="text-sm text-gray-600">
            {progress.processed}/{progress.total} lenders scanned · {progress.matched} threads matched
          </span>
        )}
      </div>
      {progress && progress.total > 0 && (
        <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Lenders with items: <b>{grid.counts.lenders_with_items}</b></span>
        <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Open items: <b>{grid.counts.open_items}</b></span>
        <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">From email: <b>{grid.counts.email_items}</b></span>
        <div className="ml-auto flex items-center gap-2">
          {owners.length > 0 && (
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="rounded border border-line px-2 py-1 text-sm text-gray-900">
              <option value="">All owners</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          <a href={`${EXPORT_PATH}?format=csv`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-secondary">CSV</a>
          <a href={`${EXPORT_PATH}?format=xlsx`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-secondary">Excel</a>
        </div>
      </div>

      <LenderSheetGrid grid={grid} ownerFilter={ownerFilter} />
      <p className="text-xs text-ink-tertiary">
        <span className="mr-1 inline-block h-3 w-3 rounded-sm bg-amber-50 align-middle ring-1 ring-line" /> highlighted cells are tasks found in email (click ✉ mail to view the thread).
      </p>
    </div>
  );
}
