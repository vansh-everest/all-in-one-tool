export const ZOHO_HEADERS = [
  "Bill Date", "Transaction Posting Date", "Accounts Payable", "Vendor Name", "Bill Number", "Vendor Notes",
  "Adjustment", "Adjustment Description", "Adjustment Account", "Location Name", "Bill Status", "Account",
  "Account Code", "Description", "Tax Amount", "Item Total", "GST Treatment", "GST Identification Number (GSTIN)",
  "TDS Name", "TDS Percentage", "TDS Section Code", "TDS Section", "TDS Amount", "Line Item Location Name",
  "Rate", "HSN/SAC", "Tax Name", "Tax Percentage", "Tax Type", "Item Type", "CGST", "SGST", "IGST", "CESS",
  "LINEITEM.TAG.Business Vertical", "LINEITEM.TAG.Hub",
] as const;

export type ZohoHeader = (typeof ZOHO_HEADERS)[number];

// Seeded constants for the "Car Rental" profile (editable in the tool).
export const DEFAULT_CONSTANTS: Record<string, string | number> = {
  "Accounts Payable": "Car Rent Creditors",
  "Adjustment Description": "Adjustment",
  "Adjustment Account": "Other Expenses",
  "Bill Status": "Overdue",
  "Account": "Car rent @ 18%",
  "Account Code": "2114",
  "Description": "Car rental Services",
  "GST Treatment": "business_gst",
  "TDS Name": "TDS on Rent of plant & Machinery (1008)",
  "TDS Percentage": 2,
  "TDS Section Code": "rent_plant_machinery",
  "TDS Section": "Section 393(1) Sl2(ii)D(a)",
  "Tax Name": "GST18",
  "Tax Type": "Tax Group",
  "Item Type": "service",
  "LINEITEM.TAG.Business Vertical": "Fleet",
  "Transaction Posting Date": "",
  "LINEITEM.TAG.Hub": "",
};

export type InvoiceOcr = {
  bill_date: string | null;
  vendor_name: string | null;
  bill_number: string | null;
  gstin: string | null;
  hsn_sac: string | null;
  item_total: number | null;
  tax_percentage: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  cess: number | null;
  round_off: number | null;
  location_name: string | null;
  place_of_supply: string | null;
  vendor_notes: string | null;
  grand_total: number | null;
  confidence: number | null;
  notes: string | null;
};
