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

  // Explicitly reject refund and partial-refund operations. Reversals and partial
  // refunds require a dedicated append-only refund ledger and must not be treated as payments.
  const rawObj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (
    rawObj.action === "refund" ||
    rawObj.type === "refund" ||
    rawObj.refund === true ||
    rawObj.is_refund === true ||
    "refund_amount_paise" in rawObj ||
    "refund_paise" in rawObj ||
    "refund_amount_rupees" in rawObj
  ) {
    return NextResponse.json(
      { error: "Refunds and partial refunds are not supported. Reversals must be recorded through an authorized ledger workflow." },
      { status: 400 }
    );
  }

  const parseResult = paymentSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid payment details. Please specify a valid payment method (Cash or Online/UPI) and a positive amount. Negative amounts and refunds are not supported." },
      { status: 400 }
    );
  }

  const { payment_method, amount_rupees, amount_paise, notes, idempotency_key } = parseResult.data;
  const normalizedMethod = payment_method === "online" ? "upi" : payment_method;
  const targetAmountPaise = amount_paise ?? (amount_rupees != null ? Math.round(amount_rupees * 100) : 0);

  if (targetAmountPaise <= 0) {
    return NextResponse.json({ error: "Payment amount must be greater than zero. Negative amounts and refunds are not supported." }, { status: 400 });
  }

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Payment recording must remain atomic in PostgreSQL. Never fall back to separate
  // INSERT/UPDATE requests: concurrent payments or partial failures can corrupt balances.
  const { data: rpcData, error: rpcError } = await db.rpc("record_customer_payment", {
    p_bill_id: billId,
    p_amount_paise: targetAmountPaise,
    p_payment_method: normalizedMethod,
    p_notes: notes || null,
    p_idempotency_key: idempotency_key || null,
  });

  if (rpcError) {
    const msg = rpcError.message || "";
    if (msg.includes("URB:amount_exceeds_remaining_balance")) {
      return NextResponse.json({ error: "Payment amount exceeds remaining balance on this bill." }, { status: 400 });
    }
    if (msg.includes("URB:cannot_pay_cancelled_bill")) {
      return NextResponse.json({ error: "Cannot record payment on a cancelled bill." }, { status: 400 });
    }
    if (msg.includes("URB:forbidden")) {
      return NextResponse.json({ error: "Forbidden: Staff or Admin role required." }, { status: 403 });
    }
    if (msg.includes("URB:idempotency_conflict")) {
      return NextResponse.json({ error: "This payment retry key was already used for different payment details." }, { status: 409 });
    }
    if (msg.includes("URB:invalid_amount") || msg.includes("URB:invalid_payment_method")) {
      return NextResponse.json({ error: "Invalid payment amount or method." }, { status: 400 });
    }
    if (msg.includes("URB:not_found")) {
      return NextResponse.json({ error: "Bill not found." }, { status: 404 });
    }
    if ((rpcError as { code?: string }).code === "PGRST202" ||
        (rpcError as { code?: string }).code === "42883" ||
        msg.toLowerCase().includes("function public.record_customer_payment")) {
      return NextResponse.json(
        { error: "Payment recording is not configured. Apply database migration 0017 before collecting payments." },
        { status: 503 }
      );
    }
    console.error("Atomic customer payment RPC failed:", rpcError);
    return NextResponse.json(
      { error: "Payment was not recorded. Please retry after checking the bill balance." },
      { status: 500 }
    );
  }

  if (!rpcData?.ok) {
    console.error("Atomic customer payment RPC returned an unexpected response.");
    return NextResponse.json(
      { error: "Payment recording could not be confirmed. Please check the bill before retrying." },
      { status: 500 }
    );
  }

  return NextResponse.json(rpcData);
}
