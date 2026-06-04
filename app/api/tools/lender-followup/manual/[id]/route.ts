import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";

// Edit a manual item's text.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { departmentId } = await requireFinance();
  const body = await req.json().catch(() => ({}));
  const item = typeof body?.item === "string" ? body.item.trim() : "";
  if (!item) return NextResponse.json({ error: "item is required" }, { status: 400 });

  const db = createAdminClient();
  const { data, error } = await db
    .from("lender_manual_items")
    .update({ item, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ id });
}

// Delete a manual item.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { departmentId } = await requireFinance();
  const db = createAdminClient();
  const { data, error } = await db
    .from("lender_manual_items")
    .delete()
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
