import { describe, it, expect } from "vitest";
import { mapInvoiceToRow, computeFlags } from "../mapping";
import { DEFAULT_CONSTANTS } from "../schema";
import type { InvoiceOcr } from "../schema";

const ocr: InvoiceOcr = {
  bill_date: "24-May-26", vendor_name: "Transigo Fleet LLP", bill_number: "May/26-27/03", gstin: "27AARFT4986F1ZF",
  hsn_sac: "996601", item_total: 209322, tax_percentage: 18, cgst: 18838.98, sgst: 18838.98, igst: 0, cess: 0,
  round_off: 0.04, location_name: "Maharashtra", place_of_supply: "Maharashtra",
  vendor_notes: "Being Services Rendered for 20 Cars during the period 01-05-2026 to 31-05-2026",
  grand_total: 247000, confidence: 0.95, notes: null,
};

describe("mapInvoiceToRow", () => {
  const row = mapInvoiceToRow(ocr, DEFAULT_CONSTANTS);
  it("fills constants", () => {
    expect(row["Accounts Payable"]).toBe("Car Rent Creditors");
    expect(row["Account Code"]).toBe("2114");
    expect(row["Tax Type"]).toBe("Tax Group");
  });
  it("fills OCR fields incl. Rate = Item Total", () => {
    expect(row["Item Total"]).toBe(209322);
    expect(row["Rate"]).toBe(209322);
    expect(row["HSN/SAC"]).toBe("996601");
    expect(row["GST Identification Number (GSTIN)"]).toBe("27AARFT4986F1ZF");
    expect(row["Adjustment"]).toBe(0.04);
  });
  it("computes Tax Amount and TDS Amount", () => {
    expect(row["Tax Amount"]).toBeCloseTo(37677.96, 2);
    expect(row["TDS Amount"]).toBeCloseTo(4186.44, 2); // 2% of 209322
  });
});

describe("computeFlags", () => {
  it("no flags on a clean, reconciling invoice", () => {
    expect(computeFlags(ocr, mapInvoiceToRow(ocr, DEFAULT_CONSTANTS))).toEqual([]);
  });
  it("flags low confidence, missing fields, and non-reconciling totals", () => {
    const bad = { ...ocr, confidence: 0.3, bill_number: null, grand_total: 999999 };
    const flags = computeFlags(bad, mapInvoiceToRow(bad, DEFAULT_CONSTANTS));
    expect(flags).toContain("low-confidence");
    expect(flags).toContain("missing:bill_number");
    expect(flags).toContain("totals-mismatch");
  });
});
