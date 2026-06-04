// Seeds the 5 departments. Users self-provision via Google sign-in (Clerk);
// super-admin is granted by SUPER_ADMIN_EMAILS on first login — no user seeding here.
// Usage: node --env-file=.env.local supabase/seed.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEPARTMENTS = [
  { slug: "marketing", name: "Marketing", icon: "Megaphone" },
  { slug: "recruitment", name: "Recruitment", icon: "Users" },
  { slug: "finance", name: "Finance", icon: "Banknote" },
  { slug: "accounting", name: "Accounting", icon: "Calculator" },
  { slug: "operations", name: "Operations", icon: "Truck" },
];

async function main() {
  const { error } = await admin.from("departments").upsert(DEPARTMENTS, { onConflict: "slug" });
  if (error) throw error;
  console.log(`Upserted ${DEPARTMENTS.length} departments.`);

  const { data: finance } = await admin.from("departments").select("id").eq("slug", "finance").single();
  if (finance) {
    const LENDERS = [
      "Aditya Birla Capital Ltd",
      "Axis Bank Limited (Commercial)",
      "Bank of Maharashtra",
      "Bank of Baroda",
      "Cholamandalam Finance",
      "CSB Bank Limited",
      "Cosmos Co-operative Bank Ltd",
      "DNSB Sahakari Bank Ltd",
      "Federal Bank Limited",
    ].map((name) => ({ department_id: finance.id, name }));
    const { error: lendErr } = await admin
      .from("lenders")
      .upsert(LENDERS, { onConflict: "department_id,name" });
    if (lendErr) throw lendErr;
    console.log(`Upserted ${LENDERS.length} lenders into Finance.`);
  }
}

main()
  .then(() => {
    console.log("Seed complete.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("Seed failed:", e.message ?? e);
    process.exit(1);
  });
