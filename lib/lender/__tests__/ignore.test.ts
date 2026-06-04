import { describe, it, expect } from "vitest";
import { filterIgnored } from "../ignore";
import type { EmailMeta } from "../types";

const meta = (fromEmail: string): EmailMeta => ({
  id: fromEmail, threadId: "t", from: fromEmail, fromEmail, subject: "", date: "",
  internalDate: null, snippet: "",
});

describe("filterIgnored", () => {
  it("drops emails whose sender is on the ignore set (case-insensitive)", () => {
    const out = filterIgnored([meta("a@x.com"), meta("B@Y.com")], new Set(["b@y.com"]));
    expect(out.map((m) => m.fromEmail)).toEqual(["a@x.com"]);
  });
  it("returns all when ignore set is empty", () => {
    expect(filterIgnored([meta("a@x.com")], new Set())).toHaveLength(1);
  });
});
