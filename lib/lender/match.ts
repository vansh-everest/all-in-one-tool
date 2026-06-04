import type { Lender } from "./types";

/** Pull the bare address out of a possibly "Name <addr>" header and lowercase it. */
export function normalizeEmail(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/);
  const addr = (m ? m[1] : raw).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(addr) ? addr : "";
}

export function emailDomain(raw: string): string {
  const addr = normalizeEmail(raw);
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1) : "";
}

/**
 * Deterministic match: exact known_sender_emails first, then sender_domains suffix.
 * Only active lenders participate. Returns the lender id or null.
 */
export function matchLender(fromEmail: string, lenders: Lender[]): string | null {
  const addr = normalizeEmail(fromEmail);
  if (!addr) return null;
  const domain = emailDomain(addr);
  const active = lenders.filter((l) => l.active);
  for (const l of active) {
    if (l.known_sender_emails.map((e) => e.toLowerCase()).includes(addr)) return l.id;
  }
  for (const l of active) {
    if (l.sender_domains.some((d) => d && (domain === d.toLowerCase() || domain.endsWith("." + d.toLowerCase())))) {
      return l.id;
    }
  }
  return null;
}
