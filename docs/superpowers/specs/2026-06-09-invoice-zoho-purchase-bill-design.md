# Invoice → Zoho Purchase-Bill Tool — Design

**Date:** 2026-06-09
**Department:** Finance (movable via registry)
**Status:** Approved — build everything (incl. run compare)

## Goal
Daily: pull new invoice emails from a dedicated Gmail label, OCR each invoice (PDF/image), map into the exact
36-column Zoho purchase-bill template, show as a spreadsheet grid, and download as a Zoho-ready Excel. Already-
processed invoices never reappear.

## Decisions locked
- **Skip the GST-split sanity check** (no buyer-vs-vendor state validation). Still flag missing/low-confidence
  fields and totals-don't-reconcile.
- **DB-backed editable mapping profile** (seeded "Car Rental" profile; constants editable; multiple profiles).
- **Build everything**, including run-history compare.
- **Excel is reconstructed** with ExcelJS (exact 36 headers in order + a `DropdownData` sheet containing "Yes"),
  not read from a bundled file — robust on serverless. Schema verified against
  `Purchase Bill Sample Zoho Import Template (1).xlsx`.

## Canonical 36-column schema (sheet "Bills", exact order)
1 Bill Date · 2 Transaction Posting Date · 3 Accounts Payable · 4 Vendor Name · 5 Bill Number · 6 Vendor Notes ·
7 Adjustment · 8 Adjustment Description · 9 Adjustment Account · 10 Location Name · 11 Bill Status · 12 Account ·
13 Account Code · 14 Description · 15 Tax Amount · 16 Item Total · 17 GST Treatment ·
18 GST Identification Number (GSTIN) · 19 TDS Name · 20 TDS Percentage · 21 TDS Section Code · 22 TDS Section ·
23 TDS Amount · 24 Line Item Location Name · 25 Rate · 26 HSN/SAC · 27 Tax Name · 28 Tax Percentage ·
29 Tax Type · 30 Item Type · 31 CGST · 32 SGST · 33 IGST · 34 CESS · 35 LINEITEM.TAG.Business Vertical ·
36 LINEITEM.TAG.Hub

## Mapping (three buckets)
**A) Constants (seeded into the profile; editable):**
Accounts Payable="Car Rent Creditors"; Adjustment Description="Adjustment"; Adjustment Account="Other Expenses";
Bill Status="Overdue"; Account="Car rent @ 18%"; Account Code="2114"; Description="Car rental Services";
GST Treatment="business_gst"; TDS Name="TDS on Rent of plant & Machinery (1008)"; TDS Percentage=2.00;
TDS Section Code="rent_plant_machinery"; TDS Section="Section 393(1) Sl2(ii)D(a)"; Tax Name="GST18";
Tax Type="Tax Group"; Item Type="service"; LINEITEM.TAG.Business Vertical="Fleet";
Transaction Posting Date=blank; LINEITEM.TAG.Hub=blank.

**B) From invoice (OCR):** Bill Date, Vendor Name, Bill Number, Vendor Notes, Adjustment (round_off),
Location Name, Line Item Location Name, Item Total, Rate (=Item Total), GSTIN, Tax Percentage, HSN/SAC,
CGST, SGST, IGST, CESS.

**C) Computed:**
- Tax Amount = CGST + SGST + IGST + CESS.
- TDS Amount = TDS Percentage (2%) × Item Total. (Computed, surfaced as such.)
- Reconcile flag: |Item Total + Tax Amount + Adjustment − invoice grand total| > ₹1 → flag.

## OCR fields (per invoice, JSON)
`bill_date, vendor_name, bill_number, gstin, hsn_sac, item_total, tax_percentage, cgst, sgst, igst, cess,
round_off, location_name, place_of_supply, vendor_notes, grand_total, confidence (0..1), notes`. Nulls + reason
when unreadable. Reuse Scrap Scale's inline Gemini (base64 image/PDF) + key rotation + backoff. Reference invoice
verified: Transigo Fleet LLP, May/26-27/03, GSTIN 27AARFT4986F1ZF, HSN 996601, taxable 209322, CGST=SGST=18838.98,
round_off 0.04, grand 247000, "Being Services Rendered for 20 Cars during the period 01-05-2026 to 31-05-2026".

## Email source & dedup
- Reuse `gmail.readonly`. Query `label:"<label>" after:YYYY/MM/DD` (date = since last run; first run defaults to
  today). Never marks read.
