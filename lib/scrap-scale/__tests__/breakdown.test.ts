import { describe, it, expect } from "vitest";
import { breakdownString, type SsDetail } from "../breakdown";

const details: SsDetail[] = [
  { name: "gpay1.jpg", amount: 6708, readable: true },
  { name: "gpay2.jpg", amount: 3000, readable: true },
  { name: "blurry.jpg", amount: null, readable: false },
];

describe("breakdownString", () => {
  it("lists SS1..SSn with amounts and a total", () => {
    expect(breakdownString(details)).toBe("SS1: 6708; SS2: 3000; SS3: unreadable | Total: 9708");
  });
  it("returns empty string when there are no screenshots", () => {
    expect(breakdownString([])).toBe("");
  });
});
