import type { Lender } from "./types";

/** A phrase term for Gmail search: strip parenthetical qualifiers, collapse spaces, quote. */
function phrase(name: string): string | null {
  const cleaned = (name ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 3) return null; // too short/generic to phrase-search safely
  return `"${cleaned.replace(/"/g, "")}"`;
}

/**
 * Build a Gmail search query that finds UNREAD mail likely belonging to this lender:
 * its sender domains/known senders (precise) OR its name/aliases as phrases (recall).
 * Returns null when there's nothing searchable.
 */
export function buildLenderQuery(lender: Lender): string | null {
  const terms: string[] = [];
  for (const d of lender.sender_domains) {
    const dom = d.trim().toLowerCase();
    if (dom) terms.push(`from:${dom}`);
  }
  for (const e of lender.known_sender_emails) {
    const em = e.trim().toLowerCase();
    if (em) terms.push(`from:${em}`);
  }
  const namePhrase = phrase(lender.name);
  if (namePhrase) terms.push(namePhrase);
  for (const a of lender.aliases) {
    const p = phrase(a);
    if (p && !terms.includes(p)) terms.push(p);
  }
  if (!terms.length) return null;
  return `is:unread (${terms.join(" OR ")})`;
}
