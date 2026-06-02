import { describe, it, expect } from "vitest";
import { mapWithConcurrency, backoffDelays } from "../queue";

describe("mapWithConcurrency", () => {
  it("processes all items and preserves order", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });
  it("never exceeds the concurrency limit", async () => {
    let active = 0, maxActive = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return null;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

describe("backoffDelays", () => {
  it("produces exponential delays", () => {
    expect(backoffDelays(3, 100)).toEqual([100, 200, 400]);
  });
});
