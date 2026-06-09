// One-off: apply ONLY 0009. Usage: node --env-file=.env.local supabase/apply-0009.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const sql = await readFile(join(here, "migrations", "0009_invoice_zoho.sql"), "utf8");
const connectionString = process.env.DIRECT_URL;
if (!connectionString) {
  console.error("Missing DIRECT_URL env var.");
  process.exit(1);
}
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
await client.end();
console.log("0009 applied.");
