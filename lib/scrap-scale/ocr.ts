import { OCR_PROMPT } from "./prompt";
import { parseGeminiKeys, isRateLimitStatus, nextStartIndex } from "./gemini-keys";

export type Payment = {
  amount: number;
  currency: string;
  txn_id: string | null;
  date: string | null;
};

export type OcrResult = {
  payments: Payment[];
  /** true when the model returned valid JSON we understood (even if 0 payments). */
  readable: boolean;
  confidence: number;
  notes: string;
  raw: string;
};

function toAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const stripped = v.replace(/[^0-9.\-]/g, "");
    if (stripped === "") return null;
    const n = Number(stripped);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coercePayment(raw: unknown): Payment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const amount = toAmount(o.amount);
  if (amount === null) return null;
  return {
    amount,
    currency: typeof o.currency === "string" ? o.currency : "INR",
    txn_id: o.txn_id == null ? null : String(o.txn_id),
    date: o.date == null ? null : String(o.date),
  };
}

/**
 * Parse Gemini's JSON output. Accepts the multi-payment array shape
 * ({"payments":[...]}) and falls back to the legacy single-object shape
 * ({"amount":...}) so cached rows and older prompts still work.
 */
export function parseOcr(text: string): OcrResult {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(slice) as Record<string, unknown>;
  } catch {
    return { payments: [], readable: false, confidence: 0, notes: `unparseable model output: ${text.slice(0, 160)}`, raw: text };
  }

  let payments: Payment[];
  if (Array.isArray(obj.payments)) {
    payments = obj.payments.map(coercePayment).filter((p): p is Payment => p !== null);
  } else if ("amount" in obj) {
    const single = coercePayment(obj);
    payments = single ? [single] : [];
  } else {
    payments = [];
  }

  return {
    payments,
    readable: true,
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    notes: typeof obj.notes === "string" ? obj.notes : "",
    raw: text,
  };
}

export function sumAmount(payments: Payment[]): number {
  return payments.reduce((s, p) => s + p.amount, 0);
}

/**
 * Sends a file (image or PDF) to Gemini inline and returns extracted payments.
 * Rotates across the configured key pool: a 429 on one key immediately fails
 * over to the next. If every key is rate-limited, throws a 429 so the caller's
 * backoff/retry waits and retries the cycle. Non-429 HTTP errors throw at once.
 */
export async function geminiExtract(base64: string, mimeType: string): Promise<OcrResult> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const keys = parseGeminiKeys();
  const start = nextStartIndex(keys.length);
  const body = JSON.stringify({
    contents: [{ parts: [{ text: OCR_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });

  let lastRateLimit: Error | null = null;
  for (let n = 0; n < keys.length; n++) {
    const key = keys[(start + n) % keys.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const data = await res.json();
      return parseOcr(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    }
    const text = await res.text();
    if (isRateLimitStatus(res.status)) {
      lastRateLimit = Object.assign(new Error(`Gemini 429: ${text}`), { status: 429 });
      continue; // try the next key
    }
    throw Object.assign(new Error(`Gemini ${res.status}: ${text}`), { status: res.status });
  }
  throw lastRateLimit ?? Object.assign(new Error("Gemini: all keys exhausted"), { status: 429 });
}
