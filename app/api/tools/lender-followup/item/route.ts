import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireFinance } from "@/lib/lender/access";

// Add a tracker item to a lender's column (Excel-style add).
export async function POST(req: NextRequest) {
  const { departmentId } = await requireFinance();
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const lenderId = typeof body?.lenderId === "string" ? body.lenderId : null;
  if (!lenderId) return NextResponse.json({ error: "lenderId is required" }, { status: 400 });

  const db = createAdminClient();
  const { data, error } = await db
    .from("lender_items")
    .insert({ department_id: departmentId, lender_id: lenderId, text, source: "manual", position: 1000 })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
