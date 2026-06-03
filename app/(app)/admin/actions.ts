"use server";
import { requireUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

async function assertSuperAdmin() {
  const user = await requireUser();
  if (!user.isSuperAdmin) throw new Error("Forbidden");
  return user;
}

export async function setMembership(formData: FormData) {
  await assertSuperAdmin();
  const profileId = String(formData.get("profile_id"));
  const departmentId = String(formData.get("department_id"));
  const role = String(formData.get("role"));

  const admin = createAdminClient();
  if (role === "none") {
    await admin
      .from("memberships")
      .delete()
      .match({ profile_id: profileId, department_id: departmentId });
  } else {
    await admin.from("memberships").upsert(
      { profile_id: profileId, department_id: departmentId, role },
      { onConflict: "profile_id,department_id" },
    );
  }
  revalidatePath("/admin");
}
