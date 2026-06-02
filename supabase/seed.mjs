// Seeds the 5 departments and the super_admin account.
// Usage: node --env-file=.env.local supabase/seed.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_SUPER_ADMIN_EMAIL;
const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

if (!url || !serviceKey || !email || !password) {
  console.error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_SUPER_ADMIN_EMAIL, SEED_SUPER_ADMIN_PASSWORD",
  );
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
  const { error: deptErr } = await admin
    .from("departments")
    .upsert(DEPARTMENTS, { onConflict: "slug" });
  if (deptErr) throw deptErr;
  console.log(`Upserted ${DEPARTMENTS.length} departments.`);

  let userId;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Super Admin" },
  });
  if (createErr) {
    if (!/already|registered|exists/i.test(createErr.message)) throw createErr;
    const { data: list } = await admin.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === email)?.id;
    console.log("Super admin already exists; reusing.");
  } else {
    userId = created.user.id;
    console.log("Created super admin auth user.");
  }
  if (!userId) throw new Error("Could not resolve super admin user id.");

  const { error: profErr } = await admin
    .from("profiles")
    .upsert(
      { id: userId, email, full_name: "Super Admin", is_super_admin: true },
      { onConflict: "id" },
    );
  if (profErr) throw profErr;
  console.log("Flagged super admin profile.");
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
