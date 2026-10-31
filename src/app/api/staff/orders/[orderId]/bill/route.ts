import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authDb } from "@/lib/supabase/auth-server";
import { friendlyBillingError } from "@/lib/billing";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";

const billRequestSchema = z.object({
  discount_type: z.enum(["fixed", "percentage"]).optional().nullable(),
  discount_value: z.number().nonnegative().optional().nullable(),
});

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

  return NextResponse.json({ ok: true, bill });
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

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parseResult = billRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid discount details. Please check discount type and value." },
      { status: 400 }
    );
  }

  const { discount_type, discount_value } = parseResult.data;

  // Validate discount values
  if (discount_type && discount_value != null && discount_value > 0) {
    if (discount_type === "percentage" && discount_value > 100) {
      return NextResponse.json(
        { error: "Percentage discount must be between 0 and 100" },
        { status: 400 }
      );
    }
  }

  const hasActiveDiscount = Boolean(discount_type && discount_value != null && discount_value > 0);

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let { data, error } = await db.rpc("generate_bill", {
    p_order_id: orderId,
    p_discount_type: hasActiveDiscount ? discount_type : null,
    p_discount_value: hasActiveDiscount ? discount_value : null,
  });

  // Backward-compatible fallback for DB environments where Migration 0012 is not yet applied
  // and no discount was active
  if (
    error &&
    !hasActiveDiscount &&
    (error.message?.includes("function") ||
      error.message?.includes("parameters") ||
      (error as { code?: string }).code === "PGRST202")
  ) {
    const fallbackRes = await db.rpc("generate_bill", { p_order_id: orderId });
    if (!fallbackRes.error) {
      data = fallbackRes.data;
      error = null;
    }
  }

  if (error) {
    return NextResponse.json({ error: friendlyBillingError(error) }, { status: 400 });
  }

  return NextResponse.json(data);
}
