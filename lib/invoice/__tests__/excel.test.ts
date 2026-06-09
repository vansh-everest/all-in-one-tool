import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildZohoWorkbook } from "../excel";
import { ZOHO_HEADERS } from "../schema";

describe("buildZohoWorkbook", () => {
  it("produces a Bills sheet with the 36 headers + rows, and a DropdownData sheet", async () => {
    const buf = await buildZohoWorkbook([{ "Bill Date": "24-May-26", "Item Total": 209322 }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as ArrayBuffer);
    const bills = wb.getWorksheet("Bills")!;
    expect(bills).toBeTruthy();
    const header = bills.getRow(1).values as unknown[];
    expect(header[1]).toBe(ZOHO_HEADERS[0]);
    expect(header[36]).toBe(ZOHO_HEADERS[35]);
    expect((bills.getRow(2).getCell(16).value)).toBe(209322); // Item Total col
    expect(wb.getWorksheet("DropdownData")).toBeTruthy();
  });
});
