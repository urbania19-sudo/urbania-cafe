import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";
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
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
  const offset = (page - 1) * limit;

  try {
    let query = db
      .from("bills")
      .select("*, orders(customer_name, guest_count, service_mode, order_source)", {
        count: "exact",
      });

    if (status !== "all") {
      query = query.eq("status", status);
    }

    if (orderSource !== "all") {
      query = query.eq("order_source", orderSource);
    }

    if (startDate) {
      query = query.gte("issued_at", `${startDate}T00:00:00.000Z`);
    }

    if (endDate) {
      query = query.lte("issued_at", `${endDate}T23:59:59.999Z`);
    }

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

    const { data: rawBills, count, error } = await query
      .order("issued_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Error fetching bills for reports:", error);
      return NextResponse.json({ error: "Failed to load bills" }, { status: 500 });
    }

    // Normalized bill rows
    const bills: Bill[] = (rawBills || []).map((b) => {
      const linkedOrder = b.orders as unknown as {
        customer_name?: string;
        guest_count?: number;
        service_mode?: string;
        order_source?: string;
      } | null;

      return {
        ...b,
        customer_name: b.customer_name || linkedOrder?.customer_name || null,
        guest_count: linkedOrder?.guest_count ?? 1,
        service_mode: b.service_mode || linkedOrder?.service_mode || "dine_in",
        order_source: b.order_source || linkedOrder?.order_source || "qr",
      } as Bill;
    });

    // Calculate summary statistics
    let summaryQuery = db.from("bills").select("status, total_paise, tax_paise, issued_at");
    if (startDate) summaryQuery = summaryQuery.gte("issued_at", `${startDate}T00:00:00.000Z`);
    if (endDate) summaryQuery = summaryQuery.lte("issued_at", `${endDate}T23:59:59.999Z`);
    if (orderSource !== "all") summaryQuery = summaryQuery.eq("order_source", orderSource);
    if (status !== "all") summaryQuery = summaryQuery.eq("status", status);

    const { data: summaryRows } = await summaryQuery;
    const allMatching = summaryRows || [];

    const issuedBills = allMatching.filter((r) => r.status === "issued");
    const cancelledBills = allMatching.filter((r) => r.status === "cancelled");
    const totalSalesPaise = issuedBills.reduce((acc, r) => acc + (r.total_paise || 0), 0);
    const totalTaxPaise = issuedBills.reduce((acc, r) => acc + (r.tax_paise || 0), 0);

    // Today's metrics (Asia/Kolkata date boundary)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const todayIstStr = istNow.toISOString().slice(0, 10);

    const todayIssued = allMatching.filter((r) => {
      if (r.status !== "issued") return false;
      const bDate = new Date(new Date(r.issued_at).getTime() + istOffset);
      return bDate.toISOString().slice(0, 10) === todayIstStr;
    });

    const todaySalesPaise = todayIssued.reduce((acc, r) => acc + (r.total_paise || 0), 0);
    const todayBillCount = todayIssued.length;

    return NextResponse.json({
      ok: true,
      bills,
      totalCount: count ?? bills.length,
      page,
      limit,
      summary: {
        totalCount: count ?? bills.length,
        issuedCount: issuedBills.length,
        cancelledCount: cancelledBills.length,
        totalSalesPaise,
        totalTaxPaise,
        todaySalesPaise,
        todayBillCount,
      },
    });
  } catch (err) {
    console.error("API Error in /api/admin/reports/bills:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
