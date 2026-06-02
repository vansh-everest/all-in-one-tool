import { describe, it, expect } from "vitest";
import { round2, computeRow } from "../compute";

describe("round2", () => {
  it("rounds float noise", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(100.005)).toBe(100.01);
  });
});

describe("computeRow", () => {
  const ok = [{ amount: 100, readable: true }, { amount: 50, readable: true }];
  it("sums valid amounts and flags zero difference as not flagged", () => {
    const r = computeRow({ expected: 150, ocr: ok, hasLinks: true });
    expect(r.extracted).toBe(150);
    expect(r.difference).toBe(0);
    expect(r.flagged).toBe(false);
    expect(r.status).toBe("ok");
  });
  it("flags non-zero difference (strict, no tolerance)", () => {
    const r = computeRow({ expected: 150, ocr: [{ amount: 149.99, readable: true }], hasLinks: true });
    expect(r.difference).toBe(-0.01);
    expect(r.flagged).toBe(true);
  });
  it("marks needs-review when any link is unreadable", () => {
    const r = computeRow({ expected: 100, ocr: [{ amount: 100, readable: true }, { amount: null, readable: false }], hasLinks: true });
    expect(r.status).toBe("needs-review");
  });
  it("marks note-row when there are no links", () => {
    const r = computeRow({ expected: null, ocr: [], hasLinks: false });
    expect(r.status).toBe("note-row");
    expect(r.flagged).toBe(false);
  });
});
