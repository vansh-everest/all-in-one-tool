"use client";
import { useState } from "react";
import type { Lender } from "@/lib/lender/types";

const csv = (a: string[]) => a.join(", ");
const toArr = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function LenderManager({ initial, canManage }: { initial: Lender[]; canManage: boolean }) {
  const [lenders, setLenders] = useState<Lender[]>(initial);
  const [draft, setDraft] = useState({ name: "", owner: "", sender_domains: "", known_sender_emails: "", aliases: "" });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!draft.name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/tools/lender-followup/lenders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        owner: draft.owner || null,
        sender_domains: toArr(draft.sender_domains),
        known_sender_emails: toArr(draft.known_sender_emails),
        aliases: toArr(draft.aliases),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const { lender } = await res.json();
      setLenders((l) => [...l, lender].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft({ name: "", owner: "", sender_domains: "", known_sender_emails: "", aliases: "" });
    }
  }

  async function save(id: string, patch: Partial<Lender> & { sender_domains?: string[]; known_sender_emails?: string[] }) {
    const res = await fetch(`/api/tools/lender-followup/lenders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const { lender } = await res.json();
      setLenders((l) => l.map((x) => (x.id === id ? lender : x)));
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this lender?")) return;
    const res = await fetch(`/api/tools/lender-followup/lenders/${id}`, { method: "DELETE" });
    if (res.ok) setLenders((l) => l.filter((x) => x.id !== id));
    else alert((await res.json().catch(() => ({}))).error ?? "Delete failed");
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-cal">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-ink-tertiary">
              <th className="px-3 py-2">Lender</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Sender domains</th>
              <th className="px-3 py-2">Known senders</th>
              <th className="px-3 py-2">Active</th>
              {canManage && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {lenders.map((l) => (
              <tr key={l.id} className="border-t border-line-light align-top">
                <td className="px-3 py-2 text-ink">{l.name}</td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={l.owner ?? ""}
                    onBlur={(e) => e.target.value !== (l.owner ?? "") && save(l.id, { owner: e.target.value || null })}
                    className="w-24 rounded border border-line px-2 py-1 text-gray-900"
                    placeholder="owner"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={csv(l.sender_domains)}
                    onBlur={(e) => save(l.id, { sender_domains: toArr(e.target.value) })}
                    className="w-56 rounded border border-line px-2 py-1 text-gray-900"
                    placeholder="axisbank.com, ..."
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={csv(l.known_sender_emails)}
                    onBlur={(e) => save(l.id, { known_sender_emails: toArr(e.target.value) })}
                    className="w-56 rounded border border-line px-2 py-1 text-gray-900"
                    placeholder="alerts@axisbank.com, ..."
                  />
                </td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={l.active} onChange={(e) => save(l.id, { active: e.target.checked })} />
                </td>
                {canManage && (
                  <td className="px-3 py-2">
                    <button onClick={() => remove(l.id)} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-cal">
        <h3 className="mb-2 text-sm font-medium text-ink">Add lender</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" className="rounded border border-line px-2 py-1 text-gray-900" />
          <input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} placeholder="Owner" className="rounded border border-line px-2 py-1 text-gray-900" />
          <input value={draft.sender_domains} onChange={(e) => setDraft({ ...draft, sender_domains: e.target.value })} placeholder="domains (comma)" className="rounded border border-line px-2 py-1 text-gray-900" />
          <input value={draft.known_sender_emails} onChange={(e) => setDraft({ ...draft, known_sender_emails: e.target.value })} placeholder="known senders (comma)" className="rounded border border-line px-2 py-1 text-gray-900" />
          <button onClick={add} disabled={busy || !draft.name.trim()} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
