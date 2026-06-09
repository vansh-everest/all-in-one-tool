"use client";
import { useMemo, useState } from "react";
import type { InvoiceConfigT, InvoiceProfile } from "./types";

type ConstEntry = { key: string; value: string };

function entriesOf(constants: Record<string, string | number> | undefined): ConstEntry[] {
  return Object.entries(constants ?? {}).map(([key, value]) => ({ key, value: String(value ?? "") }));
}

export function InvoiceConfig({ config, profiles }: { config: InvoiceConfigT | null; profiles: InvoiceProfile[] }) {
  const today = useMemo(() => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }, []);

  const [label, setLabel] = useState(config?.gmail_label ?? "");
  const [sinceDate, setSinceDate] = useState(config?.last_run_date ?? today);
  const [profileId, setProfileId] = useState(config?.profile_id ?? profiles[0]?.id ?? "");
  const [profileList, setProfileList] = useState<InvoiceProfile[]>(profiles);
  const selected = profileList.find((p) => p.id === profileId) ?? null;
  const [rows, setRows] = useState<ConstEntry[]>(entriesOf(selected?.constants));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectProfile(id: string) {
    setProfileId(id);
    const p = profileList.find((x) => x.id === id);
    setRows(entriesOf(p?.constants));
  }

  function updateRow(i: number, field: "key" | "value", v: string) {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function addRow() {
    setRows((cur) => [...cur, { key: "", value: "" }]);
  }
  function removeRow(i: number) {
    setRows((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      // Save config (label, profile, since override).
      const cfgRes = await fetch("/api/tools/invoice-zoho/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gmail_label: label.trim(), profile_id: profileId, last_run_date: sinceDate || null }),
      });
      if (!cfgRes.ok) throw new Error((await cfgRes.json().catch(() => ({}))).error ?? "Saving config failed");

      // Save the editable constants table back to the selected profile.
      if (profileId) {
        const constants: Record<string, string | number> = {};
        for (const r of rows) {
          const k = r.key.trim();
          if (!k) continue;
          const n = Number(r.value);
          constants[k] = r.value.trim() !== "" && Number.isFinite(n) && String(n) === r.value.trim() ? n : r.value;
        }
        const pRes = await fetch(`/api/tools/invoice-zoho/profiles/${profileId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ constants }),
        });
        if (!pRes.ok) throw new Error((await pRes.json().catch(() => ({}))).error ?? "Saving profile failed");
        const { profile } = await pRes.json();
        if (profile) setProfileList((cur) => cur.map((p) => (p.id === profile.id ? profile : p)));
      }
      setMsg("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-cal">
        <h3 className="mb-3 text-sm font-medium text-ink">Source &amp; profile</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-tertiary">Gmail label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Invoices"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-gray-900"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-tertiary">Since date (only mail on/after)</span>
            <input
              type="date"
              value={sinceDate}
              onChange={(e) => setSinceDate(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-gray-900"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-tertiary">Mapping profile</span>
            <select
              value={profileId}
              onChange={(e) => selectProfile(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-gray-900"
            >
              {profileList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-cal">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">Constant column values</h3>
          <button onClick={addRow} className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-secondary">+ add row</button>
        </div>
        <p className="mb-3 text-xs text-ink-tertiary">
          These values fill the fixed Zoho columns (e.g. Accounts Payable, Account Code). Numeric values are stored as numbers.
        </p>
        <div className="overflow-x-auto rounded-lg border border-line-light">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-secondary text-ink-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Column</th>
                <th className="px-3 py-2 text-left">Value</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line-light">
                  <td className="px-3 py-1.5">
                    <input
                      value={r.key}
                      onChange={(e) => updateRow(i, "key", e.target.value)}
                      className="w-full rounded border border-line px-2 py-1 text-sm text-gray-900"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      value={r.value}
                      onChange={(e) => updateRow(i, "value", e.target.value)}
                      className="w-full rounded border border-line px-2 py-1 text-sm text-gray-900"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button onClick={() => removeRow(i)} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">Remove</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-xs text-ink-tertiary">No constants — add a row.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
