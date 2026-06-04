import { describe, it, expect } from "vitest";
import { aggregateTracker, computeCounts } from "../aggregate";
import type { Extraction, Lender } from "../types";

const lender = (id: string, name: string, owner: string | null): Lender => ({
  id, department_id: "d", name, aliases: [], sender_domains: [], known_sender_emails: [],
  owner, active: true, created_at: "",
});
const item = (s: string) => ({
  item: s, status: "open", last_update_date: null, direction: "awaiting_lender" as const,
  source_message_id: "m",
});

describe("aggregateTracker", () => {
  const lenders = [lender("axis", "Axis", "Jaisen"), lender("bob", "BoB", "Purvi")];
  const byMessage: { lenderId: string; extraction: Extraction }[] = [
    { lenderId: "axis", extraction: { items: [item("NACH"), item("Sanction")], last_contact_date: null } },
    { lenderId: "axis", extraction: { items: [item("Statement")], last_contact_date: null } },
    { lenderId: "bob", extraction: { items: [], last_contact_date: null } },
  ];
  it("groups items under each matched lender, carrying owner", () => {
    const t = aggregateTracker(lenders, byMessage);
    const axis = t.find((x) => x.lender_id === "axis")!;
    expect(axis.owner).toBe("Jaisen");
    expect(axis.items.map((i) => i.item)).toEqual(["NACH", "Sanction", "Statement"]);
  });
  it("omits lenders with zero items", () => {
    const t = aggregateTracker(lenders, byMessage);
    expect(t.find((x) => x.lender_id === "bob")).toBeUndefined();
  });
});

describe("computeCounts", () => {
  it("counts lenders-with-items, open items, matched, queued", () => {
    const lenders = [lender("axis", "Axis", null)];
    const tracker = aggregateTracker(lenders, [
      { lenderId: "axis", extraction: { items: [item("a"), item("b")], last_contact_date: null } },
    ]);
    const c = computeCounts(tracker, { unreadTotal: 100, matched: 5, queued: 12 });
    expect(c).toEqual({ unread_total: 100, matched: 5, queued: 12, lenders_with_items: 1, open_items: 2 });
  });
});
