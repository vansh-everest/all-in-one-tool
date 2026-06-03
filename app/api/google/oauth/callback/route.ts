import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { exchangeCode, emailFromIdToken } from "@/lib/google/oauth";
import { saveConnection } from "@/lib/google/connection";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/accounting/scrap-scale?${qs}`, url.origin));

  if (err) return back(`connected=0&reason=${encodeURIComponent(err)}`);
  if (!code || !state) return back("connected=0&reason=missing_code");

  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in", url.origin));

  let stateUid = "";
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    stateUid = parsed.uid;
    const cookieNonce = req.cookies.get("g_oauth_state")?.value;
    if (!cookieNonce || cookieNonce !== parsed.nonce) return back("connected=0&reason=bad_state");
  } catch {
    return back("connected=0&reason=bad_state");
  }
  // The connection belongs to the signed-in user; ignore mismatched state uid.
  if (stateUid && stateUid !== userId) return back("connected=0&reason=bad_state");

  const token = await exchangeCode(code);
  if (!token.refresh_token) return back("connected=0&reason=no_refresh_token");

  await saveConnection({
    clerkUserId: userId,
    googleEmail: emailFromIdToken(token.id_token),
    refreshToken: token.refresh_token,
    scopes: (token.scope ?? "").split(" ").filter(Boolean),
  });

  const res = back("connected=1");
  res.cookies.delete("g_oauth_state");
  return res;
}
