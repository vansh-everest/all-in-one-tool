import { describe, it, expect } from "vitest";
import { buildLenderQuery } from "../searchQuery";
import type { Lender } from "../types";

const lender = (over: Partial<Lender>): Lender => ({
  id: "l", department_id: "d", name: "Axis Bank Limited (Commercial)", aliases: [],
  sender_domains: [], known_sender_emails: [], owner: null, active: true, created_at: "", ...over,
});

describe("buildLenderQuery", () => {
  it("restricts to unread and ORs domains, known senders, and subject name/aliases", () => {
    const q = buildLenderQuery(lender({
      sender_domains: ["axisbank.com"],
      known_sender_emails: ["alerts@axisbank.com"],
      aliases: ["Axis"],
    }));
    expect(q).toBe('is:unread (from:axisbank.com OR from:alerts@axisbank.com OR subject:"Axis Bank Limited" OR subject:"Axis")');
  });

  it("strips parenthetical qualifiers from the subject phrase", () => {
    const q = buildLenderQuery(lender({ name: "IndusInd Bank Ltd (R)" }));
    expect(q).toBe('is:unread (subject:"IndusInd Bank Ltd")');
  });

  it("works with just a bank name (subject match)", () => {
    expect(buildLenderQuery(lender({ name: "HSBC" }))).toBe('is:unread (subject:"HSBC")');
  });

  it("returns null when there is nothing searchable", () => {
    expect(buildLenderQuery(lender({ name: "AB" }))).toBeNull();
  });
});
