import { describe, it, expect } from "vitest";
import { ZOHO_HEADERS, DEFAULT_CONSTANTS } from "../schema";

describe("ZOHO_HEADERS", () => {
  it("has the 36 columns in exact order", () => {
    expect(ZOHO_HEADERS).toHaveLength(36);
    expect(ZOHO_HEADERS[0]).toBe("Bill Date");
    expect(ZOHO_HEADERS[14]).toBe("Tax Amount");
    expect(ZOHO_HEADERS[15]).toBe("Item Total");
    expect(ZOHO_HEADERS[35]).toBe("LINEITEM.TAG.Hub");
  });
});

describe("DEFAULT_CONSTANTS", () => {
  it("seeds the car-rental constant values", () => {
    expect(DEFAULT_CONSTANTS["Accounts Payable"]).toBe("Car Rent Creditors");
    expect(DEFAULT_CONSTANTS["Account Code"]).toBe("2114");
    expect(DEFAULT_CONSTANTS["TDS Percentage"]).toBe(2);
    expect(DEFAULT_CONSTANTS["Tax Name"]).toBe("GST18");
    expect(DEFAULT_CONSTANTS["LINEITEM.TAG.Business Vertical"]).toBe("Fleet");
  });
});
