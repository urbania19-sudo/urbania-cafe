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
    if (search) {
      const isNum = /^[0-9]+$/.test(search);
      if (isNum) {
        primaryQuery = primaryQuery.or(
          `bill_number.ilike.%${search}%,order_number.eq.${search},customer_name.ilike.%${search}%`
        );
      } else {
        primaryQuery = primaryQuery.or(`bill_number.ilike.%${search}%,customer_name.ilike.%${search}%`);
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
        if (search) {
          const isNum = /^[0-9]+$/.test(search);
          if (isNum) {
            fallback1 = fallback1.or(`bill_number.ilike.%${search}%,order_number.eq.${search}`);
          } else {
            fallback1 = fallback1.ilike("bill_number", `%${search}%`);
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
          if (search) {
            const isNum = /^[0-9]+$/.test(search);
            if (isNum) {
              fallback2 = fallback2.or(`bill_number.ilike.%${search}%,order_number.eq.${search}`);
            } else {
              fallback2 = fallback2.ilike("bill_number", `%${search}%`);
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
      totalCount,
      page,
      limit,
      isLegacySchema,
      summary: {
        totalCount,
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
