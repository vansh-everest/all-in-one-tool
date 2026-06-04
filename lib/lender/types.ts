export type Lender = {
  id: string;
  department_id: string;
  name: string;
  aliases: string[];
  sender_domains: string[];
  known_sender_emails: string[];
  owner: string | null;
  active: boolean;
  created_at: string;
};

export type EmailMeta = {
  id: string;
  threadId: string;
  from: string;       // raw "Name <addr@x.com>"
  fromEmail: string;  // lowercased addr@x.com
  subject: string;
  date: string;       // RFC date header
  internalDate: string | null; // ISO, from Gmail internalDate (ms epoch)
  snippet: string;
};

export type Direction = "awaiting_lender" | "action_on_us" | "unclear";

export type PendencyItem = {
  item: string;
  status: string;
  last_update_date: string | null;
  direction: Direction;
  source_message_id: string;
};

export type Extraction = {
  items: PendencyItem[];
  last_contact_date: string | null;
};

export type TrackerLender = {
  lender_id: string | null;
  lender_name: string;
  owner: string | null;
  items: PendencyItem[];
};

export type RunCounts = {
  unread_total: number;
  matched: number;
  queued: number;
  lenders_with_items: number;
  open_items: number;
  lenders_total?: number;
};

// ----- Unified Google-Sheets-style grid (imported sheet + merged email findings) -----

export type GridItemSource = "sheet" | "email" | "manual";

export type GridItem = {
  id: string | null;                // lender_items row id — every cell is editable
  text: string;
  done: boolean;
  source: GridItemSource;
  source_message_id: string | null; // present for email-found items
  email_date: string | null;        // the source email's date (ISO), for email items
};

/** One found email thread surfaced as a review card after a scan. */
export type Finding = {
  lender_id: string | null;
  lender_name: string;
  owner: string | null;
  subject: string;
  email_date: string | null;
  source_message_id: string | null;
  items: string[];
};

export type GridColumn = {
  lender_id: string | null;
  name: string;
  owner: string | null;
  items: GridItem[];
};

export type UnifiedGrid = {
  columns: GridColumn[];
  counts: { lenders_with_items: number; open_items: number; sheet_items: number; email_items: number; done: number };
  findings: Finding[];
};

// Stored on the imported run (summary.grid): the sheet's lender columns + their items in order.
export type StoredSheetColumn = { lender_id: string | null; name: string; owner: string | null; items: string[] };
