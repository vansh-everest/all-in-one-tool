/** Runs `fn` over items with a bounded number of concurrent executions, preserving input order in the output. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, worker));
  return results;
}

export function backoffDelays(retries: number, baseMs: number): number[] {
  return Array.from({ length: retries }, (_, i) => baseMs * 2 ** i);
}

/** Calls `fn`; on a thrown error that looks like 429/quota, retries with exponential backoff. */
export async function withRetry<R>(fn: () => Promise<R>, retries = 4, baseMs = 1000): Promise<R> {
  const delays = backoffDelays(retries, baseMs);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const is429 = /\b429\b|quota|rate/i.test(msg);
      if (!is429 || attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}
