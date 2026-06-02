import { describe, it, expect } from "vitest";
import { normalizeHeader, detectColumns } from "../columns";

describe("normalizeHeader", () => {
  it("strips case, spaces, punctuation", () => {
    expect(normalizeHeader("Upload Transaction Details ")).toBe("uploadtransactiondetails");
    expect(normalizeHeader("Total_Fund (Collection)")).toBe("totalfundcollection");
  });
});

describe("detectColumns", () => {
  const headers = ["Timestamp", "Name", "Upload Transaction Details", "Total Fund Collection", "Upload Transaction Details"];
  const sample = [
    ["2025-11-01", "Asha", "https://drive.google.com/open?id=A1", "150", ""],
    ["2025-11-02", "Ravi", "https://drive.google.com/file/d/B2/view", "200", "note"],
  ];
  it("detects expected + name + the link column that actually has drive links", () => {
    const d = detectColumns(headers, sample);
    expect(d.expected?.index).toBe(3);
    expect(d.name?.index).toBe(1);
    expect(d.link?.index).toBe(2);
    expect(d.ambiguous).toBe(false);
  });
  it("flags ambiguous when two header-matching columns both contain links", () => {
    const sample2 = [["t", "n", "https://drive.google.com/open?id=A1", "150", "https://drive.google.com/open?id=Z9"]];
    const d = detectColumns(headers, sample2);
    expect(d.ambiguous).toBe(true);
    expect(d.linkCandidates).toEqual([2, 4]);
  });
});
