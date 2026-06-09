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
