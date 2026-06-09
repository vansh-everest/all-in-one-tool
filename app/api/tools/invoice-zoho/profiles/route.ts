// app/api/tools/invoice-zoho/profiles/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";

export async function GET() {
  const { departmentId } = await requireFinance();
  const db = createAdminClient();
  const { data } = await db
    .from("invoice_mapping_profiles")
    .select("*")
    .eq("department_id", departmentId)
    .order("created_at");
  return NextResponse.json({ profiles: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { departmentId } = await requireFinance();
  const body = await req.json().catch(() => ({}));
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const constants = body.constants && typeof body.constants === "object" ? body.constants : {};
  const db = createAdminClient();
  const { data, error } = await db
    .from("invoice_mapping_profiles")
    .insert({
      department_id: departmentId,
      name: body.name.trim(),
      constants,
      active: body.active !== false,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
