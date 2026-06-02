import type { DepartmentRow, Membership, Role, ToolDef } from "../tools/types";

export function filterDepartmentsForUser(
  departments: DepartmentRow[],
  memberships: Membership[],
  isSuperAdmin: boolean,
): DepartmentRow[] {
  if (isSuperAdmin) return departments;
  const allowed = new Set(memberships.map((m) => m.department_slug));
  return departments.filter((d) => allowed.has(d.slug));
}

export function toolsForDepartment(
  tools: ToolDef[],
  departmentSlug: string,
  role: Role | null,
  isSuperAdmin: boolean,
): ToolDef[] {
  return tools.filter((t) => {
    if (t.departmentSlug !== departmentSlug) return false;
    if (isSuperAdmin) return true;
    const required = t.requiredRole ?? "member";
    if (required === "admin") return role === "admin";
    return role === "admin" || role === "member";
  });
}
