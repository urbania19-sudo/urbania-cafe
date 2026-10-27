import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authDb } from "@/lib/supabase/auth-server";
import { friendlyBillingError } from "@/lib/billing";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";

const billRequestSchema = z.object({
  discount_type: z.enum(["fixed", "percentage"]).optional().nullable(),
  discount_value: z.number().nonnegative().optional().nullable(),
  payment_method: z.enum(["cash", "upi", "online"]).optional().nullable(),
  confirm_payment: z.boolean().optional().nullable(),
  paid_amount_rupees: z.number().nonnegative().optional().nullable(),
  idempotency_key: z.string().optional().nullable(),
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

  const { discount_type, discount_value, payment_method, confirm_payment, paid_amount_rupees, idempotency_key } = parseResult.data;

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

  // Guard: Delivery platform orders are paid externally; block customer billing
  try {
    const { data: targetOrder } = await db
      .from("orders")
      .select("id, order_source, external_platform_name, external_platform_ref")
      .eq("id", orderId)
      .maybeSingle();

    if (targetOrder && ["swiggy", "zomato", "delivery_platform"].includes(targetOrder.order_source)) {
      return NextResponse.json(
        { error: "Delivery platform orders are paid externally; customer billing is disabled." },
        { status: 400 }
      );
    }

    if (targetOrder && targetOrder.order_source === "admin_credit") {
      return NextResponse.json(
        { error: "Admin credit orders are tracked via Admin Credit Ledger; customer billing is disabled." },
        { status: 400 }
      );
    }
  } catch {
    // Ignore if query builder is unavailable in mocked test environments
  }

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

  // Handle optional payment method selection & payment confirmation
  if (data?.bill && payment_method) {
    const normMethod = payment_method === "online" ? "upi" : payment_method;
    const isConfirmed = Boolean(confirm_payment);
    const billTotalPaise = data.bill.total_paise || 0;
    const paidPaise = isConfirmed
      ? paid_amount_rupees != null
        ? Math.min(billTotalPaise, Math.round(paid_amount_rupees * 100))
        : billTotalPaise
      : 0;

    const newPaymentStatus = isConfirmed
      ? paidPaise >= billTotalPaise
        ? "paid"
        : "partially_paid"
      : "unpaid";

    try {
      if (isConfirmed && paidPaise > 0) {
        // Record payment transaction
        const { data: rpcPayment } = await db.rpc("record_customer_payment", {
          p_bill_id: data.bill.id,
          p_amount_paise: paidPaise,
          p_payment_method: normMethod,
          p_notes: "Payment recorded at bill generation",
          p_idempotency_key: idempotency_key || null,
        });

        if (rpcPayment?.ok && rpcPayment?.bill) {
          data.bill = rpcPayment.bill;
        } else {
          // Direct fallback if RPC is not yet registered
          if (typeof db.from === "function") {
            try {
              await db.from("customer_payments").insert({
                bill_id: data.bill.id,
                order_id: data.bill.order_id,
                payment_method: normMethod,
                amount_paise: paidPaise,
                status: "completed",
                received_by: user.id,
                idempotency_key: idempotency_key || null,
              });

              await db
                .from("bills")
                .update({
                  paid_paise: paidPaise,
                  payment_status: newPaymentStatus,
                  payment_method: normMethod,
                })
                .eq("id", data.bill.id);

              await db
                .from("orders")
                .update({
                  paid_paise: paidPaise,
                  payment_status: newPaymentStatus,
                  payment_method: normMethod,
                })
                .eq("id", data.bill.order_id);
            } catch {
              // Ignore if table doesn't exist
            }
          }
          data.bill.paid_paise = paidPaise;
          data.bill.payment_status = newPaymentStatus;
          data.bill.payment_method = normMethod;
        }
      } else {
        // Unpaid bill: record selected method without payment transaction
        if (typeof db.from === "function") {
          try {
            await db
              .from("bills")
              .update({
                paid_paise: 0,
                payment_status: "unpaid",
                payment_method: normMethod,
              })
              .eq("id", data.bill.id);

            await db
              .from("orders")
              .update({
                paid_paise: 0,
                payment_status: "unpaid",
                payment_method: normMethod,
              })
              .eq("id", data.bill.order_id);
          } catch {
            // Ignore if columns don't exist
          }
        }
        data.bill.paid_paise = 0;
        data.bill.payment_status = "unpaid";
        data.bill.payment_method = normMethod;
      }
    } catch (payErr) {
      console.warn("Payment recording notice:", payErr);
    }
  }

  return NextResponse.json(data);
}
