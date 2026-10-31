import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";
import { exportAuditEventsCsv } from "@/lib/csv";
import type { BillAuditEvent } from "@/lib/billing";
import { isPreviewDemoMode } from "@/lib/preview-demo";
import { DEMO_BILL_EVENTS } from "@/lib/demo-fixtures";

export async function GET(req: NextRequest) {
  if (isPreviewDemoMode()) {
    const csvContent = exportAuditEventsCsv(DEMO_BILL_EVENTS);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `urbania-audit-events-demo-${dateStr}.csv`;
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

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

    if (billId) query = query.eq("bill_id", billId);
    if (eventType !== "all") query = query.eq("event_type", eventType);
    if (startDate) query = query.gte("created_at", `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.lte("created_at", `${endDate}T23:59:59.999Z`);
    if (search) {
      query = query.or(`bill_number.ilike.%${search}%,actor_email.ilike.%${search}%`);
    }

    const { data: events, error } = await query;
    if (error) {
      console.warn("Audit events export query error (schema pending):", error.message);
      return new NextResponse(exportAuditEventsCsv([]), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="urbania-audit-events-empty.csv"`,
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }

    const csvContent = exportAuditEventsCsv((events || []) as BillAuditEvent[]);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `urbania-audit-events-${dateStr}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("CSV Export error for audit events:", err);
    return NextResponse.json({ error: "Export generation failed" }, { status: 500 });
  }
}
