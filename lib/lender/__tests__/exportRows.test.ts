import { describe, it, expect } from "vitest";
import { EXPORT_HEADERS, trackerToRows, rowsToCsv } from "../exportRows";
import type { TrackerLender } from "../types";

const tracker: TrackerLender[] = [
  {
    lender_id: "axis", lender_name: "Axis", owner: "Jaisen",
    items: [{ item: "NACH revision", status: "submitted", last_update_date: "2026-05-01",
              direction: "awaiting_lender", source_message_id: "m1" }],
  },
];

describe("trackerToRows", () => {
  it("emits one row per item with lender + owner columns", () => {
    const rows = trackerToRows(tracker);
    expect(rows[0]).toEqual(["Axis", "Jaisen", "NACH revision", "submitted", "2026-05-01", "awaiting_lender", "m1"]);
  });
});

describe("rowsToCsv", () => {
  it("prepends headers and quotes fields with commas", () => {
    const csv = rowsToCsv(EXPORT_HEADERS, [["a,b", "c"]]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(EXPORT_HEADERS.join(","));
    expect(lines[1]).toBe('"a,b",c');
  });
});
