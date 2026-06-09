// Shared client types for the Invoice → Zoho tool UI.

export type InvoiceConfigT = {
  department_id: string;
  gmail_label: string | null;
  profile_id: string | null;
  last_run_date: string | null;
  updated_at?: string;
};

export type InvoiceProfile = {
  id: string;
  department_id: string;
  name: string;
  constants: Record<string, string | number>;
  active: boolean;
  created_at?: string;
};

export type InvoiceCounts = {
  messages?: number;
  invoices?: number;
  rows?: number;
  flagged?: number;
  duplicates?: number;
};

export type InvoiceRunSummary = {
  id: string;
  created_at: string;
  created_by_email: string | null;
  status: string;
  counts: InvoiceCounts | null;
};

export type InvoiceRow = {
  id: string;
  run_id: string;
  source_message_id: string | null;
  attachment_id: string | null;
  file_name: string | null;
  mime_type: string | null;
  ocr: Record<string, unknown> | null;
  mapped: Record<string, string | number | null> | null;
  flags: string[] | null;
  confidence: number | null;
  grand_total: number | null;
  reconciled: boolean;
  created_at: string;
};
