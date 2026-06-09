import { describe, it, expect } from "vitest";
import { parseInvoice } from "../ocr";

describe("parseInvoice", () => {
  it("parses clean JSON and coerces numbers", () => {
    const r = parseInvoice(JSON.stringify({
      bill_date: "24-May-26", vendor_name: "Transigo Fleet LLP", bill_number: "May/26-27/03",
      gstin: "27AARFT4986F1ZF", hsn_sac: "996601", item_total: "2,09,322.00", tax_percentage: 18,
      cgst: 18838.98, sgst: 18838.98, igst: 0, cess: 0, round_off: 0.04,
      location_name: "Maharashtra", place_of_supply: "Maharashtra",
      vendor_notes: "Being Services Rendered for 20 Cars during the period 01-05-2026 to 31-05-2026",
      grand_total: 247000, confidence: 0.95, notes: null,
    }), "m1", "a1");
    expect(r.item_total).toBe(209322);
    expect(r.cgst).toBe(18838.98);
    expect(r.vendor_name).toBe("Transigo Fleet LLP");
    expect(r.confidence).toBe(0.95);
  });
  it("strips ```json fences and defaults missing to null", () => {
    const r = parseInvoice("```json\n{\"vendor_name\":\"X\"}\n```", "m1", "a1");
    expect(r.vendor_name).toBe("X");
    expect(r.item_total).toBeNull();
    expect(r.cgst).toBeNull();
  });
  it("returns all-null with a note on garbage", () => {
    const r = parseInvoice("not json", "m1", "a1");
    expect(r.vendor_name).toBeNull();
    expect(r.notes).toMatch(/unparseable/i);
  });
});
