import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { staffDb } from "@/lib/owner";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ billId: string }> }
) {
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
    // 1. Try RPC record_bill_reprint
    const { data: rpcData, error: rpcError } = await db.rpc("record_bill_reprint", {
      p_bill_id: billId,
      p_metadata: metadata,
    });

    if (!rpcError && rpcData?.ok) {
      return NextResponse.json(rpcData);
    }

    // 2. Fallback insert
    const { data: bill, error: billErr } = await db
      .from("bills")
      .select("id, bill_number")
      .eq("id", billId)
      .maybeSingle();

    if (billErr || !bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const {
      data: { user },
    } = await db.auth.getUser();

    const { data: profile } = await db
      .from("admin_profiles")
      .select("role")
      .eq("user_id", user?.id)
      .maybeSingle();

    try {
      await db.from("bill_audit_events").insert({
        bill_id: bill.id,
        bill_number: bill.bill_number,
        event_type: "reprinted",
        actor_id: user?.id ?? null,
        actor_role: profile?.role ?? "staff",
        actor_email: user?.email ?? null,
        metadata,
      });
    } catch {
      // bill_audit_events table pending migration
    }

    return NextResponse.json({ ok: true, bill_number: bill.bill_number });
  } catch (err) {
    console.error("Reprint logging error:", err);
    return NextResponse.json({ error: "Failed to record reprint event" }, { status: 500 });
  }
}
