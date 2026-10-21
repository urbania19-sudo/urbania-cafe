import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";
import { exportBillItemsCsv } from "@/lib/csv";
import type { Bill } from "@/lib/billing";

export async function GET(req: NextRequest) {
  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() || "";
  const startDate = searchParams.get("startDate")?.trim() || "";
  const endDate = searchParams.get("endDate")?.trim() || "";
  const orderSource = searchParams.get("orderSource") || "all";
  const status = searchParams.get("status") || "all";

  try {
    let query = db
      .from("bills")
      .select("*, orders(customer_name, guest_count, service_mode, order_source)")
      .order("issued_at", { ascending: false })
      .limit(1000);

    if (status !== "all") query = query.eq("status", status);
    if (orderSource !== "all") query = query.eq("order_source", orderSource);
    if (startDate) query = query.gte("issued_at", `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.lte("issued_at", `${endDate}T23:59:59.999Z`);
    if (search) {
      const isNum = /^[0-9]+$/.test(search);
      if (isNum) {
        query = query.or(
          `bill_number.ilike.%${search}%,order_number.eq.${search},customer_name.ilike.%${search}%`,
        );
      } else {
        query = query.or(`bill_number.ilike.%${search}%,customer_name.ilike.%${search}%`);
      }
    }

    const { data: rawBills, error } = await query;
    if (error) {
      console.error("CSV Items Export error:", error);
      return NextResponse.json({ error: "Export query failed" }, { status: 500 });
    }

    const bills: Bill[] = (rawBills || []).map((b) => b as Bill);
    const csvData = exportBillItemsCsv(bills);
    const filename = `urbania-bill-items-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csvData, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("Items CSV route error:", err);
    return NextResponse.json({ error: "Failed to generate CSV" }, { status: 500 });
  }
}
