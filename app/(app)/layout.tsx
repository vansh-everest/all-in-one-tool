import { requireUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/utils/supabase/admin";
import { Sidebar } from "@/components/Sidebar";
import { filterDepartmentsForUser } from "@/lib/auth/access";
import type { DepartmentRow } from "@/lib/tools/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const admin = createAdminClient();
  const { data: allDepts } = await admin
    .from("departments")
    .select("id, slug, name, icon")
    .order("name");
  const visible = filterDepartmentsForUser(
    (allDepts ?? []) as DepartmentRow[],
    user.memberships,
    user.isSuperAdmin,
  );
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        departments={visible}
        email={user.email}
        isSuperAdmin={user.isSuperAdmin}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 p-8">{children}</main>
    </div>
  );
}
