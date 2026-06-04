import { describe, it, expect } from "vitest";
import { parseClassification } from "../classify";

describe("parseClassification", () => {
  it("returns lenderId when confidence >= threshold", () => {
    const r = parseClassification(JSON.stringify({ lender_id: "axis", confidence: 0.9 }), 0.7);
    expect(r).toEqual({ lenderId: "axis", confidence: 0.9 });
  });
  it("nulls the lenderId when below threshold", () => {
    const r = parseClassification(JSON.stringify({ lender_id: "axis", confidence: 0.4 }), 0.7);
    expect(r).toEqual({ lenderId: null, confidence: 0.4 });
  });
  it("treats explicit none / missing id as no match", () => {
    expect(parseClassification(JSON.stringify({ lender_id: "none", confidence: 0.99 }), 0.7).lenderId).toBeNull();
    expect(parseClassification(JSON.stringify({ confidence: 0.99 }), 0.7).lenderId).toBeNull();
  });
  it("returns confidence 0 / null on garbage", () => {
    expect(parseClassification("nonsense", 0.7)).toEqual({ lenderId: null, confidence: 0 });
  });
});
