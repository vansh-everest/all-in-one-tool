import { describe, it, expect } from "vitest";
import { buildClassifyPrompt, buildExtractPrompt } from "../prompts";

describe("buildClassifyPrompt", () => {
  it("includes each active lender id+name and the email subject/snippet", () => {
    const p = buildClassifyPrompt(
      [{ id: "axis", name: "Axis Bank" }, { id: "bob", name: "Bank of Baroda" }],
      { subject: "EMI bounce", snippet: "your nach failed" },
    );
    expect(p).toContain("axis");
    expect(p).toContain("Axis Bank");
    expect(p).toContain("EMI bounce");
    expect(p).toContain("lender_id");
    expect(p).toContain("confidence");
  });
});

describe("buildExtractPrompt", () => {
  it("asks for the documented JSON shape and embeds the messages", () => {
    const p = buildExtractPrompt("Axis Bank", [{ id: "m1", date: "2026-05-01", body: "NACH to be revised" }]);
    expect(p).toContain("awaiting_lender");
    expect(p).toContain("last_contact_date");
    expect(p).toContain("NACH to be revised");
    expect(p).toContain("m1");
  });
});
