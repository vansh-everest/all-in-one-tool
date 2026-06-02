import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/utils/supabase/server";
import { filterDepartmentsForUser, toolsForDepartment } from "@/lib/auth/access";
import { TOOLS } from "@/lib/tools/registry";
import { DepartmentCard } from "@/components/DepartmentCard";
import type { DepartmentRow } from "@/lib/tools/types";

export default async function Dashboard() {
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
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Departments</h1>
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">
          You have no department access yet. Ask an administrator to add you.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((d) => {
            const role = user.isSuperAdmin
              ? null
              : user.memberships.find((m) => m.department_slug === d.slug)?.role ?? null;
            const count = toolsForDepartment(TOOLS, d.slug, role, user.isSuperAdmin).length;
            return (
              <DepartmentCard key={d.slug} slug={d.slug} name={d.name} toolCount={count} />
            );
          })}
        </div>
      )}
    </div>
  );
}
