import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authDb } from "@/lib/supabase/auth-server";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";

const paymentSchema = z.object({
  payment_method: z.enum(["cash", "upi", "online"]),
  amount_rupees: z.number().positive().optional(),
  amount_paise: z.number().int().positive().optional(),
  notes: z.string().max(300).optional().nullable(),
  idempotency_key: z.string().max(100).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ billId: string }> }
) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const { billId } = await ctx.params;
  if (!z.string().uuid().safeParse(billId).success) {
    return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parseResult = paymentSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid payment details. Please specify a valid payment method (Cash or Online/UPI) and amount." },
      { status: 400 }
    );
  }

  const { payment_method, amount_rupees, amount_paise, notes, idempotency_key } = parseResult.data;
  const normalizedMethod = payment_method === "online" ? "upi" : payment_method;
  const targetAmountPaise = amount_paise ?? (amount_rupees != null ? Math.round(amount_rupees * 100) : 0);

  if (targetAmountPaise <= 0) {
    return NextResponse.json({ error: "Payment amount must be greater than zero." }, { status: 400 });
  }

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1. Attempt database RPC: record_customer_payment
  const { data: rpcData, error: rpcError } = await db.rpc("record_customer_payment", {
    p_bill_id: billId,
    p_amount_paise: targetAmountPaise,
    p_payment_method: normalizedMethod,
    p_notes: notes || null,
    p_idempotency_key: idempotency_key || null,
  });

  if (!rpcError && rpcData?.ok) {
    return NextResponse.json(rpcData);
  }

  // Handle specific RPC error messages
  if (rpcError) {
    const msg = rpcError.message || "";
    if (msg.includes("URB:amount_exceeds_remaining_balance")) {
      return NextResponse.json(
        { error: "Payment amount exceeds remaining balance on this bill." },
        { status: 400 }
      );
    }
    if (msg.includes("URB:cannot_pay_cancelled_bill")) {
      return NextResponse.json(
        { error: "Cannot record payment on a cancelled bill." },
        { status: 400 }
      );
    }
    if (msg.includes("URB:forbidden")) {
      return NextResponse.json({ error: "Forbidden: Staff or Admin role required." }, { status: 403 });
    }
  }

  // 2. Backward-compatible fallback for environments where RPC is not yet registered
  try {
    const { data: bill, error: billErr } = await db
      .from("bills")
      .select("*")
      .eq("id", billId)
      .maybeSingle();

    if (billErr || !bill) {
      return NextResponse.json({ error: "Bill not found." }, { status: 404 });
    }

    if (bill.status === "cancelled") {
      return NextResponse.json({ error: "Cannot record payment on a cancelled bill." }, { status: 400 });
    }

    const currentPaid = bill.paid_paise || 0;
    const remainingBalance = Math.max(0, bill.total_paise - currentPaid);

    if (targetAmountPaise > remainingBalance) {
      return NextResponse.json(
        { error: `Payment amount (₹${(targetAmountPaise / 100).toFixed(2)}) exceeds remaining balance (₹${(remainingBalance / 100).toFixed(2)}).` },
        { status: 400 }
      );
    }

    // Check idempotency in customer_payments if table exists
    if (idempotency_key) {
      const { data: existingPayment } = await db
        .from("customer_payments")
        .select("*")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();

      if (existingPayment) {
        return NextResponse.json({
          ok: true,
          already_recorded: true,
          payment: existingPayment,
          bill,
        });
      }
    }

    // Insert payment record
    const { data: paymentRecord, error: payErr } = await db
      .from("customer_payments")
      .insert({
        bill_id: bill.id,
        order_id: bill.order_id,
        payment_method: normalizedMethod,
        amount_paise: targetAmountPaise,
        status: "completed",
        notes: notes || null,
        received_by: user.id,
        idempotency_key: idempotency_key || null,
      })
      .select("*")
      .maybeSingle();

    const newPaidPaise = currentPaid + targetAmountPaise;
    const newStatus = newPaidPaise >= bill.total_paise ? "paid" : "partially_paid";

    const { data: updatedBill } = await db
      .from("bills")
      .update({
        paid_paise: newPaidPaise,
        payment_status: newStatus,
        payment_method: normalizedMethod,
      })
      .eq("id", bill.id)
      .select("*")
      .maybeSingle();

    await db
      .from("orders")
      .update({
        paid_paise: newPaidPaise,
        payment_status: newStatus,
        payment_method: normalizedMethod,
      })
      .eq("id", bill.order_id);

    return NextResponse.json({
      ok: true,
      already_recorded: false,
      payment: paymentRecord || {
        bill_id: bill.id,
        amount_paise: targetAmountPaise,
        payment_method: normalizedMethod,
      },
      bill: updatedBill || bill,
    });
  } catch (fallbackErr) {
    console.error("Fallback payment recording failed:", fallbackErr);
    return NextResponse.json(
      { error: "Failed to record customer payment." },
      { status: 500 }
    );
  }
}
