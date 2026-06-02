import { requireUser } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { AdminUserManager } from "@/components/admin/AdminUserManager";

export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/");

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name, is_super_admin")
    .order("email");
  const { data: departments } = await admin
    .from("departments")
    .select("id, slug, name")
    .order("name");
  const { data: memberships } = await admin
    .from("memberships")
    .select("profile_id, department_id, role");

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Admin · Users &amp; Access</h1>
      <AdminUserManager
        profiles={profiles ?? []}
        departments={departments ?? []}
        memberships={memberships ?? []}
      />
    </div>
  );
}
