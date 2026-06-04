import { parseGeminiKeys, isRateLimitStatus, nextStartIndex } from "@/lib/scrap-scale/gemini-keys";

/** Rotate the key pool so attempts start at `start` then continue round-robin. */
export function pickKeyOrder(keys: string[], start: number): string[] {
  return keys.map((_, i) => keys[(start + i) % keys.length]);
}

/**
 * Send a text-only prompt to Gemini and return the model's text. Rotates across all
 * configured keys on 429 (one attempt per key per call); throws a 429-tagged error if
 * every key is rate-limited so the caller's withRetry/backoff can wait and retry.
 */
export async function geminiJson(prompt: string): Promise<string> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const keys = parseGeminiKeys();
  const order = pickKeyOrder(keys, nextStartIndex(keys.length));
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });

  let lastRateLimit: Error | null = null;
  for (const key of order) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const json = await res.json();
      const text: string =
        json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      return text;
    }
    const text = await res.text();
    if (isRateLimitStatus(res.status)) {
      lastRateLimit = Object.assign(new Error(`Gemini 429: ${text}`), { status: 429 });
      continue;
    }
    throw Object.assign(new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  }
  throw lastRateLimit ?? Object.assign(new Error("Gemini: all keys exhausted"), { status: 429 });
}
