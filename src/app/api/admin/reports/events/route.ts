import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";

export async function GET(req: NextRequest) {
  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const billId = searchParams.get("billId")?.trim();
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));

  try {
    let query = db.from("bill_audit_events").select("*").order("created_at", { ascending: false }).limit(limit);

    if (billId) {
      query = query.eq("bill_id", billId);
    }

    const { data: events, error } = await query;
    if (error) {
      console.error("Error fetching audit events:", error);
      return NextResponse.json({ error: "Failed to load audit events" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, events: events || [] });
  } catch (err) {
    console.error("API error in /api/admin/reports/events:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
