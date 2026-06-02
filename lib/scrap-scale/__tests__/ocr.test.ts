import { describe, it, expect } from "vitest";
import { parseOcr, sumAmount } from "../ocr";

describe("parseOcr", () => {
  it("parses the multi-payment array shape", () => {
    const r = parseOcr(
      JSON.stringify({
        payments: [
          { amount: 1200, currency: "INR", txn_id: "T1", date: "2026-01-01" },
          { amount: 800, currency: "INR", txn_id: "T2", date: null },
        ],
        confidence: 0.9,
        notes: "",
      }),
    );
    expect(r.readable).toBe(true);
    expect(r.payments).toHaveLength(2);
    expect(sumAmount(r.payments)).toBe(2000);
    expect(r.payments.map((p) => p.txn_id)).toEqual(["T1", "T2"]);
  });

  it("strips markdown fences and currency formatting", () => {
    const r = parseOcr('```json\n{"payments":[{"amount":"1,250.50","txn_id":"X"}]}\n```');
    expect(sumAmount(r.payments)).toBe(1250.5);
    expect(r.payments[0].txn_id).toBe("X");
  });

  it("falls back to the legacy single-object shape", () => {
    const r = parseOcr(JSON.stringify({ amount: 500, txn_id: "OLD", currency: "INR" }));
    expect(r.payments).toHaveLength(1);
    expect(sumAmount(r.payments)).toBe(500);
  });

  it("returns no payments (readable) when the model reports none", () => {
    const r = parseOcr(JSON.stringify({ payments: [], confidence: 0, notes: "blurry" }));
    expect(r.readable).toBe(true);
    expect(r.payments).toHaveLength(0);
    expect(sumAmount(r.payments)).toBe(0);
    expect(r.notes).toBe("blurry");
  });

  it("drops entries without a usable numeric amount", () => {
    const r = parseOcr(JSON.stringify({ payments: [{ amount: null }, { amount: "abc" }, { amount: 99 }] }));
    expect(r.payments).toHaveLength(1);
    expect(sumAmount(r.payments)).toBe(99);
  });

  it("marks unparseable output as unreadable", () => {
    const r = parseOcr("the model said something that is not json");
    expect(r.readable).toBe(false);
    expect(r.payments).toHaveLength(0);
  });
});
