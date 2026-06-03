import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth/guards";
import { buildConsentUrl } from "@/lib/google/oauth";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";

export async function GET() {
  const user = await requireUser(); // redirects if not signed in / not allowed
  const nonce = randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ uid: user.id, nonce })).toString("base64url");

  const url = buildConsentUrl(SCRAP_SCALE_SCOPES, state);
  const res = NextResponse.redirect(url);
  res.cookies.set("g_oauth_state", nonce, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
