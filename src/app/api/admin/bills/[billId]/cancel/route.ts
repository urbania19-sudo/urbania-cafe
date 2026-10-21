import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { owner } from "@/lib/owner";
import { friendlyBillingError } from "@/lib/billing";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";

const cancelSchema = z.object({
  reason: z.string().max(300).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ billId: string }> }
) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { billId } = await ctx.params;
  if (!z.string().uuid().safeParse(billId).success) {
    return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid cancellation reason" }, { status: 400 });
  }

  const reason = parsed.data.reason?.trim() || "Voided by admin";

  try {
    // 1. Try RPC cancel_bill
    const { data: rpcData, error: rpcError } = await db.rpc("cancel_bill", {
      p_bill_id: billId,
      p_reason: reason,
    });

    if (!rpcError && rpcData?.ok) {
      return NextResponse.json(rpcData);
    }

    // 2. Graceful fallback if RPC is not yet registered in database
    const { data: bill, error: fetchErr } = await db
      .from("bills")
      .select("*")
      .eq("id", billId)
      .maybeSingle();

    if (fetchErr || !bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    if (bill.status === "cancelled") {
      return NextResponse.json({ ok: true, already_cancelled: true, bill });
    }

    const {
      data: { user },
    } = await db.auth.getUser();

    const { data: updatedBill, error: updateErr } = await db
      .from("bills")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id ?? null,
        cancellation_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", billId)
      .select()
      .single();

    let finalBill = updatedBill;
    if (updateErr) {
      // Fallback for pre-migration-0009 schema (update status & updated_at only)
      const { data: legacyBill, error: legacyErr } = await db
        .from("bills")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", billId)
        .select()
        .single();

      if (legacyErr) {
        return NextResponse.json(
          { error: friendlyBillingError(legacyErr) },
          { status: 500 }
        );
      }
      finalBill = legacyBill;
    }

    // Cancel linked order
    const orderUpdate = await db
      .from("orders")
      .update({
        status: "CANCELLED",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: `Bill ${bill.bill_number} cancelled: ${reason}`,
      })
      .eq("id", bill.order_id);

    if (orderUpdate.error) {
      await db.from("orders").update({ status: "CANCELLED" }).eq("id", bill.order_id);
    }

    // Record audit event if table exists
    try {
      await db.from("bill_audit_events").insert({
        bill_id: bill.id,
        bill_number: bill.bill_number,
        event_type: "cancelled",
        actor_id: user?.id ?? null,
        actor_role: "admin",
        actor_email: user?.email ?? null,
        metadata: { reason, order_number: bill.order_number, total_paise: bill.total_paise },
      });
    } catch {
      // bill_audit_events table pending migration
    }

    return NextResponse.json({ ok: true, bill: finalBill });
  } catch (err) {
    console.error("Error cancelling bill:", err);
    return NextResponse.json(
      { error: friendlyBillingError(err) },
      { status: 500 }
    );
  }
}
