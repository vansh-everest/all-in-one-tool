"use client";
import { useState } from "react";
import { LenderFollowupApp } from "./LenderFollowupApp";
import { LenderManager } from "./LenderManager";
import { LenderRunHistory } from "./LenderRunHistory";
import type { Lender } from "@/lib/lender/types";

type Run = { id: string; created_at: string; created_by_email: string | null; status: string; counts: { matched?: number; open_items?: number; lenders_with_items?: number; queued?: number } | null };

export function LenderFollowupPageClient({
  connected, connectedEmail, lenders, runs, canManage,
}: {
  connected: boolean; connectedEmail: string | null; lenders: Lender[]; runs: Run[]; canManage: boolean;
}) {
  const [tab, setTab] = useState<"tracker" | "lenders">("tracker");
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg bg-surface-secondary p-0.5 text-sm">
        {(["tracker", "lenders"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 transition-colors ${tab === t ? "bg-surface font-medium text-ink shadow-cal-sm" : "text-ink-tertiary hover:text-ink-secondary"}`}
          >
            {t === "tracker" ? "Tracker" : "Manage lenders"}
          </button>
        ))}
      </div>
      {tab === "tracker" ? (
        <>
          <LenderFollowupApp connected={connected} connectedEmail={connectedEmail} lenders={lenders} />
          <LenderRunHistory runs={runs} />
        </>
      ) : (
        <LenderManager initial={lenders} canManage={canManage} />
      )}
    </div>
  );
}
