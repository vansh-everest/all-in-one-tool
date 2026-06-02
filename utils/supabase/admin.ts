import { createClient } from "@supabase/supabase-js";

/**
 * SERVER ONLY. Uses the service-role key and bypasses RLS.
 * Never import this into a Client Component or expose its key to the browser.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
