import { describe, it, expect } from "vitest";
import { normalizeEmail, emailDomain, matchLender } from "../match";
import type { Lender } from "../types";

const lender = (over: Partial<Lender>): Lender => ({
  id: "l1", department_id: "d1", name: "Axis", aliases: [], sender_domains: [],
  known_sender_emails: [], owner: null, active: true, created_at: "", ...over,
});

describe("normalizeEmail / emailDomain", () => {
  it("extracts and lowercases the address from a display-name header", () => {
    expect(normalizeEmail("Axis Bank <Alerts@AxisBank.com>")).toBe("alerts@axisbank.com");
    expect(emailDomain("Alerts@AxisBank.com")).toBe("axisbank.com");
  });
  it("returns empty string for junk", () => {
    expect(normalizeEmail("")).toBe("");
    expect(emailDomain("not-an-email")).toBe("");
  });
});

describe("matchLender", () => {
  const lenders = [
    lender({ id: "axis", known_sender_emails: ["alerts@axisbank.com"], sender_domains: ["axisbank.com"] }),
    lender({ id: "bob", sender_domains: ["bankofbaroda.com"] }),
    lender({ id: "inactive", sender_domains: ["x.com"], active: false }),
  ];
  it("matches a known sender email exactly (highest priority)", () => {
    expect(matchLender("alerts@axisbank.com", lenders)).toBe("axis");
  });
  it("matches by sender domain suffix", () => {
    expect(matchLender("noreply@bankofbaroda.com", lenders)).toBe("bob");
  });
  it("ignores inactive lenders", () => {
    expect(matchLender("a@x.com", lenders)).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(matchLender("someone@gmail.com", lenders)).toBeNull();
  });
});
