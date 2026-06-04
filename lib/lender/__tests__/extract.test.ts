import { describe, it, expect } from "vitest";
import { parseExtraction } from "../extract";

describe("parseExtraction", () => {
  it("parses a clean object with items", () => {
    const r = parseExtraction(JSON.stringify({
      items: [{ item: "NACH revision", status: "submitted", last_update_date: "2026-05-01",
                direction: "awaiting_lender", source_message_id: "m1" }],
      last_contact_date: "2026-05-02",
    }), "m1");
    expect(r.items).toHaveLength(1);
    expect(r.items[0].direction).toBe("awaiting_lender");
    expect(r.last_contact_date).toBe("2026-05-02");
  });
  it("strips ```json fences", () => {
    const r = parseExtraction("```json\n{\"items\":[],\"last_contact_date\":null}\n```", "m1");
    expect(r.items).toEqual([]);
    expect(r.last_contact_date).toBeNull();
  });
  it("defaults missing fields and forces source_message_id + valid direction", () => {
    const r = parseExtraction(JSON.stringify({ items: [{ item: "x" }] }), "msgX");
    expect(r.items[0].status).toBe("");
    expect(r.items[0].source_message_id).toBe("msgX");
    expect(r.items[0].direction).toBe("unclear");
    expect(r.items[0].last_update_date).toBeNull();
  });
  it("returns empty extraction for unparseable output", () => {
    const r = parseExtraction("the bank says hi", "m1");
    expect(r.items).toEqual([]);
    expect(r.last_contact_date).toBeNull();
  });
});
