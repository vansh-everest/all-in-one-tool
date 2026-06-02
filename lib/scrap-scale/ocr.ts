import { OCR_PROMPT } from "./prompt";

export type OcrResult = {
  amount: number | null;
  currency: string;
  txn_id: string | null;
  date: string | null;
  confidence: number;
  notes: string;
};

function parseJsonLoose(text: string): OcrResult {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
  const obj = JSON.parse(slice);
  return {
    amount: typeof obj.amount === "number" ? obj.amount : obj.amount == null ? null : Number(obj.amount) || null,
    currency: typeof obj.currency === "string" ? obj.currency : "INR",
    txn_id: obj.txn_id ?? null,
    date: obj.date ?? null,
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    notes: typeof obj.notes === "string" ? obj.notes : "",
  };
}

/** Calls Gemini with an inline image. Throws on HTTP error (status attached for backoff). */
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
  try {
    return parseJsonLoose(text);
  } catch {
    return {
      amount: null,
      currency: "INR",
      txn_id: null,
      date: null,
      confidence: 0,
      notes: `unparseable model output: ${text.slice(0, 120)}`,
    };
  }
}
