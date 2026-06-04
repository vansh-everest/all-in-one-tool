// lib/lender/access.ts
import { requireDepartmentAccess } from "@/lib/auth/guards";

export const DEPT_SLUG = "finance";

export async function requireFinance(): Promise<{ departmentId: string; userId: string; email: string }> {
  const { user, department } = await requireDepartmentAccess(DEPT_SLUG);
  return { departmentId: department.id, userId: user.id, email: user.email };
}

/** Throws "forbidden" when the user is only a member (caller returns 403). */
export async function requireFinanceAdmin(): Promise<{ departmentId: string; userId: string; email: string }> {
  const { user, department, role } = await requireDepartmentAccess(DEPT_SLUG);
  if (role !== "admin" && role !== "super") throw new Error("forbidden");
  return { departmentId: department.id, userId: user.id, email: user.email };
}
