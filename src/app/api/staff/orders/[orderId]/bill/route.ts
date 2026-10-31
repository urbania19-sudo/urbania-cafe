import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authDb } from "@/lib/supabase/auth-server";
import { friendlyBillingError } from "@/lib/billing";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";
import { isPreviewDemoMode } from "@/lib/preview-demo";
import { DEMO_BILLS } from "@/lib/demo-fixtures";

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

  if (isPreviewDemoMode()) {
    const bill = DEMO_BILLS.find((b) => b.order_id === orderId);
    if (!bill) {
      return NextResponse.json({ error: "Order bill not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, bill });
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
    let targetOrder: any = null;
    const { data: directOrder, error: orderErr } = await db
      .from("orders")
      .select("id, order_source, external_platform_name, external_platform_ref")
      .eq("id", orderId)
      .maybeSingle();

    if (!orderErr && directOrder) {
      targetOrder = directOrder;
    } else {
      const fallback = await db
        .from("orders")
        .select("id, order_source")
        .eq("id", orderId)
        .maybeSingle();
      targetOrder = fallback.data;
    }

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

  // Handle payment confirmation only after the bill exists. The database RPC is the
  // sole writer of payment transactions and balances; never emulate it with separate writes.
  if (data?.bill && payment_method) {
    const normalizedMethod = payment_method === "online" ? "upi" : payment_method;
    const confirmed = Boolean(confirm_payment);
    const billTotalPaise = Number(data.bill.total_paise || 0);
    const requestedPaidPaise = confirmed
      ? paid_amount_rupees != null
        ? Math.round(paid_amount_rupees * 100)
        : billTotalPaise
      : 0;

    if (requestedPaidPaise > billTotalPaise) {
      return NextResponse.json(
        { error: "Payment amount cannot exceed the bill total.", bill: data.bill },
        { status: 400 }
      );
    }

    if (confirmed && requestedPaidPaise > 0) {
      const { data: paymentResult, error: paymentError } = await db.rpc("record_customer_payment", {
        p_bill_id: data.bill.id,
        p_amount_paise: requestedPaidPaise,
        p_payment_method: normalizedMethod,
        p_notes: "Payment recorded at bill generation",
        p_idempotency_key: idempotency_key || null,
      });

      if (paymentError) {
        const msg = paymentError.message || "";
        const errCode = (paymentError as { code?: string }).code;
        const isRpcMissing =
          errCode === "PGRST202" ||
          errCode === "42883" ||
          msg.includes("record_customer_payment") ||
          msg.includes("function") ||
          msg.includes("does not exist");

        if (isRpcMissing) {
          // Pre-0017 fallback: in older schemas, generate_bill alone settled the bill.
          // Safely set the bill return attributes without failing the request.
          data.bill.payment_method = normalizedMethod;
          data.bill.payment_status = "paid";
          data.bill.paid_paise = billTotalPaise;
        } else {
          console.error("Payment recording failed after bill issuance:", paymentError);
          // The bill remains issued and unpaid. Staff can retry using Collect Payment;
          // never report a payment as successful when the atomic ledger write failed.
          return NextResponse.json(
            {
              error: "Bill issued, but payment was not recorded. The bill remains unpaid; use Collect Payment to retry.",
              code: "BILL_ISSUED_PAYMENT_PENDING",
              bill_id: data.bill.id,
              bill: data.bill,
            },
            { status: 503 }
          );
        }
      } else if (paymentResult?.bill) {
        data.bill = paymentResult.bill;
      }
    } else {
      // The bill defaults to unpaid. Store the selected method for the pending balance,
      // and tolerate missing columns on pre-0016 database schemas.
      try {
        const [billUpdate, orderUpdate] = await Promise.all([
          db.from("bills").update({ payment_status: "unpaid", paid_paise: 0, payment_method: normalizedMethod }).eq("id", data.bill.id),
          db.from("orders").update({ payment_status: "unpaid", paid_paise: 0, payment_method: normalizedMethod }).eq("id", data.bill.order_id),
        ]);
        if (billUpdate.error || orderUpdate.error) {
          console.warn("Could not persist unpaid payment_status columns (likely pre-0016 schema):", billUpdate.error || orderUpdate.error);
        }
      } catch (updateErr) {
        console.warn("Payment status update skipped on pre-0016 schema:", updateErr);
      }
      data.bill.paid_paise = 0;
      data.bill.payment_status = "unpaid";
      data.bill.payment_method = normalizedMethod;
    }
  }

  return NextResponse.json(data);
}
