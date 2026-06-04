// One-off: load the local "Pendencies with Lenders" CSV into the Lender Follow-up Tracker
// (lenders + owners + an "imported" baseline instance). Mirrors lib/lender/importSheet.ts +
// lib/lender/applyImport.ts. The product path is POST /api/tools/lender-followup/import (pasted link).
// Usage: node --env-file=.env.local supabase/import-pendencies.mjs ["path/to.csv"]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CSV = process.argv[2] || "Stuff_needed/Finance/Pending Tasks/Pendencies with Lenders.csv";
const IMPORTER_EMAIL = "vansh.sood@everestfleet.in";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// --- RFC4180 CSV parse (handles quoted fields with embedded commas/newlines) ---
function parseCsv(s) {
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const normalizeLenderName = (x) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function parsePendencyMatrix(rows) {
  let headerRow = -1, srCol = -1;
  for (let r = 0; r < rows.length; r++) {
    const c = (rows[r] ?? []).findIndex((cell) => normalizeLenderName(cell) === "srno");
    if (c >= 0) { headerRow = r; srCol = c; break; }
  }
  if (headerRow < 0) return { lenders: [], items: [] };
  const header = rows[headerRow] ?? [];
  const ownerRow = headerRow > 0 ? rows[headerRow - 1] ?? [] : [];
  const cols = [];
  for (let c = srCol + 1; c < header.length; c++) {
    const name = (header[c] ?? "").trim();
    if (!name || normalizeLenderName(name) === "nonlender") continue;
    cols.push({ col: c, name, owner: (ownerRow[c] ?? "").trim() || null });
  }
  const items = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (const c of cols) {
      const val = (row[c.col] ?? "").trim();
      if (val) items.push({ lenderName: c.name, item: val });
    }
  }
  return { lenders: cols.map((c) => ({ name: c.name, owner: c.owner })), items };
}

async function main() {
  const parsed = parsePendencyMatrix(parseCsv(readFileSync(CSV, "utf8")));
  if (!parsed.lenders.length) throw new Error("No lender columns found in CSV.");

  const { data: dept } = await db.from("departments").select("id").eq("slug", "finance").single();
  if (!dept) throw new Error("Finance department not found — run seed.mjs first.");
  const departmentId = dept.id;

  // Replace any prior sheet-import instance so there is a single imported baseline.
  await db.from("lender_runs").delete().eq("department_id", departmentId).eq("status", "imported");

  const { data: existing } = await db.from("lenders").select("id, name, owner").eq("department_id", departmentId);
  const byNorm = new Map();
  (existing ?? []).forEach((l) => byNorm.set(normalizeLenderName(l.name), l));

  let created = 0, updated = 0;
  for (const pl of parsed.lenders) {
    const key = normalizeLenderName(pl.name);
    const ex = byNorm.get(key);
    if (ex) {
      if (pl.owner && ex.owner !== pl.owner) {
        await db.from("lenders").update({ owner: pl.owner }).eq("id", ex.id);
        byNorm.set(key, { ...ex, owner: pl.owner });
        updated++;
      }
    } else {
      const { data: ins, error } = await db
        .from("lenders")
        .insert({ department_id: departmentId, name: pl.name, owner: pl.owner, active: true })
        .select("id, name, owner").single();
      if (error) throw error;
      byNorm.set(key, ins);
      created++;
    }
  }

  const itemRows = parsed.items
    .map((it) => {
      const l = byNorm.get(normalizeLenderName(it.lenderName));
      if (!l) return null;
      return {
        lender_id: l.id, lender_name: l.name, owner: l.owner ?? null, item: it.item,
        status: "", last_update_date: null, direction: "unclear", source_message_id: "", thread_id: null,
      };
    })
    .filter(Boolean);

  const lendersWithItems = new Set(itemRows.map((r) => r.lender_id)).size;
  const counts = { unread_total: 0, matched: 0, queued: 0, lenders_with_items: lendersWithItems, open_items: itemRows.length };

  const gridColumns = parsed.lenders.map((pl) => {
    const l = byNorm.get(normalizeLenderName(pl.name));
    return {
      lender_id: l?.id ?? null,
      name: l?.name ?? pl.name,
      owner: l?.owner ?? pl.owner ?? null,
      items: parsed.items.filter((it) => it.lenderName === pl.name).map((it) => it.item),
    };
  });

  const { data: run, error: runErr } = await db
    .from("lender_runs")
    .insert({
      department_id: departmentId, created_by_email: IMPORTER_EMAIL, status: "imported",
      worklist: [], cursor: 0, counts, summary: { source: "csv-import", grid: { columns: gridColumns } },
      activities: [{ at: new Date().toISOString(), message: `Imported ${parsed.lenders.length} lenders and ${itemRows.length} pending items from the Pendencies sheet` }],
    })
    .select("id").single();
  if (runErr) throw runErr;

  for (let i = 0; i < itemRows.length; i += 500) {
    const { error } = await db.from("lender_run_items").insert(itemRows.slice(i, i + 500).map((r) => ({ ...r, run_id: run.id })));
    if (error) throw error;
  }

  console.log(`Lenders: ${parsed.lenders.length} parsed (${created} created, ${updated} owners updated).`);
  console.log(`Items: ${itemRows.length} across ${lendersWithItems} lenders. Imported run: ${run.id}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Import failed:", e.message ?? e); process.exit(1); });
