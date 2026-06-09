import { ZOHO_HEADERS } from "./schema";
import type { InvoiceOcr } from "./schema";

export type MappedRow = Record<string, string | number | null>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Build a 36-column row: constants ∪ OCR fields ∪ computed (Tax Amount, TDS Amount, Rate). */
export function mapInvoiceToRow(ocr: InvoiceOcr, constants: Record<string, string | number>): MappedRow {
  const taxAmount = num(ocr.cgst) + num(ocr.sgst) + num(ocr.igst) + num(ocr.cess);
  const tdsPct = typeof constants["TDS Percentage"] === "number" ? (constants["TDS Percentage"] as number) : Number(constants["TDS Percentage"] ?? 2);
  const tdsAmount = (tdsPct / 100) * num(ocr.item_total);

  const fromInvoice: MappedRow = {
    "Bill Date": ocr.bill_date,
    "Vendor Name": ocr.vendor_name,
    "Bill Number": ocr.bill_number,
    "Vendor Notes": ocr.vendor_notes,
    "Adjustment": ocr.round_off,
    "Location Name": ocr.location_name,
    "Line Item Location Name": ocr.location_name,
    "Item Total": ocr.item_total,
    "Rate": ocr.item_total,
    "GST Identification Number (GSTIN)": ocr.gstin,
    "Tax Percentage": ocr.tax_percentage,
    "HSN/SAC": ocr.hsn_sac,
    "CGST": ocr.cgst,
    "SGST": ocr.sgst,
    "IGST": ocr.igst,
    "CESS": ocr.cess,
  };
  const computed: MappedRow = {
    "Tax Amount": Number(taxAmount.toFixed(2)),
    "TDS Amount": Number(tdsAmount.toFixed(2)),
  };

  const row: MappedRow = {};
  for (const h of ZOHO_HEADERS) {
    if (h in computed) row[h] = computed[h];
    else if (h in fromInvoice) row[h] = fromInvoice[h];
    else if (h in constants) row[h] = constants[h];
    else row[h] = "";
  }
  return row;
}

const REQUIRED: (keyof InvoiceOcr)[] = ["bill_date", "vendor_name", "bill_number", "gstin", "item_total"];

export function computeFlags(ocr: InvoiceOcr, row: MappedRow): string[] {
  const flags: string[] = [];
  if ((ocr.confidence ?? 0) < 0.6) flags.push("low-confidence");
  for (const f of REQUIRED) if (ocr[f] == null) flags.push(`missing:${f}`);
  const itemTotal = num(row["Item Total"]);
  const taxAmount = num(row["Tax Amount"]);
  const adj = num(row["Adjustment"]);
  if (ocr.grand_total != null && Math.abs(itemTotal + taxAmount + adj - ocr.grand_total) > 1) flags.push("totals-mismatch");
  return flags;
}
