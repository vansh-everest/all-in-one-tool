import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";

// Edit a cell's text and/or toggle done.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { departmentId } = await requireFinance();
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body?.text === "string") patch.text = body.text;
  if (typeof body?.done === "boolean") patch.done = body.done;

  const db = createAdminClient();
  const { data, error } = await db
    .from("lender_items")
    .update(patch)
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ id });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { departmentId } = await requireFinance();
  const db = createAdminClient();
  const { data, error } = await db
    .from("lender_items")
    .delete()
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
