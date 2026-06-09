# Invoice → Zoho Purchase-Bill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Finance tool that pulls invoice emails from a Gmail label, OCRs each invoice, maps into the exact 36-column Zoho purchase-bill schema, renders a spreadsheet grid, and exports a Zoho-ready Excel — deduping processed message+attachment pairs so each daily run only picks up new mail.

**Architecture:** Pure modules (`lib/invoice/*`) TDD-tested; a chunked/resumable run pipeline (mirrors the Lender tool's process-chunk: rate-limit pause-and-resume, per-message cursor); reuses Gemini inline OCR (`lib/scrap-scale/ocr.ts` pattern) + key rotation, and the Gmail readonly client (extended with attachment download + label/date search). Supabase service-role; RLS on, no policies.

**Tech Stack:** Next.js 16, TS, Supabase, Gmail REST, Gemini 2.5 Flash (inline base64), ExcelJS, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-invoice-zoho-purchase-bill-design.md` (read it for the full schema + mapping).

---

## Reference patterns
- Gemini inline OCR + key rotation: `lib/scrap-scale/ocr.ts` (`geminiExtract(base64, mimeType)`).
- Key pool: `lib/scrap-scale/gemini-keys.ts`.
- Concurrency/backoff: `lib/scrap-scale/queue.ts` (`mapWithConcurrency`, `withRetry`).
- Chunked run + rate-limit pause + resume: `app/api/tools/lender-followup/run/[runId]/process-chunk/route.ts` and `components/lender/LenderFollowupApp.tsx` (processLoop).
- Gmail client: `lib/google/gmail.ts` (`searchMessageRefs`, `getFull`).
- Access guard: `lib/lender/access.ts` (`requireFinance`, `requireFinanceAdmin`) — reuse directly.
- Migration applier: `supabase/apply-0008.mjs` (copy for 0009).
- Run history + admin delete + per-run detail: `components/lender/LenderRunHistory.tsx`.

---

## Task 1: Migration 0009 + applier

**Files:** Create `supabase/migrations/0009_invoice_zoho.sql`, `supabase/apply-0009.mjs`

- [ ] **Step 1: Write the migration (idempotent)**

```sql
-- 0009_invoice_zoho.sql — Invoice → Zoho purchase-bill tool (Finance). Idempotent.

create table if not exists public.invoice_mapping_profiles (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name          text not null,
  constants     jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.invoice_config (
  department_id uuid primary key references public.departments(id) on delete cascade,
  gmail_label   text,
  profile_id    uuid references public.invoice_mapping_profiles(id) on delete set null,
  last_run_date date,
  updated_at    timestamptz not null default now()
);

create table if not exists public.invoice_runs (
  id                 uuid primary key default gen_random_uuid(),
  department_id      uuid not null references public.departments(id) on delete cascade,
  created_by_email   text,
  status             text not null default 'running',
  label              text,
  since_date         date,
  worklist           jsonb not null default '[]'::jsonb,
  cursor             int not null default 0,
  counts             jsonb not null default '{}'::jsonb,
  summary            jsonb,
  activities         jsonb not null default '[]'::jsonb,
  last_internal_date timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists public.invoice_processed (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  message_id    text not null,
  attachment_id text not null default '',
  run_id        uuid,
  processed_at  timestamptz not null default now(),
  unique (department_id, message_id, attachment_id)
);

create table if not exists public.invoice_rows (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.invoice_runs(id) on delete cascade,
  department_id     uuid not null references public.departments(id) on delete cascade,
  source_message_id text,
  attachment_id     text,
  file_name         text,
  mime_type         text,
  ocr               jsonb,
  mapped            jsonb,
  flags             text[] not null default '{}',
  confidence        numeric,
  grand_total       numeric,
  reconciled        boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists invoice_rows_run_idx on public.invoice_rows(run_id);

alter table public.invoice_mapping_profiles enable row level security;
alter table public.invoice_config           enable row level security;
alter table public.invoice_runs             enable row level security;
alter table public.invoice_processed        enable row level security;
alter table public.invoice_rows             enable row level security;
```

- [ ] **Step 2: Write `supabase/apply-0009.mjs`** (copy `apply-0008.mjs`, change filename to `0009_invoice_zoho.sql` and log `"0009 applied."`).
- [ ] **Step 3:** Controller runs `node --env-file=.env.local supabase/apply-0009.mjs`.
- [ ] **Step 4: Commit** `feat(invoice): migration 0009 — invoice→zoho tables`.

---

## Task 2: Schema + constants (`lib/invoice/schema.ts`)

**Files:** Create `lib/invoice/schema.ts`, Test `lib/invoice/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run** `npx vitest run lib/invoice/__tests__/schema.test.ts` → FAIL.
- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run test → PASS. Step 5: Commit** `feat(invoice): 36-column schema + seed constants + OCR type`.

---

## Task 3: OCR parse (`lib/invoice/ocr.ts`)

**Files:** Create `lib/invoice/ocr.ts`, Test `lib/invoice/__tests__/ocr.test.ts`

The HTTP call (`geminiExtractInvoice`) mirrors `lib/scrap-scale/ocr.ts` `geminiExtract` (key rotation, inline base64) but uses `INVOICE_PROMPT` and returns `parseInvoice(text)`. Only `parseInvoice` is unit-tested.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseInvoice } from "../ocr";

describe("parseInvoice", () => {
  it("parses clean JSON and coerces numbers", () => {
    const r = parseInvoice(JSON.stringify({
      bill_date: "24-May-26", vendor_name: "Transigo Fleet LLP", bill_number: "May/26-27/03",
      gstin: "27AARFT4986F1ZF", hsn_sac: "996601", item_total: "2,09,322.00", tax_percentage: 18,
      cgst: 18838.98, sgst: 18838.98, igst: 0, cess: 0, round_off: 0.04,
      location_name: "Maharashtra", place_of_supply: "Maharashtra",
      vendor_notes: "Being Services Rendered for 20 Cars during the period 01-05-2026 to 31-05-2026",
      grand_total: 247000, confidence: 0.95, notes: null,
    }), "m1", "a1");
    expect(r.item_total).toBe(209322);
    expect(r.cgst).toBe(18838.98);
    expect(r.vendor_name).toBe("Transigo Fleet LLP");
    expect(r.confidence).toBe(0.95);
  });
  it("strips ```json fences and defaults missing to null", () => {
    const r = parseInvoice("```json\n{\"vendor_name\":\"X\"}\n```", "m1", "a1");
    expect(r.vendor_name).toBe("X");
    expect(r.item_total).toBeNull();
    expect(r.cgst).toBeNull();
  });
  it("returns all-null with a note on garbage", () => {
    const r = parseInvoice("not json", "m1", "a1");
    expect(r.vendor_name).toBeNull();
    expect(r.notes).toMatch(/unparseable/i);
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
import { parseGeminiKeys, isRateLimitStatus, nextStartIndex } from "@/lib/scrap-scale/gemini-keys";
import type { InvoiceOcr } from "./schema";

export const INVOICE_PROMPT = [
  "You are reading a vendor TAX INVOICE (PDF or image) for car-rental services. Extract ONLY these fields as JSON.",
  "Numbers must be plain numbers (no commas/₹). Use null + say why in notes if a field is unreadable.",
  "Fields:",
  "  bill_date (invoice date, e.g. 24-May-26), vendor_name (the seller/supplier, NOT the buyer 'Everest Fleet'),",
  "  bill_number (Invoice No.), gstin (the VENDOR's GSTIN/UIN), hsn_sac, item_total (the TAXABLE value, not the grand total),",
  "  tax_percentage (total GST %, e.g. 18), cgst, sgst, igst, cess (amounts; 0 if absent), round_off (ROUND OFF / adjustment, can be negative),",
  "  location_name (vendor's state, e.g. Maharashtra), place_of_supply, vendor_notes (the 'Being Services Rendered for N Cars during the period dd-mm-yyyy to dd-mm-yyyy' line, verbatim),",
  "  grand_total (final payable incl. tax), confidence (0..1), notes.",
  "Respond with a single JSON object, nothing else.",
].join("\n");

function stripFences(t: string) { return (t ?? "").replace(/```(?:json)?/gi, "").trim(); }
function firstJson(t: string) { const a = t.indexOf("{"), b = t.lastIndexOf("}"); return a >= 0 && b > a ? t.slice(a, b + 1) : null; }
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function toStr(v: unknown): string | null { return v == null || v === "" ? null : String(v); }

const NULL_OCR = (notes: string): InvoiceOcr => ({
  bill_date: null, vendor_name: null, bill_number: null, gstin: null, hsn_sac: null, item_total: null,
  tax_percentage: null, cgst: null, sgst: null, igst: null, cess: null, round_off: null, location_name: null,
  place_of_supply: null, vendor_notes: null, grand_total: null, confidence: 0, notes,
});

export function parseInvoice(text: string, _messageId: string, _attachmentId: string): InvoiceOcr {
  const cand = firstJson(stripFences(text));
  if (!cand) return NULL_OCR(`unparseable model output: ${(text ?? "").slice(0, 120)}`);
  let o: Record<string, unknown>;
  try { o = JSON.parse(cand) as Record<string, unknown>; } catch { return NULL_OCR("unparseable JSON from model"); }
  return {
    bill_date: toStr(o.bill_date), vendor_name: toStr(o.vendor_name), bill_number: toStr(o.bill_number),
    gstin: toStr(o.gstin), hsn_sac: toStr(o.hsn_sac), item_total: toNum(o.item_total),
    tax_percentage: toNum(o.tax_percentage), cgst: toNum(o.cgst), sgst: toNum(o.sgst), igst: toNum(o.igst),
    cess: toNum(o.cess), round_off: toNum(o.round_off), location_name: toStr(o.location_name),
    place_of_supply: toStr(o.place_of_supply), vendor_notes: toStr(o.vendor_notes), grand_total: toNum(o.grand_total),
    confidence: toNum(o.confidence), notes: toStr(o.notes),
  };
}

/** Inline OCR with key rotation (mirrors lib/scrap-scale/ocr.ts geminiExtract). 429 on a key fails over; all-429 throws 429. */
export async function geminiExtractInvoice(base64: string, mimeType: string, messageId: string, attachmentId: string): Promise<InvoiceOcr> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const keys = parseGeminiKeys();
  const start = nextStartIndex(keys.length);
  const body = JSON.stringify({
    contents: [{ parts: [{ text: INVOICE_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });
  let lastRate: Error | null = null;
  for (let n = 0; n < keys.length; n++) {
    const key = keys[(start + n) % keys.length];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    if (res.ok) {
      const data = await res.json();
      return parseInvoice(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "", messageId, attachmentId);
    }
    const t = await res.text();
    if (isRateLimitStatus(res.status)) { lastRate = Object.assign(new Error(`Gemini 429: ${t}`), { status: 429 }); continue; }
    throw Object.assign(new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`), { status: res.status });
  }
  throw lastRate ?? Object.assign(new Error("Gemini: all keys exhausted"), { status: 429 });
}
```

- [ ] **Step 4: Run test → PASS. Step 5: Commit** `feat(invoice): Gemini invoice OCR + tolerant parse`.

---

## Task 4: Mapping + flags (`lib/invoice/mapping.ts`)

**Files:** Create `lib/invoice/mapping.ts`, Test `lib/invoice/__tests__/mapping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mapInvoiceToRow, computeFlags } from "../mapping";
import { DEFAULT_CONSTANTS } from "../schema";
import type { InvoiceOcr } from "../schema";

const ocr: InvoiceOcr = {
  bill_date: "24-May-26", vendor_name: "Transigo Fleet LLP", bill_number: "May/26-27/03", gstin: "27AARFT4986F1ZF",
  hsn_sac: "996601", item_total: 209322, tax_percentage: 18, cgst: 18838.98, sgst: 18838.98, igst: 0, cess: 0,
  round_off: 0.04, location_name: "Maharashtra", place_of_supply: "Maharashtra",
  vendor_notes: "Being Services Rendered for 20 Cars during the period 01-05-2026 to 31-05-2026",
  grand_total: 247000, confidence: 0.95, notes: null,
};

describe("mapInvoiceToRow", () => {
  const row = mapInvoiceToRow(ocr, DEFAULT_CONSTANTS);
  it("fills constants", () => {
    expect(row["Accounts Payable"]).toBe("Car Rent Creditors");
    expect(row["Account Code"]).toBe("2114");
    expect(row["Tax Type"]).toBe("Tax Group");
  });
  it("fills OCR fields incl. Rate = Item Total", () => {
    expect(row["Item Total"]).toBe(209322);
    expect(row["Rate"]).toBe(209322);
    expect(row["HSN/SAC"]).toBe("996601");
    expect(row["GST Identification Number (GSTIN)"]).toBe("27AARFT4986F1ZF");
    expect(row["Adjustment"]).toBe(0.04);
  });
  it("computes Tax Amount and TDS Amount", () => {
    expect(row["Tax Amount"]).toBeCloseTo(37677.96, 2);
    expect(row["TDS Amount"]).toBeCloseTo(4186.44, 2); // 2% of 209322
  });
});

describe("computeFlags", () => {
  it("no flags on a clean, reconciling invoice", () => {
    expect(computeFlags(ocr, mapInvoiceToRow(ocr, DEFAULT_CONSTANTS))).toEqual([]);
  });
  it("flags low confidence, missing fields, and non-reconciling totals", () => {
    const bad = { ...ocr, confidence: 0.3, bill_number: null, grand_total: 999999 };
    const flags = computeFlags(bad, mapInvoiceToRow(bad, DEFAULT_CONSTANTS));
    expect(flags).toContain("low-confidence");
    expect(flags).toContain("missing:bill_number");
    expect(flags).toContain("totals-mismatch");
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run test → PASS. Step 5: Commit** `feat(invoice): invoice→36-column mapping + flags`.

---

## Task 5: Excel builder (`lib/invoice/excel.ts`)

**Files:** Create `lib/invoice/excel.ts`, Test `lib/invoice/__tests__/excel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
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
  return out as Buffer;
}
```

- [ ] **Step 4: Run test → PASS. Step 5: Commit** `feat(invoice): Zoho-ready Excel builder (Bills + DropdownData)`.

---

## Task 6: Gmail query + attachments (`lib/invoice/gmailQuery.ts` + extend `lib/google/gmail.ts`)

**Files:** Create `lib/invoice/gmailQuery.ts`, Test `lib/invoice/__tests__/gmailQuery.test.ts`; Modify `lib/google/gmail.ts`

- [ ] **Step 1: Write the failing test for the query builder**

```ts
import { describe, it, expect } from "vitest";
import { buildInvoiceQuery, gmailDate } from "../gmailQuery";

describe("buildInvoiceQuery", () => {
  it("scopes to the label and since-date (Gmail after: yyyy/mm/dd, inclusive of that day)", () => {
    expect(buildInvoiceQuery("Invoices", "2026-06-09")).toBe('label:"Invoices" after:2026/06/08');
  });
  it("omits after: when no date", () => {
    expect(buildInvoiceQuery("Invoices", null)).toBe('label:"Invoices"');
  });
});

describe("gmailDate", () => {
  it("formats ISO date to yyyy/mm/dd", () => {
    expect(gmailDate("2026-06-09")).toBe("2026/06/09");
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement `lib/invoice/gmailQuery.ts`**

```ts
export function gmailDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${y}/${m}/${d}`;
}

/** Gmail's `after:` is exclusive of the given day's start, so subtract one day to include `sinceDate`. */
export function buildInvoiceQuery(label: string, sinceDate: string | null): string {
  const base = `label:"${label.replace(/"/g, "")}"`;
  if (!sinceDate) return base;
  const dt = new Date(sinceDate + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${base} after:${gmailDate(dt.toISOString())}`;
}
```

- [ ] **Step 4: Run test → PASS.**
- [ ] **Step 5: Extend `lib/google/gmail.ts`** — add (after `getFull`):

```ts
type GmailFullPart = { filename?: string; mimeType?: string; body?: { attachmentId?: string; data?: string }; parts?: GmailFullPart[] };

/** Full message JSON (for walking attachments). */
export async function getFullRaw(token: string, id: string): Promise<{ id: string; threadId: string; payload?: GmailFullPart; headers: { name: string; value: string }[] }> {
  const res = await gFetch(token, `/messages/${id}?format=full`);
  if (!res.ok) throw new Error(`Gmail full ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const msg = await res.json();
  return { id: msg.id, threadId: msg.threadId, payload: msg.payload, headers: msg.payload?.headers ?? [] };
}

const ATTACH_MIME = /^(application\/pdf|image\/(png|jpe?g))$/i;

/** Walk a payload tree for downloadable invoice attachments (pdf/png/jpg). */
export function listAttachments(payload: GmailFullPart | undefined): { filename: string; attachmentId: string; mimeType: string }[] {
  const out: { filename: string; attachmentId: string; mimeType: string }[] = [];
  const walk = (p?: GmailFullPart) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId && ATTACH_MIME.test(p.mimeType ?? "")) {
      out.push({ filename: p.filename, attachmentId: p.body.attachmentId, mimeType: (p.mimeType ?? "").toLowerCase() });
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  return out;
}

/** Download one attachment as base64 (Gmail returns base64url; normalise to base64). */
export async function getAttachment(token: string, messageId: string, attachmentId: string): Promise<string> {
  const res = await gFetch(token, `/messages/${messageId}/attachments/${attachmentId}`);
  if (!res.ok) throw new Error(`Gmail attachment ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return String(json.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
}
```

(If `gFetch` / `GmailFullPart` naming clashes, reuse the file's existing `gFetch`; define `GmailFullPart` only if not already present.)

- [ ] **Step 6: Run** `npx vitest run lib/invoice/__tests__/gmailQuery.test.ts` and `npm run build` → green.
- [ ] **Step 7: Commit** `feat(invoice): gmail label/date query + attachment download`.

---

## Task 7: Config + mapping-profile API

**Files:** Create `app/api/tools/invoice-zoho/config/route.ts`, `app/api/tools/invoice-zoho/profiles/route.ts`, `app/api/tools/invoice-zoho/profiles/[id]/route.ts`

- [ ] **Step 1: Config GET/POST** (`config/route.ts`) — GET returns the dept's `invoice_config` (or defaults) + ensures a seeded "Car Rental" profile exists; POST upserts `{ gmail_label, profile_id, since override }`. Use `requireFinance`, `createAdminClient`. On GET, if no profile exists, insert one with `DEFAULT_CONSTANTS` (name "Car Rental", active true) and set it as config.profile_id.

```ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";
import { DEFAULT_CONSTANTS } from "@/lib/invoice/schema";

export async function GET() {
  const { departmentId } = await requireFinance();
  const db = createAdminClient();
  let { data: profiles } = await db.from("invoice_mapping_profiles").select("*").eq("department_id", departmentId).order("created_at");
  if (!profiles?.length) {
    const { data: seeded } = await db.from("invoice_mapping_profiles").insert({ department_id: departmentId, name: "Car Rental", constants: DEFAULT_CONSTANTS, active: true }).select("*").single();
    profiles = seeded ? [seeded] : [];
  }
  let { data: config } = await db.from("invoice_config").select("*").eq("department_id", departmentId).maybeSingle();
  if (!config) {
    const { data: c } = await db.from("invoice_config").insert({ department_id: departmentId, profile_id: profiles[0]?.id ?? null }).select("*").single();
    config = c;
  }
  return NextResponse.json({ config, profiles });
}

export async function POST(req: NextRequest) {
  const { departmentId } = await requireFinance();
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { department_id: departmentId, updated_at: new Date().toISOString() };
  if (typeof body.gmail_label === "string") patch.gmail_label = body.gmail_label.trim();
  if (typeof body.profile_id === "string") patch.profile_id = body.profile_id;
  if (typeof body.last_run_date === "string" || body.last_run_date === null) patch.last_run_date = body.last_run_date;
  const db = createAdminClient();
  const { data, error } = await db.from("invoice_config").upsert(patch, { onConflict: "department_id" }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
```

- [ ] **Step 2: Profiles** — `profiles/route.ts` GET (list) + POST (`{ name, constants }` insert); `profiles/[id]/route.ts` PATCH (`{ name?, constants? }`) + DELETE (admin-only via `requireFinanceAdmin`). All scoped by `department_id`. (Mirror `lib/lender` CRUD route shapes.)
- [ ] **Step 3:** `npm run build` green. **Step 4: Commit** `feat(invoice): config + mapping-profile API`.

---

## Task 8: Run creation + process-chunk (the pipeline)

**Files:** Create `app/api/tools/invoice-zoho/run/route.ts`, `app/api/tools/invoice-zoho/run/[runId]/process-chunk/route.ts`

- [ ] **Step 1: `run/route.ts`** — `requireFinance`; load config (label required → 400 if missing) + active profile constants; `getAccessToken(userId, LENDER_FOLLOWUP_SCOPES)` (409 on ReconsentRequired); since = config.last_run_date ?? today (ISO, server's date passed from client to avoid Date pitfalls — accept `body.today`); `searchMessageRefs(token, buildInvoiceQuery(label, since), 200)`; worklist = unique message ids; insert `invoice_runs` (status running, label, since, worklist, cursor 0, counts {messages: n, invoices:0, rows:0, flagged:0, duplicates:0}, summary {profile_id, constants}); seed activity; return `{ runId, total }`. (Pass constants in summary so the chunk processor uses a stable snapshot.)

- [ ] **Step 2: `process-chunk/route.ts`** — `export const maxDuration = 60`. CHUNK=2 messages, CONCURRENCY=2. Read run; if cursor≥worklist → finalize. For each message in slice:
  - `getFullRaw(token, id)`; `listAttachments(payload)`. If none, optional body fallback (skip for v1 unless empty — use `decodeBodyParts` to OCR body only if there are zero attachments AND the body has an inline data URL — otherwise skip).
  - For each attachment NOT already in `invoice_processed (dept, message_id, attachment_id)`: `getAttachment` → `geminiExtractInvoice(base64, mime, id, attId)` → `mapInvoiceToRow(ocr, constants)` → `computeFlags`; insert `invoice_rows`; insert `invoice_processed`. Count invoices/rows/flagged; dups counted when skipped.
  - Rate-limit handling identical to lender: a 429 escaping → set `rateLimited`, break, persist counts WITHOUT advancing cursor, return `{ rateLimited:true, done:false }`. Non-rate per-item errors → record an `invoice_rows` row with `flags:["ocr-error"]` + the message + continue.
  - Advance cursor; on final chunk finalize: set status done, update `invoice_config.last_run_date = run.since`... NO — set `last_run_date = today` so tomorrow only picks up newer. Append activity. Return `{ done:true }`.
  - Wrap whole handler in try/catch → JSON 500.

  Use `mapWithConcurrency` + `withRetry` (reuse from scrap-scale/queue). This mirrors the lender process-chunk almost exactly — copy its structure.

- [ ] **Step 3:** `npm run build` green. **Step 4: Commit** `feat(invoice): run pipeline — fetch, OCR, map, dedup (resumable, rate-limit-safe)`.

---

## Task 9: Run GET / export / delete / attachment view

**Files:** Create `app/api/tools/invoice-zoho/run/[runId]/route.ts` (GET + admin DELETE), `app/api/tools/invoice-zoho/run/[runId]/export/route.ts`, `app/api/tools/invoice-zoho/attachment/[messageId]/[attachmentId]/route.ts`

- [ ] **Step 1: GET** — run + its `invoice_rows` (ordered created_at). **DELETE** — `requireFinanceAdmin` (403 else), delete run scoped to dept (cascade rows).
- [ ] **Step 2: export** — load run rows' `mapped` jsonb → `buildZohoWorkbook(rows.map(r => r.mapped))` → xlsx response (`Content-Disposition: attachment; filename="zoho-purchase-bills.xlsx"`).
- [ ] **Step 3: attachment view** — `requireFinance`; verify `(dept,messageId,attachmentId)` exists in `invoice_processed`; `getAccessToken`; `getAttachment` → return the bytes with the stored mime type (look up `invoice_rows` for mime) for the audit drawer.
- [ ] **Step 4:** build green. **Commit** `feat(invoice): run detail, Zoho export, admin delete, attachment view`.

---

## Task 10: UI — grid, config, run, history

**Files:** Create `app/(app)/finance/invoice-zoho/page.tsx`, `components/invoice/InvoiceApp.tsx`, `components/invoice/InvoiceConfig.tsx`, `components/invoice/InvoiceGrid.tsx`, `components/invoice/InvoiceRunHistory.tsx`, `components/invoice/InvoicePageClient.tsx`

- [ ] **Step 1: page.tsx** — `requireDepartmentAccess("finance")`; `getConnection(user.id, LENDER_FOLLOWUP_SCOPES)`; load config+profiles (via the API helper or direct db), latest run + its rows (for the grid on load), runs list, resume (running run). Pass to `InvoicePageClient` with `canManage`.
- [ ] **Step 2: InvoiceConfig.tsx** — Gmail label input, since-date (defaults today), profile select + an editable constants table (key/value) saving via profiles PATCH; Save.
- [ ] **Step 3: InvoiceApp.tsx** — connect-state (SignOutButton if no gmail scope); "Run" button → POST /run with `today` = local date → processLoop (copy lender's loop incl. rate-limit wait + resume); counts; download CSV/Excel link to `/run/<id>/export`; privacy note (only labelled mail is read; never marked read).
- [ ] **Step 4: InvoiceGrid.tsx** — horizontal-scroll table with the 36 `ZOHO_HEADERS` as columns, one row per `invoice_rows.mapped`; flagged rows tinted; click row → drawer showing the source invoice (`<iframe>`/`<img>` to `/attachment/<msg>/<att>`) + OCR-read vs mapped values.
- [ ] **Step 5: InvoiceRunHistory.tsx** — list instances (when, run by, invoices, rows, flagged, status) + View detail (rows) + admin Delete + compare two instances (new/removed/changed by bill_number). Mirror `LenderRunHistory`.
- [ ] **Step 6:** `npm run build` green. **Commit** `feat(invoice): UI — config, run, 36-col grid, history + compare`.

---

## Task 11: Registry + README + final verification

**Files:** Modify `lib/tools/registry.ts`, `README.md`

- [ ] **Step 1:** Add to `TOOLS`:

```ts
  {
    slug: "invoice-zoho",
    name: "Invoice → Zoho Bills",
    description: "OCR invoice emails into the Zoho purchase-bill template (Excel export).",
    departmentSlug: "finance",
    icon: "ReceiptText",
    route: "/finance/invoice-zoho",
    requiredRole: "member",
  },
```

- [ ] **Step 2:** README section (label setup, dedup behaviour, mapping profile, Zoho export).
- [ ] **Step 3:** `npm test` (all suites incl. new invoice ones), `npm run lint`, `npm run build` → all green; `/finance/invoice-zoho` in route list.
- [ ] **Step 4: Commit** `feat(invoice): register tool under Finance + README`.

---

## Runtime verification (after deploy)
1. In Gmail, create a label, apply it to a couple of invoice emails (with PDF/image attachments).
2. Tool → set the label + confirm the Car Rental profile → Run.
3. Confirm: each invoice → a 36-column row (constants + OCR + computed Tax/TDS); flagged rows tinted; click a row → source invoice + OCR vs mapped.
4. Download Excel → opens with "Bills" (36 headers + rows) + "DropdownData"; imports into Zoho.
5. Run again same day → 0 new (all deduped). Add a new labelled invoice → only that one is processed.

## Self-review notes
- Spec coverage: label+incremental+date (T6/T8), dedup message+attachment (T8 `invoice_processed`), OCR PDF+image (T3), 36-col mapping incl. constants/computed (T2/T4), editable DB profile (T7), grid+drawer audit (T10), Zoho Excel incl. DropdownData (T5/T9), instance+history+compare (T8/T10), admin delete (T9), rate-limit/resumable (T8 mirrors lender), registry+README (T11). GST-split check intentionally omitted per decision.
- Type consistency: `InvoiceOcr` (schema) → `mapInvoiceToRow`/`computeFlags` (mapping) → `buildZohoWorkbook` (excel); `ZOHO_HEADERS` single source of order; gmail `getFullRaw`/`listAttachments`/`getAttachment` used by T8/T9.
