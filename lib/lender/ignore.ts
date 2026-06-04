import type { EmailMeta } from "./types";

/** Remove emails whose sender address is in the ignore set (set values must be lowercased). */
export function filterIgnored(emails: EmailMeta[], ignored: Set<string>): EmailMeta[] {
  if (ignored.size === 0) return emails;
  return emails.filter((m) => !ignored.has(m.fromEmail.toLowerCase()));
}
