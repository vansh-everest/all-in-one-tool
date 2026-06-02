import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/utils/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { filterDepartmentsForUser } from "@/lib/auth/access";
import type { DepartmentRow } from "@/lib/tools/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: allDepts } = await supabase
    .from("departments")
    .select("id, slug, name, icon")
    .order("name");
  const visible = filterDepartmentsForUser(
    (allDepts ?? []) as DepartmentRow[],
    user.memberships,
    user.isSuperAdmin,
  );
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar
        departments={visible}
        email={user.email}
        isSuperAdmin={user.isSuperAdmin}
      />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
