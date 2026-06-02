import { OCR_PROMPT } from "./prompt";

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
 * Throws on HTTP error (status attached for backoff/retry).
 */
export async function geminiExtract(base64: string, mimeType: string): Promise<OcrResult> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: OCR_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini ${res.status}: ${await res.text()}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return parseOcr(text);
}
