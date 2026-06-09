import { describe, it, expect } from "vitest";
import { buildInvoiceQuery, gmailDate } from "../gmailQuery";

describe("buildInvoiceQuery", () => {
  it("scopes to the label and since-date (Gmail after: yyyy/mm/dd, inclusive of that day)", () => {
    expect(buildInvoiceQuery("Invoices", "2026-06-09")).toBe('label:"Invoices" after:2026/06/08');
  });
  it("omits after: when no date", () => {
    expect(buildInvoiceQuery("Invoices", null)).toBe('label:"Invoices"');
  });
});

describe("gmailDate", () => {
  it("formats ISO date to yyyy/mm/dd", () => {
    expect(gmailDate("2026-06-09")).toBe("2026/06/09");
  });
});
