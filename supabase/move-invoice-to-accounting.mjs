// One-off: the Invoice → Zoho tool moved from the Finance tab to the Accounting tab.
// Its tables key on department_id, so existing config / mapping profile / runs / rows
// and — most importantly — the invoice_processed dedup history are still under Finance.
// This re-points all of that to the Accounting department so the next run keeps skipping
// already-processed invoices (no re-OCR, no wasted Gemini quota) and history stays visible.
//
// Safe to run once, BEFORE anyone opens the tool under Accounting. If Accounting already
// has invoice data, the script aborts so it never clobbers fresher rows.
//
// Usage: node --env-file=.env.local supabase/move-invoice-to-accounting.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const TABLES = ["invoice_config", "invoice_mapping_profiles", "invoice_runs", "invoice_processed", "invoice_rows"];

async function deptId(slug) {
  const { data, error } = await db.from("departments").select("id").eq("slug", slug).single();
  if (error || !data) { console.error(`No "${slug}" department`); process.exit(1); }
  return data.id;
}

const finance = await deptId("finance");
const accounting = await deptId("accounting");
if (finance === accounting) { console.error("finance and accounting resolve to the same id?!"); process.exit(1); }

// Refuse to overwrite: if Accounting already holds invoice data, stop and let a human decide.
for (const t of TABLES) {
  const { count } = await db.from(t).select("*", { count: "exact", head: true }).eq("department_id", accounting);
  if (count) {
    console.error(`Aborting: ${t} already has ${count} row(s) under Accounting. Move it by hand or clear those first.`);
    process.exit(1);
  }
}

let total = 0;
for (const t of TABLES) {
  const { count: before } = await db.from(t).select("*", { count: "exact", head: true }).eq("department_id", finance);
  if (!before) { console.log(`${t}: nothing under Finance, skipped.`); continue; }
  const { error } = await db.from(t).update({ department_id: accounting }).eq("department_id", finance);
  if (error) { console.error(`${t}: ${error.message}`); process.exit(1); }
  console.log(`${t}: moved ${before} row(s) Finance -> Accounting.`);
  total += before;
}
console.log(`\nDone. Re-pointed ${total} row(s) to the Accounting department.`);
process.exit(0);
