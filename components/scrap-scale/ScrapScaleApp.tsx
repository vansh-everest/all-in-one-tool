"use client";
import { useState } from "react";
import { ReconSummary, type Summary } from "./ReconSummary";
import { ResultsTable, type ResultRow } from "./ResultsTable";

type Detection = {
  link: { index: number; header: string } | null;
  expected: { index: number; header: string } | null;
  name: { index: number; header: string } | null;
  ambiguous: boolean;
  linkCandidates: number[];
  headers: string[];
};
type DetectResponse = {
  spreadsheetId: string;
  sheetTab: string;
  headers: string[];
  detection: Detection;
  rowCount: number;
};

export function ScrapScaleApp({ connected, connectedEmail }: { connected: boolean; connectedEmail: string | null }) {
  const [url, setUrl] = useState("");
  const [detect, setDetect] = useState<DetectResponse | null>(null);
  const [cols, setCols] = useState<{ link: number; expected: number; name: number }>({ link: -1, expected: -1, name: -1 });
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; subtotal: number } | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sumExpected, setSumExpected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDetect() {
    setError(null);
    setBusy(true);
    const res = await fetch("/api/tools/scrap-scale/detect-columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setBusy(false);
    if (res.status === 409) {
      setError("Google access needs re-consent. Click Reconnect.");
      return;
    }
    if (!res.ok) {
      setError((await res.json()).error ?? "Detection failed");
      return;
    }
    const d: DetectResponse = await res.json();
    setDetect(d);
    setCols({
      link: d.detection.link?.index ?? -1,
      expected: d.detection.expected?.index ?? -1,
      name: d.detection.name?.index ?? -1,
    });
  }

  async function doRun() {
    if (!detect || cols.link < 0) {
      setError("Pick the link column.");
      return;
    }
    setError(null);
    setBusy(true);
    setSummary(null);
    setRows([]);
    const res = await fetch("/api/tools/scrap-scale/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spreadsheetId: detect.spreadsheetId,
        sheetTab: detect.sheetTab,
        columns: {
          link: { index: cols.link },
          expected: cols.expected >= 0 ? { index: cols.expected } : null,
          name: cols.name >= 0 ? { index: cols.name } : null,
        },
      }),
    });
    if (!res.ok) {
      setBusy(false);
      setError((await res.json()).error ?? "Run failed");
      return;
    }
    const { runId: id, totalRows } = await res.json();
    setRunId(id);
    setProgress({ processed: 0, total: totalRows, subtotal: 0 });

    let done = false;
    while (!done) {
      const cr = await fetch(`/api/tools/scrap-scale/run/${id}/process-chunk`, { method: "POST" });
      if (!cr.ok) {
        setError("Processing error");
        break;
      }
      const p = await cr.json();
      setProgress({ processed: p.processed, total: p.total, subtotal: p.subtotal });
      done = p.done;
      if (p.done && p.summary) setSummary(p.summary);
    }
    const final = await fetch(`/api/tools/scrap-scale/run/${id}`).then((r) => r.json());
    setRows(final.rows);
    setSumExpected(final.rows.reduce((s: number, r: ResultRow) => s + (Number(r.expected_amount) || 0), 0));
    setBusy(false);
  }

  async function writeBack() {
    if (!runId) return;
    setBusy(true);
    const res = await fetch(`/api/tools/scrap-scale/run/${runId}/write-back`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const { resultsTab } = await res.json();
      alert(`Wrote results tab: ${resultsTab}`);
    } else {
      setError("Write-back failed");
    }
  }

  if (!connected) {
    return (
      <div className="rounded-xl border bg-white p-8">
        <p className="mb-4 text-sm text-gray-600">
          Connect a Google account (with access to the source sheet + Drive) to use Scrap Scale.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full navigation to an OAuth redirect endpoint, not a page */}
        <a href="/api/google/oauth/start?department=accounting" className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm text-white">
          Connect Google
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Connected as {connectedEmail ?? "Google account"}</span>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full navigation to an OAuth redirect endpoint, not a page */}
        <a href="/api/google/oauth/start?department=accounting" className="text-indigo-600 hover:underline">
          Reconnect
        </a>
      </div>

      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste Google Sheet URL"
          className="flex-1 rounded-md border px-3 py-2 text-sm text-gray-900"
        />
        <button onClick={doDetect} disabled={busy || !url} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
          Detect columns
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {detect && (
        <div className="rounded-xl border bg-white p-4">
          {detect.detection.ambiguous && (
            <p className="mb-2 text-sm text-amber-700">Two link columns matched — pick the correct one below.</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["link", "expected", "name"] as const).map((field) => (
              <label key={field} className="text-sm">
                <span className="mb-1 block text-gray-600">
                  {field === "link" ? "Link column" : field === "expected" ? "Total Fund Collection" : "Name (optional)"}
                </span>
                <select
                  value={cols[field]}
                  onChange={(e) => setCols({ ...cols, [field]: Number(e.target.value) })}
                  className="w-full rounded border px-2 py-1 text-gray-900"
                >
                  <option value={-1}>—</option>
                  {detect.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `(col ${i + 1})`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={doRun} disabled={busy || cols.link < 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">
              Run ({detect.rowCount} rows)
            </button>
            {progress && (
              <span className="text-sm text-gray-600">
                {progress.processed}/{progress.total} · subtotal ₹{progress.subtotal.toLocaleString("en-IN")}
              </span>
            )}
          </div>
          {progress && progress.total > 0 && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-100">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {summary && (
        <>
          <ReconSummary summary={summary} sumExpected={sumExpected} />
          <div className="flex flex-wrap gap-2">
            <button onClick={writeBack} disabled={busy} className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50">
              Write results tab to sheet
            </button>
            {runId && (
              <a href={`/api/tools/scrap-scale/run/${runId}/export?format=csv`} className="rounded-md border px-3 py-2 text-sm">
                Download CSV
              </a>
            )}
            {runId && (
              <a href={`/api/tools/scrap-scale/run/${runId}/export?format=xlsx`} className="rounded-md border px-3 py-2 text-sm">
                Download Excel
              </a>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-white p-2">
            <ResultsTable rows={rows} />
          </div>
        </>
      )}
    </div>
  );
}
