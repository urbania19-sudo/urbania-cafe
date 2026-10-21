import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";
import { exportAuditEventsCsv } from "@/lib/csv";
import type { BillAuditEvent } from "@/lib/billing";

export async function GET(req: NextRequest) {
  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() || "";
  const startDate = searchParams.get("startDate")?.trim() || "";
  const endDate = searchParams.get("endDate")?.trim() || "";
  const eventType = searchParams.get("eventType") || "all";
  const billId = searchParams.get("billId")?.trim() || "";

  try {
    let query = db
      .from("bill_audit_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000);

    if (eventType !== "all") query = query.eq("event_type", eventType);
    if (billId) query = query.eq("bill_id", billId);
    if (startDate) query = query.gte("created_at", `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.lte("created_at", `${endDate}T23:59:59.999Z`);
    if (search) {
      query = query.or(`bill_number.ilike.%${search}%,actor_email.ilike.%${search}%`);
    }

    const { data: events, error } = await query;
    if (error) {
      console.error("Audit Events CSV error:", error);
      return NextResponse.json({ error: "Audit export query failed" }, { status: 500 });
    }

    const csvData = exportAuditEventsCsv((events || []) as BillAuditEvent[]);
    const filename = `urbania-audit-events-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csvData, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("Events CSV route error:", err);
    return NextResponse.json({ error: "Failed to generate CSV" }, { status: 500 });
  }
}
