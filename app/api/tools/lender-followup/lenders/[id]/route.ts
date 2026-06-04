// app/api/tools/lender-followup/lenders/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance, requireFinanceAdmin } from "@/lib/lender/access";

const toArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { departmentId } = await requireFinance();
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if ("owner" in body) patch.owner = body.owner ? String(body.owner) : null;
  if ("active" in body) patch.active = !!body.active;
  if ("aliases" in body) patch.aliases = toArray(body.aliases);
  if ("sender_domains" in body) patch.sender_domains = toArray(body.sender_domains).map((d) => d.toLowerCase());
  if ("known_sender_emails" in body) patch.known_sender_emails = toArray(body.known_sender_emails).map((e) => e.toLowerCase());

  const db = createAdminClient();
  const { data, error } = await db
    .from("lenders")
    .update(patch)
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lender: data });
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
    .from("lenders")
    .delete()
    .eq("id", id)
    .eq("department_id", departmentId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
