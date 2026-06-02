import { describe, it, expect } from "vitest";
import { markDuplicates } from "../duplicates";

describe("markDuplicates", () => {
  it("flags rows sharing a normalized txn_id", () => {
    const rows = [
      { row_index: 1, txnIds: ["TXN 123"] },
      { row_index: 2, txnIds: ["txn123"] },
      { row_index: 3, txnIds: ["OTHER"] },
    ];
    const dups = markDuplicates(rows);
    expect(dups.get(1)).toBe(true);
    expect(dups.get(2)).toBe(true);
    expect(dups.get(3)).toBe(false);
  });
  it("ignores null/empty txn ids", () => {
    const rows = [
      { row_index: 1, txnIds: [] },
      { row_index: 2, txnIds: [] },
    ];
    const dups = markDuplicates(rows);
    expect(dups.get(1)).toBe(false);
    expect(dups.get(2)).toBe(false);
  });
});
