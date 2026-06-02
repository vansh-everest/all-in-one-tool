import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import type { DepartmentRow, Membership, Role } from "@/lib/tools/types";

export type CurrentUser = {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  memberships: Membership[];
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("department_id, role, departments(slug)")
    .eq("profile_id", user.id);

  return {
    id: user.id,
    email: user.email ?? "",
    isSuperAdmin: profile?.is_super_admin ?? false,
    memberships: (memberships ?? []).map((m) => {
      const dept = m.departments as unknown as { slug: string } | null;
      return {
        department_id: m.department_id as string,
        department_slug: dept?.slug ?? "",
        role: m.role as Role,
      };
    }),
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * Returns the user's role in the department, or "super" for super_admin.
 * Redirects to "/" if the user has no access.
 */
export async function requireDepartmentAccess(
  departmentSlug: string,
): Promise<{ user: CurrentUser; role: Role | "super"; department: DepartmentRow }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: dept } = await supabase
    .from("departments")
    .select("id, slug, name, icon")
    .eq("slug", departmentSlug)
    .single();
  if (!dept) redirect("/");

  if (user.isSuperAdmin) return { user, role: "super", department: dept as DepartmentRow };
  const m = user.memberships.find((x) => x.department_slug === departmentSlug);
  if (!m) redirect("/");
  return { user, role: m.role, department: dept as DepartmentRow };
}
