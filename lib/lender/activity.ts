// lib/lender/activity.ts
import type { createAdminClient } from "@/utils/supabase/admin";

type DB = ReturnType<typeof createAdminClient>;
export type Activity = { at: string; message: string };

/** Append a timestamped event to a lender run's activity log (runs processed serially). */
export async function appendLenderActivity(db: DB, runId: string, message: string): Promise<void> {
  const { data } = await db.from("lender_runs").select("activities").eq("id", runId).single();
  const activities: Activity[] = Array.isArray(data?.activities) ? (data!.activities as Activity[]) : [];
  activities.push({ at: new Date().toISOString(), message });
  await db.from("lender_runs").update({ activities }).eq("id", runId);
}
