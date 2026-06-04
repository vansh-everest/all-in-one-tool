// supabase/apply-0006.mjs — applies ONLY 0006 (migrate.mjs is not re-runnable after 0004).
// Usage: node --env-file=.env.local supabase/apply-0006.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const sql = await readFile(join(here, "migrations", "0006_lender_followup.sql"), "utf8");
const connectionString = process.env.DIRECT_URL;
if (!connectionString) {
  console.error("Missing DIRECT_URL env var.");
  process.exit(1);
}
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
await client.end();
console.log("0006 applied.");
