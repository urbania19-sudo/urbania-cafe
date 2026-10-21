import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authDb } from "@/lib/supabase/auth-server";
import { friendlyBillingError } from "@/lib/billing";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await ctx.params;
  if (!z.string().uuid().safeParse(orderId).success) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: bill, error } = await db
    .from("bills")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: friendlyBillingError(error) }, { status: 400 });
  }

  return NextResponse.json({ bill });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const { orderId } = await ctx.params;
  if (!z.string().uuid().safeParse(orderId).success) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await db.rpc("generate_bill", { p_order_id: orderId });

  if (error) {
    return NextResponse.json({ error: friendlyBillingError(error) }, { status: 400 });
  }

  return NextResponse.json(data);
}
