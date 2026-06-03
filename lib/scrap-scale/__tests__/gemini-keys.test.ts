import { describe, it, expect } from "vitest";
import { parseGeminiKeys, isRateLimitStatus } from "../gemini-keys";

describe("parseGeminiKeys", () => {
  it("reads comma-separated GEMINI_API_KEYS", () => {
    expect(parseGeminiKeys({ GEMINI_API_KEYS: "a, b ,c" })).toEqual(["a", "b", "c"]);
  });
  it("reads numbered fallbacks and dedupes, preserving order", () => {
    expect(parseGeminiKeys({ GEMINI_API_KEY: "a", GEMINI_API_KEY_2: "b", GEMINI_API_KEY_3: "a" })).toEqual(["a", "b"]);
  });
  it("throws when no keys are present", () => {
    expect(() => parseGeminiKeys({})).toThrow();
  });
});

describe("isRateLimitStatus", () => {
  it("treats 429 as rate-limited", () => {
    expect(isRateLimitStatus(429)).toBe(true);
    expect(isRateLimitStatus(400)).toBe(false);
    expect(isRateLimitStatus(500)).toBe(false);
  });
});
