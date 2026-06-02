// Applies SQL migration files in supabase/migrations/ in lexical order, against DIRECT_URL.
// Usage: node --env-file=.env.local supabase/migrate.mjs
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "migrations");

const connectionString = process.env.DIRECT_URL;
if (!connectionString) {
  console.error("Missing DIRECT_URL env var.");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = await readFile(join(dir, f), "utf8");
    process.stdout.write(`Applying ${f} ... `);
    await client.query(sql);
    console.log("done");
  }
}

main()
  .then(() => client.end())
  .then(() => console.log("Migrations complete."))
  .catch((e) => {
    console.error("Migration failed:", e.message);
    process.exit(1);
  });
