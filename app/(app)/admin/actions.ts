"use server";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

async function assertSuperAdmin() {
  const user = await requireUser();
  if (!user.isSuperAdmin) throw new Error("Forbidden");
  return user;
}

function tempPassword() {
  // Readable, sufficiently strong temp password; admin hands it off once.
  return "Ev-" + randomBytes(6).toString("base64url") + "-Aa1";
}

export async function createUser(_prev: unknown, formData: FormData) {
  await assertSuperAdmin();
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!email) return { error: "Email required." };

  const admin = createAdminClient();
  const password = tempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) return { error: error.message };

  await admin.from("profiles").update({ full_name: fullName }).eq("id", data.user.id);
  revalidatePath("/admin");
  return { ok: true, tempPassword: password, email };
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
