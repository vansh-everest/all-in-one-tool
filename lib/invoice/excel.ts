import ExcelJS from "exceljs";
import { ZOHO_HEADERS } from "./schema";
import type { MappedRow } from "./mapping";

/** Reconstructs the Zoho purchase-bill workbook: a "Bills" sheet (exact 36 headers + rows) and a
 * "DropdownData" sheet, so it imports straight into Zoho without depending on a bundled file. */
export async function buildZohoWorkbook(rows: MappedRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const bills = wb.addWorksheet("Bills");
  bills.addRow([...ZOHO_HEADERS]);
  for (const r of rows) bills.addRow(ZOHO_HEADERS.map((h) => (r[h] ?? "")));
  const dd = wb.addWorksheet("DropdownData");
  dd.addRow(["Yes"]);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
