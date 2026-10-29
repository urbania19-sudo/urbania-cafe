import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";
import type { Bill } from "@/lib/billing";
import { getDailyServiceMetrics, parseReportSearch } from "@/lib/reports";
import { isPreviewDemoMode } from "@/lib/preview-demo";
import { DEMO_BILLS } from "@/lib/demo-fixtures";

export async function GET(req: NextRequest) {
  if (isPreviewDemoMode()) {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const startDate = searchParams.get("startDate")?.trim() || "";
    const endDate = searchParams.get("endDate")?.trim() || "";
    const orderSource = searchParams.get("orderSource") || "all";
    const status = searchParams.get("status") || "all";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

    const parsedSearch = parseReportSearch(search);
    let filtered = [...DEMO_BILLS];

    if (status !== "all") {
      filtered = filtered.filter((b) => b.status === status);
    }
    if (orderSource !== "all") {
      filtered = filtered.filter((b) => b.order_source === orderSource);
    }
    if (startDate) {
      filtered = filtered.filter((b) => b.issued_at >= `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      filtered = filtered.filter((b) => b.issued_at <= `${endDate}T23:59:59.999Z`);
    }
    if (parsedSearch.trimmed) {
      filtered = filtered.filter((b) => {
        if (parsedSearch.orderNumber !== null && b.order_number === parsedSearch.orderNumber) {
          return true;
        }
        if (b.bill_number.toLowerCase().includes(parsedSearch.trimmed.toLowerCase())) {
          return true;
        }
        if (b.customer_name?.toLowerCase().includes(parsedSearch.trimmed.toLowerCase())) {
          return true;
        }
        return false;
      });
    }

    const totalCount = filtered.length;
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    const issuedBills = filtered.filter((r) => r.status === "issued");
    const cancelledBills = filtered.filter((r) => r.status === "cancelled");
    const totalSalesPaise = issuedBills.reduce((acc, r) => acc + (r.total_paise || 0), 0);
    const totalTaxPaise = issuedBills.reduce((acc, r) => acc + (r.tax_paise || 0), 0);

    return NextResponse.json({
      ok: true,
      bills: paginated,
      totalCount,
      page,
      limit,
      isLegacySchema: false,
      unbilledOrder: null,
      searchedOrderNumber: parsedSearch.orderNumber,
      summary: {
        totalCount,
        issuedCount: issuedBills.length,
        cancelledCount: cancelledBills.length,
        totalSalesPaise,
        totalTaxPaise,
        todaySalesPaise: totalSalesPaise,
        todayBillCount: issuedBills.length,
        todayGrossSalesPaise: totalSalesPaise,
        todayDiscountsPaise: 0,
        todayNetSalesPaise: totalSalesPaise,
        todayCollectedPaise: totalSalesPaise,
        todayCashCollectedPaise: 0,
        todayOnlineCollectedPaise: totalSalesPaise,
        todayCustomerCollectedPaise: totalSalesPaise,
        todayCustomerOutstandingPaise: 0,
        todayRefundsPaise: 0,
        todayAdminCreditSettledTodayPaise: 0,
        todayExternalDeliveryCount: 0,
        todayExternalDeliveryPaise: 0,
        todayAdminCreditCount: 1,
        todayAdminCreditTotalPaise: 30800,
        todayAdminCreditOutstandingPaise: 30800,
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
  const orderSource = searchParams.get("orderSource") || "all";
  const status = searchParams.get("status") || "all";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
  const offset = (page - 1) * limit;

  try {
    let isLegacySchema = false;
    let rawBills: Record<string, unknown>[] = [];
    let totalCount = 0;

    // 1. Primary Query: Assumes Migration 0009 has been applied
    let primaryQuery = db
      .from("bills")
      .select("*, orders(customer_name, guest_count, service_mode, order_source)", {
        count: "exact",
      });

    if (status !== "all") primaryQuery = primaryQuery.eq("status", status);
    if (orderSource !== "all") primaryQuery = primaryQuery.eq("order_source", orderSource);
    if (startDate) primaryQuery = primaryQuery.gte("issued_at", `${startDate}T00:00:00.000Z`);
    if (endDate) primaryQuery = primaryQuery.lte("issued_at", `${endDate}T23:59:59.999Z`);
    const parsedSearch = parseReportSearch(search);
    if (parsedSearch.trimmed) {
      if (parsedSearch.orderNumber !== null) {
        primaryQuery = primaryQuery.or(
          `order_number.eq.${parsedSearch.orderNumber},bill_number.ilike.%${parsedSearch.trimmed}%,customer_name.ilike.%${parsedSearch.trimmed}%`
        );
      } else {
        primaryQuery = primaryQuery.or(
          `bill_number.ilike.%${parsedSearch.trimmed}%,customer_name.ilike.%${parsedSearch.trimmed}%`
        );
      }
    }

    const primaryRes = await primaryQuery
      .order("issued_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (!primaryRes.error) {
      rawBills = (primaryRes.data || []) as unknown as Record<string, unknown>[];
      totalCount = primaryRes.count ?? rawBills.length;
    } else {
      // 2. Backward-Compatibility Fallback: Target database has not yet run Migration 0009
      console.warn(
        "Primary bills report query failed (Migration 0009 pending on database). Falling back to backward-compatible query:",
        primaryRes.error.message
      );
      isLegacySchema = true;

      if (orderSource === "manual") {
        // In legacy schema, all historical orders were QR table orders; 0 manual orders exist
        rawBills = [];
        totalCount = 0;
      } else {
        // Fallback 1: Query bills with safe orders(customer_name, guest_count)
        let fallback1 = db
          .from("bills")
          .select("*, orders(customer_name, guest_count)", { count: "exact" });

        if (status !== "all") fallback1 = fallback1.eq("status", status);
        if (startDate) fallback1 = fallback1.gte("issued_at", `${startDate}T00:00:00.000Z`);
        if (endDate) fallback1 = fallback1.lte("issued_at", `${endDate}T23:59:59.999Z`);
        if (parsedSearch.trimmed) {
          if (parsedSearch.orderNumber !== null) {
            fallback1 = fallback1.or(`order_number.eq.${parsedSearch.orderNumber},bill_number.ilike.%${parsedSearch.trimmed}%`);
          } else {
            fallback1 = fallback1.ilike("bill_number", `%${parsedSearch.trimmed}%`);
          }
        }

        const res1 = await fallback1
          .order("issued_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (!res1.error) {
          rawBills = (res1.data || []) as unknown as Record<string, unknown>[];
          totalCount = res1.count ?? rawBills.length;
        } else {
          // Fallback 2: Direct bills query with no joins (guaranteed to succeed across all schemas)
          console.warn("Fallback 1 failed, trying direct bills query without joins:", res1.error.message);
          let fallback2 = db
            .from("bills")
            .select("*", { count: "exact" });

          if (status !== "all") fallback2 = fallback2.eq("status", status);
          if (startDate) fallback2 = fallback2.gte("issued_at", `${startDate}T00:00:00.000Z`);
          if (endDate) fallback2 = fallback2.lte("issued_at", `${endDate}T23:59:59.999Z`);
          if (parsedSearch.trimmed) {
            if (parsedSearch.orderNumber !== null) {
              fallback2 = fallback2.or(`order_number.eq.${parsedSearch.orderNumber},bill_number.ilike.%${parsedSearch.trimmed}%`);
            } else {
              fallback2 = fallback2.ilike("bill_number", `%${parsedSearch.trimmed}%`);
            }
          }

          const res2 = await fallback2
            .order("issued_at", { ascending: false })
            .range(offset, offset + limit - 1);

          if (res2.error) {
            console.error("Critical: direct bills query failed:", res2.error);
            return NextResponse.json(
              { error: `Failed to load bills: ${res2.error.message}` },
              { status: 500 }
            );
          }

          rawBills = (res2.data || []) as unknown as Record<string, unknown>[];
          totalCount = res2.count ?? rawBills.length;
        }
      }
    }

    // Check if an order exists in orders table when searching by order number but 0 bills were found
    let unbilledOrder: {
      id: string;
      orderNumber: number;
      status: string;
      customerName?: string | null;
      createdAt?: string;
    } | null = null;

    if (parsedSearch.orderNumber !== null && rawBills.length === 0) {
      const { data: matchedOrder } = await db
        .from("orders")
        .select("id, order_number, status, customer_name, created_at")
        .eq("order_number", parsedSearch.orderNumber)
        .maybeSingle();

      if (matchedOrder) {
        unbilledOrder = {
          id: matchedOrder.id,
          orderNumber: matchedOrder.order_number,
          status: matchedOrder.status,
          customerName: matchedOrder.customer_name,
          createdAt: matchedOrder.created_at,
        };
      }
    }

    // Normalized bill rows
    const bills: Bill[] = rawBills.map((b) => {
      const linkedOrder = b.orders as unknown as {
        customer_name?: string;
        guest_count?: number;
        service_mode?: string;
        order_source?: string;
      } | null;

      return {
        ...b,
        customer_name: (b.customer_name as string) || linkedOrder?.customer_name || null,
        guest_count: linkedOrder?.guest_count ?? 1,
        service_mode: ((b.service_mode as string) || linkedOrder?.service_mode || "dine_in") as "dine_in" | "takeaway" | "counter" | "delivery",
        order_source: ((b.order_source as string) || linkedOrder?.order_source || "qr") as "qr" | "manual",
      } as unknown as Bill;
    });

    // Calculate summary statistics
    let summaryQuery = db.from("bills").select("status, total_paise, tax_paise, issued_at");
    if (startDate) summaryQuery = summaryQuery.gte("issued_at", `${startDate}T00:00:00.000Z`);
    if (endDate) summaryQuery = summaryQuery.lte("issued_at", `${endDate}T23:59:59.999Z`);
    if (status !== "all") summaryQuery = summaryQuery.eq("status", status);
    if (!isLegacySchema && orderSource !== "all") {
      summaryQuery = summaryQuery.eq("order_source", orderSource);
    }

    const { data: summaryRows } = await summaryQuery;
    let allMatching = summaryRows || [];
    if (isLegacySchema && orderSource === "manual") {
      allMatching = [];
    }

    const issuedBills = allMatching.filter((r) => r.status === "issued");
    const cancelledBills = allMatching.filter((r) => r.status === "cancelled");
    const totalSalesPaise = issuedBills.reduce((acc, r) => acc + (r.total_paise || 0), 0);
    const totalTaxPaise = issuedBills.reduce((acc, r) => acc + (r.tax_paise || 0), 0);

    // Unified today's metrics using shared reporting layer
    const dailyMetrics = await getDailyServiceMetrics(db);

    return NextResponse.json({
      ok: true,
      bills,
      totalCount,
      page,
      limit,
      isLegacySchema,
      unbilledOrder,
      searchedOrderNumber: parsedSearch.orderNumber,
      summary: {
        totalCount,
        issuedCount: issuedBills.length,
        cancelledCount: cancelledBills.length,
        totalSalesPaise,
        totalTaxPaise,
        todaySalesPaise: dailyMetrics.netSalesPaise,
        todayBillCount: dailyMetrics.completedOrderCount,
        todayGrossSalesPaise: dailyMetrics.grossSalesPaise,
        todayDiscountsPaise: dailyMetrics.discountsPaise,
        todayNetSalesPaise: dailyMetrics.netSalesPaise,
        todayCollectedPaise: dailyMetrics.collectedPaise,
        todayCashCollectedPaise: dailyMetrics.cashCollectedPaise,
        todayOnlineCollectedPaise: dailyMetrics.onlineCollectedPaise,
        todayCustomerCollectedPaise: dailyMetrics.customerCollectedPaise,
        todayCustomerOutstandingPaise: dailyMetrics.customerOutstandingPaise,
        todayRefundsPaise: dailyMetrics.customerRefundsPaise,
        todayAdminCreditSettledTodayPaise: dailyMetrics.adminCreditSettledTodayPaise,
        todayExternalDeliveryCount: dailyMetrics.externalPlatformCount,
        todayExternalDeliveryPaise: dailyMetrics.externalPlatformValuePaise,
        todayAdminCreditCount: dailyMetrics.adminCreditCount,
        todayAdminCreditTotalPaise: dailyMetrics.adminCreditTotalPaise,
        todayAdminCreditOutstandingPaise: dailyMetrics.adminCreditOutstandingPaise,
      },
    });
  } catch (err) {
    console.error("API Error in /api/admin/reports/bills:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
