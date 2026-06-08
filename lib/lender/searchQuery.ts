import type { Lender } from "./types";

/** A subject phrase term: strip parenthetical qualifiers, collapse spaces, quote. */
function subjectPhrase(name: string): string | null {
  const cleaned = (name ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 3) return null; // too short to phrase-search safely
  return `subject:"${cleaned.replace(/"/g, "")}"`;
}

/**
 * Build a Gmail query that finds UNREAD mail genuinely FROM this lender:
 *   - its sender domains / known sender emails (precise), OR
 *   - its name / aliases appearing in the SUBJECT (not the body).
 * Restricting the name match to the subject (never the body) stops internal emails that
 * merely mention a bank from matching. Returns null when nothing is searchable.
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
  const subj = subjectPhrase(lender.name);
  if (subj) terms.push(subj);
  for (const a of lender.aliases) {
    const p = subjectPhrase(a);
    if (p && !terms.includes(p)) terms.push(p);
  }
  if (!terms.length) return null;
  return `is:unread (${terms.join(" OR ")})`;
}
