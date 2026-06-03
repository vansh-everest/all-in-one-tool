import { describe, it, expect } from "vitest";
import { rowPassesFilters, parseDate, type ColumnFilter } from "../filters";

const row = ["Alice", "DONE", "1200", "11/11/2025"];

describe("rowPassesFilters", () => {
  it("passes with no filters", () => {
    expect(rowPassesFilters(row, [])).toBe(true);
  });

  it("filter by values: keep only chosen values (case-insensitive, trimmed)", () => {
    const f: ColumnFilter = { index: 1, mode: "values", values: ["done"] };
    expect(rowPassesFilters(row, [f])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 1, mode: "values", values: ["pending"] }])).toBe(false);
  });

  it("empty values list is treated as no constraint", () => {
    expect(rowPassesFilters(row, [{ index: 1, mode: "values", values: [] }])).toBe(true);
  });

  it("text condition: contains / starts_with / ends_with / not_empty", () => {
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "contains", value: "lic" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "starts_with", value: "Al" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "ends_with", value: "ce" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "not_empty" }])).toBe(true);
  });

  it("number condition: gt / lt / between", () => {
    expect(rowPassesFilters(row, [{ index: 2, mode: "condition", op: "gt", value: "1000" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 2, mode: "condition", op: "lt", value: "1000" }])).toBe(false);
    expect(rowPassesFilters(row, [{ index: 2, mode: "condition", op: "between", value: "1000", value2: "1500" }])).toBe(true);
  });

  it("date condition: before / after / between (dd/mm/yyyy + ISO)", () => {
    expect(rowPassesFilters(row, [{ index: 3, mode: "condition", op: "date_after", value: "01/11/2025" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 3, mode: "condition", op: "date_before", value: "2025-12-01" }])).toBe(true);
    expect(rowPassesFilters(row, [{ index: 3, mode: "condition", op: "date_between", value: "01/11/2025", value2: "30/11/2025" }])).toBe(true);
  });

  it("AND across columns", () => {
    const fs: ColumnFilter[] = [
      { index: 1, mode: "values", values: ["DONE"] },
      { index: 2, mode: "condition", op: "gte", value: "1200" },
    ];
    expect(rowPassesFilters(row, fs)).toBe(true);
  });

  it("ignores condition filters with a blank value (no constraint)", () => {
    expect(rowPassesFilters(row, [{ index: 0, mode: "condition", op: "contains", value: "  " }])).toBe(true);
  });

  it("treats a missing cell as empty", () => {
    expect(rowPassesFilters(["a"], [{ index: 5, mode: "condition", op: "empty" }])).toBe(true);
  });
});

describe("parseDate", () => {
  it("parses dd/mm/yyyy and ISO", () => {
    expect(parseDate("11/11/2025")).toBe(Date.UTC(2025, 10, 11));
    expect(parseDate("2025-11-11")).toBe(Date.UTC(2025, 10, 11));
  });
  it("returns null for unparseable input", () => {
    expect(parseDate("not a date")).toBeNull();
  });
});
