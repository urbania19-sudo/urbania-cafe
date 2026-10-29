import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";
import { parseReportSearch } from "@/lib/reports";
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
    let rawBills: Record<string, unknown>[] = [];

    // 1. Primary Query: Try modern schema (Migration 0009)
    let primaryQuery = db
      .from("bills")
      .select("*, orders(customer_name, guest_count, service_mode, order_source)")
      .order("issued_at", { ascending: false })
      .limit(1000);

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

    const primaryRes = await primaryQuery;

    if (!primaryRes.error) {
      rawBills = (primaryRes.data || []) as unknown as Record<string, unknown>[];
    } else {
      console.warn("Primary items CSV export query failed, falling back to legacy schema query:", primaryRes.error.message);

      if (orderSource === "manual") {
        rawBills = [];
      } else {
        // Fallback 1: Query bills with safe orders(customer_name, guest_count)
        let fallback1 = db
          .from("bills")
          .select("*, orders(customer_name, guest_count)")
          .order("issued_at", { ascending: false })
          .limit(1000);

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

        const res1 = await fallback1;
        if (!res1.error) {
          rawBills = (res1.data || []) as unknown as Record<string, unknown>[];
        } else {
          // Fallback 2: Direct bills query with no joins
          let fallback2 = db
            .from("bills")
            .select("*")
            .order("issued_at", { ascending: false })
            .limit(1000);

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

          const res2 = await fallback2;
          if (res2.error) {
            return NextResponse.json({ error: `Export query failed: ${res2.error.message}` }, { status: 500 });
          }
          rawBills = (res2.data || []) as unknown as Record<string, unknown>[];
        }
      }
    }

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

    const csvContent = exportBillItemsCsv(bills);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `urbania-bill-items-${dateStr}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("CSV Items Export error:", err);
    return NextResponse.json({ error: "Export generation failed" }, { status: 500 });
  }
}
