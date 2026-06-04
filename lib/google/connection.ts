import { clerkClient } from "@clerk/nextjs/server";
import { hasAllScopes } from "./scopes";

export class ReconsentRequired extends Error {
  constructor(msg = "Google re-consent required") {
    super(msg);
    this.name = "ReconsentRequired";
  }
}

export type GoogleConnection = {
  clerk_user_id: string;
  google_email: string | null;
  scopes: string[];
};

const RECONSENT_MSG =
  "Your sign-in doesn't include Google Sheets/Drive access yet. Sign out and sign in again with Google to grant it.";

/** The Google OAuth token Clerk holds for this user (from their Google sign-in), or null. */
async function getGoogleToken(clerkUserId: string): Promise<{ token: string; scopes: string[] } | null> {
  const client = await clerkClient();
  try {
    const res = await client.users.getUserOauthAccessToken(clerkUserId, "google");
    const t = res.data?.[0];
    if (!t?.token) return null;
    return { token: t.token, scopes: t.scopes ?? [] };
  } catch {
    return null;
  }
}

/** Connection status for the UI: present only when the Google sign-in granted the required scopes. */
export async function getConnection(
  clerkUserId: string,
  requiredScopes: string[],
): Promise<GoogleConnection | null> {
  const tok = await getGoogleToken(clerkUserId);
  if (!tok || !hasAllScopes(tok.scopes, requiredScopes)) return null;

  const client = await clerkClient();
  const user = await client.users.getUser(clerkUserId);
  const google = user.externalAccounts?.find((a) => a.provider === "google" || a.provider === "oauth_google");
  const email = google?.emailAddress ?? user.primaryEmailAddress?.emailAddress ?? null;
  return { clerk_user_id: clerkUserId, google_email: email, scopes: tok.scopes };
}

/**
 * The user's Google access token (minted/refreshed by Clerk from their sign-in).
 * Throws ReconsentRequired if Google isn't connected or lacks the required scopes —
 * the remedy is to sign out and sign in again, granting Sheets/Drive.
 */
export async function getAccessToken(
  clerkUserId: string,
  requiredScopes: string[],
): Promise<{ accessToken: string; scopes: string[] }> {
  const tok = await getGoogleToken(clerkUserId);
  if (!tok) throw new ReconsentRequired(RECONSENT_MSG);
  if (!hasAllScopes(tok.scopes, requiredScopes)) throw new ReconsentRequired(RECONSENT_MSG);
  return { accessToken: tok.token, scopes: tok.scopes };
}
