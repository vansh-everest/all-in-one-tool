import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireDepartmentAccess } from "@/lib/auth/guards";
import { buildConsentUrl } from "@/lib/google/oauth";
import { SCRAP_SCALE_SCOPES } from "@/lib/google/scopes";

export async function GET(req: NextRequest) {
  const dept = req.nextUrl.searchParams.get("department") ?? "accounting";
  await requireDepartmentAccess(dept); // redirects if not a member / super_admin
  const nonce = randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ dept, nonce })).toString("base64url");

  const url = buildConsentUrl(SCRAP_SCALE_SCOPES, state);
  const res = NextResponse.redirect(url);
  res.cookies.set("g_oauth_state", nonce, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
