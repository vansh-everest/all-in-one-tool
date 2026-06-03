import { createAdminClient } from "@/utils/supabase/admin";
import { encryptToken, decryptToken } from "./crypto";
import { refreshAccessToken } from "./oauth";
import { hasAllScopes } from "./scopes";

export class ReconsentRequired extends Error {
  constructor(msg = "Google re-consent required") {
    super(msg);
    this.name = "ReconsentRequired";
  }
}

export type GoogleConnection = {
  id: string;
  clerk_user_id: string;
  google_email: string | null;
  scopes: string[];
};

export async function getConnection(clerkUserId: string): Promise<GoogleConnection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_connections")
    .select("id, clerk_user_id, google_email, scopes")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  return data ?? null;
}

export async function saveConnection(args: {
  clerkUserId: string;
  googleEmail: string | null;
  refreshToken: string;
  scopes: string[];
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("google_connections").upsert(
    {
      clerk_user_id: args.clerkUserId,
      google_email: args.googleEmail,
      refresh_token_encrypted: encryptToken(args.refreshToken),
      scopes: args.scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_user_id" },
  );
  if (error) throw error;
}

/** Mints a fresh access token from the stored refresh token. Throws ReconsentRequired if missing/insufficient scopes. */
export async function getAccessToken(
  clerkUserId: string,
  requiredScopes: string[],
): Promise<{ accessToken: string; scopes: string[] }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_connections")
    .select("refresh_token_encrypted, scopes")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (!data) throw new ReconsentRequired("No Google connection for this user");
  if (!hasAllScopes(data.scopes ?? [], requiredScopes)) throw new ReconsentRequired("Missing required scopes");

  const refreshToken = decryptToken(data.refresh_token_encrypted);
  const token = await refreshAccessToken(refreshToken);
  return { accessToken: token.access_token, scopes: (token.scope ?? "").split(" ").filter(Boolean) };
}