- Download attachments (pdf/jpg/jpeg/png); also OCR the email body as a fallback document if no attachment.
- **Dedup:** persist `(department_id, message_id, attachment_id)` in `invoice_processed`; skip any already there.

## Data model — migration `0009_invoice_zoho.sql` (RLS on, no policies)
- `invoice_config` (pk department_id): gmail_label text, profile_id uuid, last_run_date date.
- `invoice_mapping_profiles`: id, department_id, name, constants jsonb, active bool, created_at.
- `invoice_runs`: id, department_id, created_by_email, status (running|done|error), label, since_date,
  worklist jsonb (message ids), cursor int, counts jsonb, summary jsonb, activities jsonb, last_internal_date,
  created_at.
- `invoice_processed`: id, department_id, message_id, attachment_id, run_id, processed_at; unique(dept,message_id,attachment_id).
- `invoice_rows`: id, run_id, department_id, source_message_id, attachment_id, file_name, mime_type, ocr jsonb,
  mapped jsonb, flags text[], confidence numeric, grand_total numeric, reconciled bool, created_at.

## Modules (`lib/invoice/`)
- `schema.ts` — `ZOHO_HEADERS` (36, ordered), `DEFAULT_CONSTANTS`, types.
- `ocr.ts` — `INVOICE_PROMPT`, `parseInvoice(text)`, `geminiExtractInvoice(base64, mime)` (key rotation).
- `mapping.ts` — `mapInvoiceToRow(ocr, constants)` → record by header; `computeFlags(ocr, mapped)`; pure, tested.
- `excel.ts` — `buildZohoWorkbook(rows)` → Buffer (Bills + DropdownData).
- `gmailQuery.ts` — `buildInvoiceQuery(label, sinceDate)`; pure, tested.
- `access.ts` — reuse `requireFinance` / `requireFinanceAdmin` from lender (shared) — or a thin invoice access re-export.

## Gmail client additions (`lib/google/gmail.ts`)
- `listAttachments(fullMessageJson)` → `{ filename, attachmentId, mimeType }[]` (walk payload parts).
- `getAttachment(token, messageId, attachmentId)` → base64 data.
- `getFullRaw(token, id)` → full message JSON (for attachment walking) alongside existing `getFull`.

## API (`app/api/tools/invoice-zoho/`)
- `config` GET/POST (label, active profile, since override).
- `profiles` GET/POST, `profiles/[id]` PATCH/DELETE (DELETE admin-only).
- `run` POST → create instance; `searchMessageRefs(label+since)`; worklist = message ids; seed counts/activities.
- `run/[id]/process-chunk` POST → next message(s): getFullRaw → attachments (+ body fallback) → for each NOT in
  `invoice_processed`: download + `geminiExtractInvoice` + `mapInvoiceToRow` → insert `invoice_rows`; mark
  processed. Rate-limit handling identical to lender (pause, don't advance, client waits/retries; resumable cursor).
- `run/[id]` GET → run + rows (+ flags). DELETE admin-only.
- `run/[id]/export` GET → xlsx (`buildZohoWorkbook`).
- `attachment/[messageId]/[attachmentId]` GET → stream the source file for the audit drawer.

## UI (`components/invoice/`, reuse design tokens)
- **Config card:** Gmail label input, since-date (defaults today), profile select + edit constants.
- **Run:** "Run" (process since last run) + live progress + resume + rate-limit wait (reuse lender pattern).
- **Grid:** spreadsheet-style 36 columns in order; flagged rows tinted; click row → drawer with source invoice
  (PDF/image) + OCR-read vs mapped values for audit/correction.
- **Download Excel** (Zoho-ready). **Run history + compare** (new/removed/changed rows vs previous instance).
- Counts: invoices processed, rows, flagged, skipped-as-dup.

## Cross-cutting
- All Gmail/Gemini server-side; reuse caching (per-message_id/attachment), throttle/backoff/key-rotation,
  resumable cursor. New tables RLS-on/no-policies. Register tool under Finance. README + `.env.example` (covered).

## Deliverable
Set label + profile → Run → new invoices since last run OCR'd + mapped into the 36-column grid (constants + OCR +
computed), flagged where needed, saved as an instance, downloadable as Zoho-ready Excel; processed
message+attachment pairs deduped so tomorrow's run only picks up new mail.
