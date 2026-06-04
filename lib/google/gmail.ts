import { normalizeEmail } from "@/lib/lender/match";
import type { EmailMeta } from "@/lib/lender/types";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
};

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function parseMetadata(msg: GmailMessage): EmailMeta {
  const from = header(msg, "From");
  return {
    id: msg.id,
    threadId: msg.threadId,
    from,
    fromEmail: normalizeEmail(from),
    subject: header(msg, "Subject"),
    date: header(msg, "Date"),
    internalDate: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    snippet: msg.snippet ?? "",
  };
}

function b64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Walk a payload tree, prefer the first text/plain; else strip the first text/html. */
export function decodeBodyParts(payload: GmailPart): string {
  const plains: string[] = [];
  const htmls: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.mimeType === "text/plain" && p.body?.data) plains.push(b64urlDecode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) htmls.push(b64urlDecode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(payload);
  if (plains.length) return plains.join("\n").trim();
  if (htmls.length) return stripHtml(htmls.join("\n"));
  return "";
}

async function gFetch(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Page through all unread message ids. */
export async function listUnreadIds(token: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ q: "is:unread", maxResults: "500" });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await gFetch(token, `/messages?${q.toString()}`);
    if (!res.ok) throw new Error(`Gmail list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    (json.messages ?? []).forEach((m: { id: string }) => ids.push(m.id));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return ids;
}

/**
 * Search unread mail with an arbitrary Gmail query, returning message refs (newest first).
 * Capped at `max` results so a single lender can't pull an unbounded set.
 */
export async function searchMessageRefs(
  token: string,
  query: string,
  max = 25,
): Promise<{ id: string; threadId: string }[]> {
  const refs: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ q: query, maxResults: String(Math.min(100, max - refs.length)) });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await gFetch(token, `/messages?${q.toString()}`);
    if (!res.ok) throw new Error(`Gmail search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    for (const m of json.messages ?? []) refs.push({ id: m.id, threadId: m.threadId });
    pageToken = json.nextPageToken;
  } while (pageToken && refs.length < max);
  return refs.slice(0, max);
}

export async function getMetadata(token: string, id: string): Promise<EmailMeta> {
  const q = "format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date";
  const res = await gFetch(token, `/messages/${id}?${q}`);
  if (!res.ok) throw new Error(`Gmail meta ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseMetadata(await res.json());
}

export async function getFull(
  token: string,
  id: string,
): Promise<{ id: string; threadId: string; from: string; subject: string; date: string; internalDate: string | null; bodyText: string }> {
  const res = await gFetch(token, `/messages/${id}?format=full`);
  if (!res.ok) throw new Error(`Gmail full ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const msg: GmailMessage = await res.json();
  const meta = parseMetadata(msg);
  const bodyText = msg.payload ? decodeBodyParts(msg.payload as GmailPart) : "";
  return { id: meta.id, threadId: meta.threadId, from: meta.from, subject: meta.subject, date: meta.date, internalDate: meta.internalDate, bodyText };
}
