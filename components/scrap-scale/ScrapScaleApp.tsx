"use client";
import { useState } from "react";
import { SignOutButton } from "@clerk/nextjs";
import { ReconSummary, type Summary } from "./ReconSummary";
import { ResultsTable, type ResultRow } from "./ResultsTable";
import { FilterPanel } from "./FilterPanel";
import type { ColumnFilter } from "@/lib/scrap-scale/filters";

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
  sheets: string[];
  headers: string[];
  detection: Detection;
  rowCount: number;
};

/** Read a fetch Response as JSON without throwing on empty / non-JSON bodies. */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 300) };
  }
}

type Payment = { amount: number; currency: string; txn_id: string | null; date: string | null };
type TestFileResult = {
  file_id: string;
  name: string;
  mimeType: string;
  amount: number | null;
  payments: Payment[];
  txn_ids: string[];
  readable: boolean;
  error: string | null;
  notes: string;
};
type TestLinkResponse = {
  linkIds: string[];
  fileCount: number;
  truncated: boolean;
  resolveErrors: { id: string; error: string }[];
  results: TestFileResult[];
};

export function ScrapScaleApp({ connected, connectedEmail }: { connected: boolean; connectedEmail: string | null }) {
  const [url, setUrl] = useState("");
  const [detect, setDetect] = useState<DetectResponse | null>(null);
  const [sheetTab, setSheetTab] = useState<string>("");
  const [cols, setCols] = useState<{ link: number; expected: number; name: number }>({ link: -1, expected: -1, name: -1 });
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; subtotal: number } | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sumExpected, setSumExpected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testUrl, setTestUrl] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestLinkResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  async function doTestLink() {
    setTestError(null);
    setTestResult(null);
    setTestBusy(true);
    const res = await fetch("/api/tools/scrap-scale/test-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: testUrl }),
    });
    setTestBusy(false);
    if (res.status === 409) {
      setTestError("Google access missing — sign out and sign in again to grant Sheets/Drive.");
      return;
    }
    const body = await readJson(res);
    if (!res.ok) {
      setTestError((body.error as string) ?? "Test failed");
      return;
    }
    setTestResult(body as unknown as TestLinkResponse);
  }

  async function doDetect(tab?: string) {
    setError(null);
    setBusy(true);
    const res = await fetch("/api/tools/scrap-scale/detect-columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...(tab ? { tab } : {}) }),
    });
    setBusy(false);
    if (res.status === 409) {
      setError("Google access missing — sign out and sign in again to grant Sheets/Drive.");
      return;
    }
    const body = await readJson(res);
    if (!res.ok) {
      setError((body.error as string) ?? "Detection failed");
      return;
    }
    const d = body as unknown as DetectResponse;
    setDetect(d);
    setSheetTab(d.sheetTab);
    setFilters([]);
    setCols({
      link: d.detection.link?.index ?? -1,
      expected: d.detection.expected?.index ?? -1,
      name: d.detection.name?.index ?? -1,
    });
  }

  function changeSheet(tab: string) {
    setSheetTab(tab);
    doDetect(tab);
  }

  async function loadColumnValues(index: number) {
    const res = await fetch("/api/tools/scrap-scale/column-values", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spreadsheetId: detect!.spreadsheetId, sheetTab: sheetTab || detect!.sheetTab, index }),
    });
    const body = await readJson(res);
    return {
      values: (body.values as { value: string; count: number }[]) ?? [],
      type: (body.type as "text" | "number" | "date") ?? "text",
    };
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
        sheetTab: sheetTab || detect.sheetTab,
        columns: {
          link: { index: cols.link },
          expected: cols.expected >= 0 ? { index: cols.expected } : null,
          name: cols.name >= 0 ? { index: cols.name } : null,
        },
        filters,
      }),
    });
    if (!res.ok) {
      setBusy(false);
      setError(((await readJson(res)).error as string) ?? "Run failed");
      return;
    }
    const { runId: id, totalRows } = await readJson(res) as { runId: string; totalRows: number };
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
        <p className="mb-1 text-sm text-gray-700">Google Sheets/Drive access isn&apos;t granted yet.</p>
        <p className="mb-4 text-sm text-gray-600">
          Sign out and sign back in with Google — the sign-in now asks for Sheets/Drive permission, so
          there&apos;s no separate connect step.
        </p>
        <SignOutButton>
          <button className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm text-white">
            Sign out &amp; sign back in
          </button>
        </SignOutButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-xs text-gray-500">
        <span>Using Google access for {connectedEmail ?? "your account"}</span>
      </div>

      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste Google Sheet URL"
          className="flex-1 rounded-md border px-3 py-2 text-sm text-gray-900"
        />
        <button onClick={() => doDetect()} disabled={busy || !url} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
          Detect columns
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <details className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          Test a Drive link (diagnose extraction)
        </summary>
        <p className="mt-2 text-xs text-gray-500">
          Paste a single Drive link (or a cell&apos;s contents) to see exactly which files are found and what Gemini reads
          — images, PDFs, multi-page files, and folders are all supported. Skips the cache.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="Paste a Google Drive link"
            className="flex-1 rounded-md border px-3 py-2 text-sm text-gray-900"
          />
          <button
            onClick={doTestLink}
            disabled={testBusy || !testUrl}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {testBusy ? "Testing…" : "Test"}
          </button>
        </div>
        {testError && <p className="mt-2 text-sm text-red-600">{testError}</p>}
        {testResult && (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-gray-600">
              Found <b>{testResult.fileCount}</b> file{testResult.fileCount === 1 ? "" : "s"}
              {testResult.truncated ? " (showing first 10)" : ""} from {testResult.linkIds.length} link(s).
            </p>
            {testResult.resolveErrors.map((e) => (
              <p key={e.id} className="text-red-600">
                Could not open <code>{e.id}</code>: {e.error}
              </p>
            ))}
            {testResult.results.map((r) => (
              <div key={r.file_id} className="rounded border p-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{r.name}</span>
                  <span className="text-xs text-gray-400">{r.mimeType}</span>
                </div>
                {r.readable ? (
                  <div className="text-gray-700">
                    amount: <b>₹{(r.amount ?? 0).toLocaleString("en-IN")}</b>
                    {r.payments.length > 1 ? ` (${r.payments.length} payments)` : ""}
                    {r.txn_ids.length ? ` · txn ${r.txn_ids.join(", ")}` : ""}
                  </div>
                ) : (
                  <div className="text-red-600">{r.error ?? "Could not read amount"}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </details>

      {detect && (
        <div className="rounded-xl border bg-white p-4">
          {detect.sheets.length > 1 && (
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-gray-600">Sheet / tab</span>
              <select
                value={sheetTab}
                onChange={(e) => changeSheet(e.target.value)}
                disabled={busy}
                className="w-full rounded border px-2 py-1 text-gray-900 disabled:opacity-50 sm:w-72"
              >
                {detect.sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
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
          <div className="mt-4 border-t pt-4">
            <FilterPanel headers={detect.headers} filters={filters} onChange={setFilters} loadValues={loadColumnValues} />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button onClick={doRun} disabled={busy || cols.link < 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">
              Run ({detect.rowCount} rows{filters.length ? ", filtered" : ""})
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
