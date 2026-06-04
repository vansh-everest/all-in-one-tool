type Env = Record<string, string | undefined>;

/**
 * Build the Gemini API key pool. Supports a comma-separated GEMINI_API_KEYS and
 * the numbered fallbacks GEMINI_API_KEY / _2 / _3. Dedupes, preserves order.
 */
export function parseGeminiKeys(env: Env = process.env): string[] {
  const out: string[] = [];
  const push = (v?: string) =>
    v && v.split(",").forEach((k) => {
      const t = k.trim();
      if (t && !out.includes(t)) out.push(t);
    });
  push(env.GEMINI_API_KEYS);
  push(env.GEMINI_API_KEY);
  push(env.GEMINI_API_KEY_2);
  push(env.GEMINI_API_KEY_3);
  push(env.GEMINI_API_KEY_4);
  push(env.GEMINI_API_KEY_5);
  if (out.length === 0) {
    throw new Error("No Gemini API key configured (set GEMINI_API_KEY or GEMINI_API_KEYS).");
  }
  return out;
}

export function isRateLimitStatus(status: number): boolean {
  return status === 429;
}

let cursor = 0;
/** Round-robin starting offset so concurrent calls spread across keys. */
export function nextStartIndex(poolSize: number): number {
  const i = cursor % poolSize;
  cursor = (cursor + 1) % poolSize;
  return i;
}
