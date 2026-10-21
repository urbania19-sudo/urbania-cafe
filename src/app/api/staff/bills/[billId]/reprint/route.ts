import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { staffDb } from "@/lib/owner";
import { friendlyBillingError } from "@/lib/billing";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ billId: string }> }
) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const db = await staffDb();
  if (!db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { billId } = await ctx.params;
  if (!z.string().uuid().safeParse(billId).success) {
    return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const metadata = typeof body === "object" && body !== null ? body : {};

  try {
    // Authoritative reprint logging via database RPC.
    // Inspects returned database errors and never claims an audit event was recorded when it was not.
    const { data: rpcData, error: rpcError } = await db.rpc("record_bill_reprint", {
      p_bill_id: billId,
      p_metadata: metadata,
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("URB:forbidden") || msg.includes("staff only")) {
        return NextResponse.json(
          { error: "Staff permissions required to record reprint" },
          { status: 403 }
        );
      }
      if (msg.includes("URB:not_found") || rpcError.code === "PGRST116") {
        return NextResponse.json({ error: "Bill not found" }, { status: 404 });
      }
      if (
        rpcError.code === "PGRST202" ||
        msg.includes("record_bill_reprint") ||
        msg.includes("function public.record_bill_reprint")
      ) {
        return NextResponse.json(
          { error: "Reprint audit logging requires database migration 0009 to be applied" },
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
        { error: "Failed to record reprint event" },
        { status: 400 }
      );
    }

    return NextResponse.json(rpcData);
  } catch (err) {
    console.error("Reprint logging error:", err);
    return NextResponse.json(
      { error: friendlyBillingError(err) },
      { status: 500 }
    );
  }
}
