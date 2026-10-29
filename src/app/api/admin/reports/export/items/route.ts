import { NextRequest, NextResponse } from "next/server";
import { owner } from "@/lib/owner";
import { parseReportSearch } from "@/lib/reports";
import { exportBillItemsCsv } from "@/lib/csv";
import type { Bill } from "@/lib/billing";
import { isPreviewDemoMode } from "@/lib/preview-demo";
import { DEMO_BILLS } from "@/lib/demo-fixtures";

export async function GET(req: NextRequest) {
  if (isPreviewDemoMode()) {
    const csvContent = exportBillItemsCsv(DEMO_BILLS);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `urbania-bill-items-demo-${dateStr}.csv`;
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
      // 2. Backward-Compatibility Fallback: Try query without order_source/service_mode joins
      console.warn("Primary item export query failed, falling back to legacy schema query:", primaryRes.error.message);
      if (orderSource === "manual") {
        rawBills = [];
      } else {
        let fallbackQuery = db
          .from("bills")
          .select("*, orders(customer_name, guest_count)")
          .order("issued_at", { ascending: false })
          .limit(1000);

        if (status !== "all") fallbackQuery = fallbackQuery.eq("status", status);
        if (startDate) fallbackQuery = fallbackQuery.gte("issued_at", `${startDate}T00:00:00.000Z`);
        if (endDate) fallbackQuery = fallbackQuery.lte("issued_at", `${endDate}T23:59:59.999Z`);
        if (parsedSearch.trimmed) {
          if (parsedSearch.orderNumber !== null) {
            fallbackQuery = fallbackQuery.or(`order_number.eq.${parsedSearch.orderNumber},bill_number.ilike.%${parsedSearch.trimmed}%`);
          } else {
            fallbackQuery = fallbackQuery.ilike("bill_number", `%${parsedSearch.trimmed}%`);
          }
        }

        const fallbackRes = await fallbackQuery;
        if (!fallbackRes.error) {
          rawBills = (fallbackRes.data || []) as unknown as Record<string, unknown>[];
        } else {
          // Fallback to direct bills table
          let directQuery = db
            .from("bills")
            .select("*")
            .order("issued_at", { ascending: false })
            .limit(1000);

          if (status !== "all") directQuery = directQuery.eq("status", status);
          if (startDate) directQuery = directQuery.gte("issued_at", `${startDate}T00:00:00.000Z`);
          if (endDate) directQuery = directQuery.lte("issued_at", `${endDate}T23:59:59.999Z`);
          if (parsedSearch.trimmed) {
            if (parsedSearch.orderNumber !== null) {
              directQuery = directQuery.or(`order_number.eq.${parsedSearch.orderNumber},bill_number.ilike.%${parsedSearch.trimmed}%`);
            } else {
              directQuery = directQuery.ilike("bill_number", `%${parsedSearch.trimmed}%`);
            }
          }

          const directRes = await directQuery;
          if (directRes.error) {
            return NextResponse.json({ error: "Failed to export bill items" }, { status: 500 });
          }
          rawBills = (directRes.data || []) as unknown as Record<string, unknown>[];
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
    console.error("CSV Export error for bill items:", err);
    return NextResponse.json({ error: "Export generation failed" }, { status: 500 });
  }
}
