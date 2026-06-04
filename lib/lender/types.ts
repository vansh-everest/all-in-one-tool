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
};
