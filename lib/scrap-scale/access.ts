import { requireDepartmentAccess } from "@/lib/auth/guards";

export const DEPT_SLUG = "accounting";

/** Guards the Accounting department and returns its id + the user id and email. */
export async function requireAccounting(): Promise<{ departmentId: string; userId: string; email: string }> {
  const { user, department } = await requireDepartmentAccess(DEPT_SLUG);
  return { departmentId: department.id, userId: user.id, email: user.email };
}

/** True when the user is a department admin or a super-admin. */
export async function isAccountingAdmin(): Promise<boolean> {
  const { role } = await requireDepartmentAccess(DEPT_SLUG);
  return role === "admin" || role === "super";
}

/**
 * Guards the Accounting department AND requires admin (or super-admin) rights.
 * Throws when the user is only a member — caller returns 403.
 */
export async function requireAccountingAdmin(): Promise<{ departmentId: string; userId: string; email: string }> {
  const { user, department, role } = await requireDepartmentAccess(DEPT_SLUG);
  if (role !== "admin" && role !== "super") {
    throw new Error("forbidden");
  }
  return { departmentId: department.id, userId: user.id, email: user.email };
}
