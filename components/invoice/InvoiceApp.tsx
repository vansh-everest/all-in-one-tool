"use client";
import { useState } from "react";
import { SignOutButton } from "@clerk/nextjs";
import type { InvoiceCounts } from "./types";

const PRIVACY =
  "Only mail carrying your chosen Gmail label is read — its invoice attachments (PDF/image) are sent to Gemini to extract the bill fields. All other mail is never opened or sent anywhere, and email is never marked read.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Local YYYY-MM-DD (client-side date is fine in a client component).
function localToday() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function InvoiceApp({
  connected,
  connectedEmail,
  latestRunId,
  resume = null,
}: {
  connected: boolean;
  connectedEmail: string | null;
  latestRunId: string | null;
  resume?: { runId: string; total: number; processed: number } | null;
}) {
  const [progress, setProgress] = useState<{ processed: number; total: number; counts: InvoiceCounts } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Excel download endpoint (built from a variable so Next's page-link lint rule doesn't flag it).
  const exportPath = latestRunId ? `/api/tools/invoice-zoho/run/${latestRunId}/export?format=xlsx` : null;

  // Loop a run's chunks; pause+retry on rate limits (resumes exactly where it paused).
  async function processLoop(id: string, total: number, startProcessed = 0) {
    setProgress({ processed: startProcessed, total, counts: {} });
    let done = false;
    let failed = false;
    let waits = 0;
    while (!done) {
      const cr = await fetch(`/api/tools/invoice-zoho/run/${id}/process-chunk`, { method: "POST" });
      if (!cr.ok) {
        const body = await cr.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Processing error");
        failed = true;
        break;
      }
      const p = await cr.json();
      if (p.rateLimited) {
        setProgress({ processed: p.processed, total: p.total, counts: p.counts ?? {} });
        if (++waits > 40) {
          setError("Still rate-limited after a long wait — paused. Click Resume later to continue.");
          failed = true;
          break;
        }
        setWaiting(true);
        await sleep(30000); // all keys exhausted — wait for quota to recover, then retry the same slice
        setWaiting(false);
        continue;
      }
      waits = 0;
      setProgress({ processed: p.processed, total: p.total, counts: p.counts ?? {} });
      done = p.done;
    }
    setBusy(false);
    setWaiting(false);
    if (done && !failed) window.location.reload();
  }

  async function run() {
    setError(null);
    setBusy(true);
    const res = await fetch("/api/tools/invoice-zoho/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ today: localToday() }),
    });
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
    await processLoop(id, total);
  }

  async function resumeRun() {
    if (!resume) return;
    setError(null);
    setBusy(true);
    await processLoop(resume.runId, resume.total, resume.processed);
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

  const c = progress?.counts ?? {};

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-line-light bg-surface-secondary/50 px-3 py-2 text-xs text-ink-tertiary">{PRIVACY}</p>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-500">Using Gmail access for {connectedEmail ?? "your account"}</span>
        <button onClick={run} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Processing…" : "Run"}
        </button>
        {resume && !busy && (
          <button onClick={resumeRun} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100">
            Resume paused run ({resume.processed}/{resume.total})
          </button>
        )}
        {progress && (
          <span className="text-sm text-gray-600">
            {progress.processed}/{progress.total} messages
            {waiting && <span className="ml-2 text-amber-700">· rate-limited, waiting for quota…</span>}
          </span>
        )}
        <div className="ml-auto">
          {exportPath && (
            <a href={exportPath} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-secondary">
              Download Excel
            </a>
          )}
        </div>
      </div>
      {progress && progress.total > 0 && (
        <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {progress && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Invoices: <b>{c.invoices ?? 0}</b></span>
          <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Rows: <b>{c.rows ?? 0}</b></span>
          <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Flagged: <b>{c.flagged ?? 0}</b></span>
          <span className="rounded-full bg-surface-secondary px-3 py-1 text-ink-secondary">Duplicates: <b>{c.duplicates ?? 0}</b></span>
        </div>
      )}
    </div>
  );
}
