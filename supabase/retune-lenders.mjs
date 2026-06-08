// One-off: re-tune Finance lenders against "Banker Contact Details.xlsx" (sheet "Banker Contact").
//  1) Delete all email-found + manually-added tracker items (keep imported sheet items).
//  2) Attach each bank's emails + sender domains; align names to the Banker Contact sheet.
// Usage: node --env-file=.env.local supabase/retune-lenders.mjs
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const XLSX = "Stuff_needed/Finance/Pending Tasks/Banker Contact Details.xlsx";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function cellText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text.trim();
    if (v.hyperlink) return String(v.hyperlink).replace(/^mailto:/i, "").trim();
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("").trim();
    if (v.result) return String(v.result).trim();
  }
  return String(v).trim();
}
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
// Free-mail domains must never become a lender's sender_domain (gmail.com etc. would match everything).
const FREE_DOMAINS = new Set(["gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "rediffmail.com", "live.com", "icloud.com", "ymail.com"]);
const STOP = new Set(["bank","ltd","limited","private","pvt","the","co","op","cooperative","coop","services","service","finance","financial","capital","fincap","advisors","trusteeship","sahakari","and","of","india","group"]);
function key(name) {
  const s = String(name).toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9\s]/g, " ");
  return s.split(/\s+/).filter((t) => t && !STOP.has(t)).join("");
}

// --- read xlsx ---
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);
const ws = wb.worksheets.find((w) => /banker contact/i.test(w.name));
const banksMap = new Map(); // name -> {emails:Set, domains:Set}
ws.eachRow((row, n) => {
  if (n <= 2) return;
  const name = cellText(row.getCell(2).value);
  if (!name) return;
  const email = cellText(row.getCell(7).value).toLowerCase();
  if (!banksMap.has(name)) banksMap.set(name, { emails: new Set(), domains: new Set() });
  if (email && isEmail(email)) {
    banksMap.get(name).emails.add(email);
    const dom = email.split("@")[1];
    if (!FREE_DOMAINS.has(dom)) banksMap.get(name).domains.add(dom); // keep the address, drop the free domain
  }
});
const canonical = [...banksMap.entries()].map(([name, v]) => ({ name, emails: [...v.emails], domains: [...v.domains], key: key(name) }));

// --- get finance dept + current lenders ---
const { data: dept } = await db.from("departments").select("id").eq("slug", "finance").single();
if (!dept) { console.error("No finance dept"); process.exit(1); }
const departmentId = dept.id;

// 1) cleanup: delete email + manual items
const { count: before } = await db.from("lender_items").select("*", { count: "exact", head: true }).eq("department_id", departmentId).in("source", ["email", "manual"]);
await db.from("lender_items").delete().eq("department_id", departmentId).in("source", ["email", "manual"]);
console.log(`Cleanup: removed ${before ?? 0} email/manual items.`);

const { data: lenders } = await db.from("lenders").select("id, name, owner").eq("department_id", departmentId);
const currentByKey = new Map();
for (const l of lenders ?? []) {
  const k = key(l.name);
  if (!currentByKey.has(k)) currentByKey.set(k, []);
  currentByKey.get(k).push(l);
}
const canonByKey = new Map();
for (const c of canonical) {
  if (!canonByKey.has(c.key)) canonByKey.set(c.key, []);
  canonByKey.get(c.key).push(c);
}
const unionEmails = (cs) => [...new Set(cs.flatMap((c) => c.emails))];
const unionDomains = (cs) => [...new Set(cs.flatMap((c) => c.domains))];

const report = { merged: [], attachedAmbiguous: [], created: [], pendencyOnly: [] };

for (const [k, cs] of canonByKey) {
  const cur = currentByKey.get(k) ?? [];
  if (cur.length === 1 && cs.length === 1) {
    const c = cs[0], l = cur[0];
    await db.from("lenders").update({ name: c.name, known_sender_emails: c.emails, sender_domains: c.domains }).eq("id", l.id);
    report.merged.push(`${l.name} -> ${c.name} (${c.emails.length} emails)`);
  } else if (cur.length >= 1) {
    const emails = unionEmails(cs), domains = unionDomains(cs);
    for (const l of cur) await db.from("lenders").update({ known_sender_emails: emails, sender_domains: domains }).eq("id", l.id);
    report.attachedAmbiguous.push(`key "${k}": canonical [${cs.map((c) => c.name).join(", ")}] -> attached emails to current [${cur.map((l) => l.name).join(", ")}]`);
  } else {
    for (const c of cs) {
      await db.from("lenders").upsert({ department_id: departmentId, name: c.name, known_sender_emails: c.emails, sender_domains: c.domains, active: true }, { onConflict: "department_id,name" });
      report.created.push(`${c.name} (${c.emails.length} emails)`);
    }
  }
}
for (const [k, cur] of currentByKey) {
  if (!canonByKey.has(k)) report.pendencyOnly.push(cur.map((l) => l.name).join(", "));
}

console.log(`\n=== MERGED (renamed + emails) [${report.merged.length}] ===\n` + report.merged.join("\n"));
console.log(`\n=== AMBIGUOUS (emails attached to all variants, review) [${report.attachedAmbiguous.length}] ===\n` + report.attachedAmbiguous.join("\n"));
console.log(`\n=== CREATED (in Banker Contact, not in tracker) [${report.created.length}] ===\n` + report.created.join("\n"));
console.log(`\n=== PENDENCY-ONLY (in tracker, no Banker Contact match — no emails) [${report.pendencyOnly.length}] ===\n` + report.pendencyOnly.join("\n"));
process.exit(0);
