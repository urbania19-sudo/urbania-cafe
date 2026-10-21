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
    // Authoritative atomic cancellation via database RPC.
    // Updates bill status, linked order status, and logs 'cancelled' audit event in one transaction.
    // If the RPC fails, we do NOT execute partial or non-atomic fallback updates.
    const { data: rpcData, error: rpcError } = await db.rpc("cancel_bill", {
      p_bill_id: billId,
      p_reason: reason,
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("URB:forbidden") || msg.includes("admin only")) {
        return NextResponse.json(
          { error: "Only administrators can cancel bills" },
          { status: 403 }
        );
      }
      if (msg.includes("URB:not_found") || rpcError.code === "PGRST116") {
        return NextResponse.json({ error: "Bill not found" }, { status: 404 });
      }
      if (rpcError.code === "PGRST202" || msg.includes("function public.cancel_bill")) {
        return NextResponse.json(
          { error: "Atomic cancellation requires database migration 0009 to be applied" },
          { status: 501 }
        );
      }
      return NextResponse.json(
        { error: friendlyBillingError(rpcError) },
        { status: 400 }
      );
    }

    if (!rpcData?.ok) {
      return NextResponse.json(
        { error: "Cancellation could not be completed" },
        { status: 400 }
      );
    }

    return NextResponse.json(rpcData);
  } catch (err) {
    console.error("Error cancelling bill:", err);
    return NextResponse.json(
      { error: friendlyBillingError(err) },
      { status: 500 }
    );
  }
}
