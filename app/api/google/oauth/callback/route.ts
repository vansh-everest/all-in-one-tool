import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
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

  let dept = "accounting";
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    dept = parsed.dept;
    const cookieNonce = req.cookies.get("g_oauth_state")?.value;
    if (!cookieNonce || cookieNonce !== parsed.nonce) return back("connected=0&reason=bad_state");
  } catch {
    return back("connected=0&reason=bad_state");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", url.origin));

  const { data: deptRow } = await supabase.from("departments").select("id").eq("slug", dept).single();
  if (!deptRow) return back("connected=0&reason=bad_department");

  const token = await exchangeCode(code);
  if (!token.refresh_token) return back("connected=0&reason=no_refresh_token");

  await saveConnection({
    departmentId: deptRow.id,
    connectedBy: user.id,
    googleEmail: emailFromIdToken(token.id_token),
    refreshToken: token.refresh_token,
    scopes: (token.scope ?? "").split(" ").filter(Boolean),
  });

  const res = back("connected=1");
  res.cookies.delete("g_oauth_state");
  return res;
}
