import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAccounting } from "@/lib/scrap-scale/access";
import { DEFAULT_CONSTANTS } from "@/lib/invoice/schema";

export async function GET() {
  const { departmentId } = await requireAccounting();
  const db = createAdminClient();
  let { data: profiles } = await db.from("invoice_mapping_profiles").select("*").eq("department_id", departmentId).order("created_at");
  if (!profiles?.length) {
    const { data: seeded } = await db.from("invoice_mapping_profiles").insert({ department_id: departmentId, name: "Car Rental", constants: DEFAULT_CONSTANTS, active: true }).select("*").single();
    profiles = seeded ? [seeded] : [];
  }
  let { data: config } = await db.from("invoice_config").select("*").eq("department_id", departmentId).maybeSingle();
  if (!config) {
    const { data: c } = await db.from("invoice_config").insert({ department_id: departmentId, profile_id: profiles[0]?.id ?? null }).select("*").single();
    config = c;
  }
  return NextResponse.json({ config, profiles });
}

export async function POST(req: NextRequest) {
  const { departmentId } = await requireAccounting();
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { department_id: departmentId, updated_at: new Date().toISOString() };
  if (typeof body.gmail_label === "string") patch.gmail_label = body.gmail_label.trim();
  if (typeof body.profile_id === "string") patch.profile_id = body.profile_id;
  if (typeof body.last_run_date === "string" || body.last_run_date === null) patch.last_run_date = body.last_run_date;
  const db = createAdminClient();
  const { data, error } = await db.from("invoice_config").upsert(patch, { onConflict: "department_id" }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
