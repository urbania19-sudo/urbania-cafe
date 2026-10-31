import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";
import { isPreviewDemoMode } from "@/lib/preview-demo";
import { DEMO_BILL_EVENTS } from "@/lib/demo-fixtures";

export async function GET(req: NextRequest) {
  if (isPreviewDemoMode()) {
    const { searchParams } = new URL(req.url);
    const billId = searchParams.get("billId")?.trim();
    let events = DEMO_BILL_EVENTS;
    if (billId) {
      events = events.filter((e) => e.bill_id === billId);
    }
    return NextResponse.json({ ok: true, events, isLegacySchema: false });
  }

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
      // If table does not exist (relation does not exist on legacy schema)
      console.warn("Audit events query note (Migration 0009 pending on database):", error.message);
      return NextResponse.json({ ok: true, events: [], isLegacySchema: true });
    }

    return NextResponse.json({ ok: true, events: events || [], isLegacySchema: false });
  } catch (err) {
    console.error("API error in /api/admin/reports/events:", err);
    return NextResponse.json({ ok: true, events: [], isLegacySchema: true });
  }
}
