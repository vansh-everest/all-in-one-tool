import { createClient } from "@/utils/supabase/server";
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
  department_id: string;
  google_email: string | null;
  scopes: string[];
};

export async function getConnection(departmentId: string): Promise<GoogleConnection | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("google_connections")
    .select("id, department_id, google_email, scopes")
    .eq("department_id", departmentId)
    .maybeSingle();
  return data ?? null;
}

export async function saveConnection(args: {
  departmentId: string;
  connectedBy: string;
  googleEmail: string | null;
  refreshToken: string;
  scopes: string[];
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("google_connections").upsert(
    {
      department_id: args.departmentId,
      connected_by: args.connectedBy,
      google_email: args.googleEmail,
      refresh_token_encrypted: encryptToken(args.refreshToken),
      scopes: args.scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "department_id" },
  );
  if (error) throw error;
}

/** Mints a fresh access token from the stored refresh token. Throws ReconsentRequired if missing/insufficient scopes. */
export async function getAccessToken(
  departmentId: string,
  requiredScopes: string[],
): Promise<{ accessToken: string; scopes: string[] }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("google_connections")
    .select("refresh_token_encrypted, scopes")
    .eq("department_id", departmentId)
    .maybeSingle();
  if (!data) throw new ReconsentRequired("No Google connection for this department");
  if (!hasAllScopes(data.scopes ?? [], requiredScopes)) throw new ReconsentRequired("Missing required scopes");

  const refreshToken = decryptToken(data.refresh_token_encrypted);
  const token = await refreshAccessToken(refreshToken);
  return { accessToken: token.access_token, scopes: (token.scope ?? "").split(" ").filter(Boolean) };
}
