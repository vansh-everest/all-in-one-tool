import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";

// Add a manual tracker item to a lender's column.
export async function POST(req: NextRequest) {
  const { departmentId, email } = await requireFinance();
  const body = await req.json().catch(() => ({}));
  const item = typeof body?.item === "string" ? body.item.trim() : "";
  const lenderId = typeof body?.lenderId === "string" ? body.lenderId : null;
  if (!item) return NextResponse.json({ error: "item is required" }, { status: 400 });
  if (!lenderId) return NextResponse.json({ error: "lenderId is required" }, { status: 400 });

  const db = createAdminClient();
  const { data, error } = await db
    .from("lender_manual_items")
    .insert({ department_id: departmentId, lender_id: lenderId, item, created_by_email: email })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
