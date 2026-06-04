import { describe, it, expect } from "vitest";
import { parsePendencyMatrix, normalizeLenderName } from "../importSheet";

describe("normalizeLenderName", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(normalizeLenderName("CSB bank Limited")).toBe(normalizeLenderName("CSB Bank Limited"));
    expect(normalizeLenderName("Cosmos Co-operative Bank Ltd.")).toBe(normalizeLenderName("Cosmos Co-operative Bank Ltd"));
  });
});

describe("parsePendencyMatrix", () => {
  const rows = [
    ["", "Everest Fleet Private Limited"],
    [],
    ["", "", "Jaisen", "Purvi", "Vinit"],
    ["", "Sr. No.", "Aditya Birla Capital Ltd", "Axis Bank", "Non Lender"],
    ["", "1", "Covenant certificate - 30-04-26", "FD break", "Reply to Bhoomi"],
    ["", "2", "", "Duplicate FD", "Car split"],
  ];

  it("reads lender names from the Sr. No. header row, skipping Non Lender", () => {
    const { lenders } = parsePendencyMatrix(rows);
    expect(lenders.map((l) => l.name)).toEqual(["Aditya Birla Capital Ltd", "Axis Bank"]);
  });

  it("reads each lender's owner from the row above the header", () => {
    const { lenders } = parsePendencyMatrix(rows);
    expect(lenders).toEqual([
      { name: "Aditya Birla Capital Ltd", owner: "Jaisen" },
      { name: "Axis Bank", owner: "Purvi" },
    ]);
  });

  it("emits one item per non-empty lender cell, ignoring blanks and Non Lender columns", () => {
    const { items } = parsePendencyMatrix(rows);
    expect(items).toEqual([
      { lenderName: "Aditya Birla Capital Ltd", item: "Covenant certificate - 30-04-26" },
      { lenderName: "Axis Bank", item: "FD break" },
      { lenderName: "Axis Bank", item: "Duplicate FD" },
    ]);
  });

  it("returns empty when there is no Sr. No. header row", () => {
    expect(parsePendencyMatrix([["a", "b"], ["c", "d"]])).toEqual({ lenders: [], items: [] });
  });
});
