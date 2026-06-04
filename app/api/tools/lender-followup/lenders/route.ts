// app/api/tools/lender-followup/lenders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";

export async function GET() {
  const { departmentId } = await requireFinance();
  const db = createAdminClient();
  const { data } = await db
    .from("lenders")
    .select("*")
    .eq("department_id", departmentId)
    .order("name");
  return NextResponse.json({ lenders: data ?? [] });
}

const toArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

export async function POST(req: NextRequest) {
  const { departmentId } = await requireFinance();
  const body = await req.json();
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from("lenders")
    .insert({
      department_id: departmentId,
      name: body.name.trim(),
      aliases: toArray(body.aliases),
      sender_domains: toArray(body.sender_domains).map((d) => d.toLowerCase()),
      known_sender_emails: toArray(body.known_sender_emails).map((e) => e.toLowerCase()),
      owner: body.owner ? String(body.owner) : null,
      active: body.active !== false,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lender: data });
}
