import { describe, it, expect } from "vitest";
import { rowPassesFilters, type ColumnFilter } from "../filters";

const row = ["Alice", "DONE", "  ₹1,200 ", ""];

describe("rowPassesFilters", () => {
  it("passes when there are no filters", () => {
    expect(rowPassesFilters(row, [])).toBe(true);
  });

  it("matches 'equals' case-insensitively and trims", () => {
    const f: ColumnFilter = { index: 1, op: "equals", value: " done " };
    expect(rowPassesFilters(row, [f])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 1, op: "equals", value: "pending" }])).toBe(false);
  });

  it("matches 'contains' as a case-insensitive substring", () => {
    expect(rowPassesFilters(row, [{ index: 0, op: "contains", value: "lic" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 0, op: "contains", value: "bob" }])).toBe(false);
  });

  it("handles empty / not_empty regardless of value", () => {
    expect(rowPassesFilters(row, [{ index: 3, op: "empty" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 3, op: "not_empty" }])).toBe(false);
    expect(rowPassesFilters(row, [{ index: 0, op: "not_empty" }])).toBe(true);
  });

  it("requires ALL filters to pass (AND)", () => {
    const filters: ColumnFilter[] = [
      { index: 0, op: "contains", value: "ali" },
      { index: 1, op: "equals", value: "done" },
    ];
    expect(rowPassesFilters(row, filters)).toBe(true);
    expect(rowPassesFilters(row, [...filters, { index: 0, op: "equals", value: "bob" }])).toBe(false);
  });

  it("ignores contains/equals filters whose value is blank (treated as no filter)", () => {
    expect(rowPassesFilters(row, [{ index: 0, op: "contains", value: "  " }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 0, op: "equals", value: "" }])).toBe(true);
  });

  it("treats a missing cell as empty", () => {
    expect(rowPassesFilters(["a"], [{ index: 5, op: "empty" }])).toBe(true);
    expect(rowPassesFilters(["a"], [{ index: 5, op: "contains", value: "x" }])).toBe(false);
  });
});
