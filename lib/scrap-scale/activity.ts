import type { createAdminClient } from "@/utils/supabase/admin";

type DB = ReturnType<typeof createAdminClient>;

export type Activity = { at: string; message: string };

/** Append a timestamped event to a run's activity log (read-modify-write; runs are processed serially). */
export async function appendActivity(db: DB, runId: string, message: string): Promise<void> {
  const { data } = await db.from("scrap_scale_runs").select("activities").eq("id", runId).single();
  const activities: Activity[] = Array.isArray(data?.activities) ? (data!.activities as Activity[]) : [];
  activities.push({ at: new Date().toISOString(), message });
  await db.from("scrap_scale_runs").update({ activities }).eq("id", runId);
}
