import { requireDepartmentAccess } from "@/lib/auth/guards";

export const DEPT_SLUG = "accounting";

/** Guards the Accounting department and returns its id + the user id. */
export async function requireAccounting(): Promise<{ departmentId: string; userId: string }> {
  const { user, department } = await requireDepartmentAccess(DEPT_SLUG);
  return { departmentId: department.id, userId: user.id };
}
