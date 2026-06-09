// app/api/tools/invoice-zoho/profiles/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance, requireFinanceAdmin } from "@/lib/lender/access";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { departmentId } = await requireFinance();
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if ("active" in body) patch.active = !!body.active;
  if ("constants" in body && body.constants && typeof body.constants === "object") patch.constants = body.constants;

  const db = createAdminClient();
  const { data, error } = await db
    .from("invoice_mapping_profiles")
    .update(patch)
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let departmentId: string;
  try {
    ({ departmentId } = await requireFinanceAdmin());
  } catch {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from("invoice_mapping_profiles")
    .delete()
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
