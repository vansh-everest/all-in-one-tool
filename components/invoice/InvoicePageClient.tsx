"use client";
import { useState } from "react";
import { InvoiceApp } from "./InvoiceApp";
import { InvoiceConfig } from "./InvoiceConfig";
import { InvoiceGrid } from "./InvoiceGrid";
import { InvoiceRunHistory } from "./InvoiceRunHistory";
import type { InvoiceConfigT, InvoiceProfile, InvoiceRow, InvoiceRunSummary } from "./types";

export function InvoicePageClient({
  connected,
  connectedEmail,
  config,
  profiles,
  latestRunId,
  latestRows,
  runs,
  resume,
  canManage,
}: {
  connected: boolean;
  connectedEmail: string | null;
  config: InvoiceConfigT | null;
  profiles: InvoiceProfile[];
  latestRunId: string | null;
  latestRows: InvoiceRow[];
  runs: InvoiceRunSummary[];
  resume: { runId: string; total: number; processed: number } | null;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<"bills" | "config">("bills");
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg bg-surface-secondary p-0.5 text-sm">
        {(["bills", "config"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 transition-colors ${tab === t ? "bg-surface font-medium text-ink shadow-cal-sm" : "text-ink-tertiary hover:text-ink-secondary"}`}
          >
            {t === "bills" ? "Bills" : "Config"}
          </button>
        ))}
      </div>
      {tab === "bills" ? (
        <>
          <InvoiceApp connected={connected} connectedEmail={connectedEmail} latestRunId={latestRunId} resume={resume} />
          <InvoiceGrid rows={latestRows} />
          <InvoiceRunHistory runs={runs} canManage={canManage} />
        </>
      ) : (
        <InvoiceConfig config={config} profiles={profiles} />
      )}
    </div>
  );
}
