import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "@/utils/supabase/admin";
import type { DepartmentRow, Membership, Role } from "@/lib/tools/types";

const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? "everestfleet.in,everestfleet.com")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
// Baked-in so the primary owner is always super-admin on Google sign-in, even if
// the SUPER_ADMIN_EMAILS env var is missing/misconfigured in a given environment.
const DEFAULT_SUPER_ADMINS = ["vansh.sood@everestfleet.in"];
const SUPER_ADMINS = [
  ...DEFAULT_SUPER_ADMINS,
  ...(process.env.SUPER_ADMIN_EMAILS ?? "").split(","),
]
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export type CurrentUser = {
  id: string; // Clerk user id
  email: string;
  isSuperAdmin: boolean;
  memberships: Membership[];
};

export function isAllowedEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const cu = await currentUser();
  const email =
    cu?.primaryEmailAddress?.emailAddress ?? cu?.emailAddresses?.[0]?.emailAddress ?? "";
  if (!isAllowedEmail(email)) return null;

  const admin = createAdminClient();
  const isSuper = SUPER_ADMINS.includes(email.toLowerCase());
  const fullName = [cu?.firstName, cu?.lastName].filter(Boolean).join(" ") || null;
  await admin
    .from("profiles")
    .upsert(
      { clerk_user_id: userId, email, full_name: fullName, is_super_admin: isSuper },
      { onConflict: "clerk_user_id" },
    );

  const { data: memberships } = await admin
    .from("memberships")
    .select("department_id, role, departments(slug)")
    .eq("profile_id", userId);

  return {
    id: userId,
    email,
    isSuperAdmin: isSuper,
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
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const user = await getCurrentUser();
  if (!user) redirect("/not-allowed");
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
  const admin = createAdminClient();
  const { data: dept } = await admin
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
