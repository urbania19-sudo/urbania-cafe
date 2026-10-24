import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase/server';
import { verifyExcelExportAuth } from '@/lib/excel-export-auth';
import {
  validateBillsQueryParams,
  encodeCursor,
  formatIST,
  methodNotAllowedResponse,
} from '@/lib/excel-export-helpers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // 1. Authenticate with dedicated token
  const auth = verifyExcelExportAuth(req.headers.get('authorization'));
  if (!auth.authorized) {
    return auth.response!;
  }

  // 2. Validate query parameters
  const { searchParams } = new URL(req.url);
  const validation = validateBillsQueryParams(searchParams);
  if (validation.error || !validation.params) {
    return NextResponse.json(
      { error: validation.error || 'Invalid query parameters' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const { limit, startDate, endDate, status, orderSource, sort, cursorPayload } = validation.params;

  try {
    const db = adminDb();
    let rawBills: Record<string, unknown>[] = [];

    // Helper to apply filters to any query
    const applyFilters = (baseQuery: any) => {
      let q = baseQuery;
      if (status !== 'all') q = q.eq('status', status);
      if (orderSource !== 'all') q = q.eq('order_source', orderSource);
      if (startDate) q = q.gte('issued_at', `${startDate}T00:00:00.000Z`);
      if (endDate) q = q.lte('issued_at', `${endDate}T23:59:59.999Z`);

      if (cursorPayload) {
        if (sort === 'desc') {
          q = q.or(`issued_at.lt.${cursorPayload.t},and(issued_at.eq.${cursorPayload.t},id.lt.${cursorPayload.id})`);
        } else {
          q = q.or(`issued_at.gt.${cursorPayload.t},and(issued_at.eq.${cursorPayload.t},id.gt.${cursorPayload.id})`);
        }
      }

      q = q
        .order('issued_at', { ascending: sort === 'asc' })
        .order('id', { ascending: sort === 'asc' })
        .limit(limit + 1);

      return q;
    };

    // 1. Primary Query: Assumes modern schema (Migration 0009)
    let primaryQuery = db
      .from('bills')
      .select('id, bill_number, order_id, order_number, table_number, table_label, status, subtotal_paise, tax_rate, tax_paise, total_paise, notes, issued_at, issued_by, cancelled_at, cancellation_reason, order_source, service_mode, customer_name, orders(customer_name, guest_count, service_mode, order_source)');

    const primaryRes = await applyFilters(primaryQuery);

    if (!primaryRes.error) {
      rawBills = (primaryRes.data || []) as unknown as Record<string, unknown>[];
    } else {
      console.warn('Primary bills Excel export query failed, trying safe fallback:', primaryRes.error.message);

      if (orderSource === 'manual') {
        rawBills = [];
      } else {
        // Fallback: Query bills with safe orders(customer_name, guest_count)
        let fallbackQuery = db
          .from('bills')
          .select('id, bill_number, order_id, order_number, table_number, table_label, status, subtotal_paise, tax_rate, tax_paise, total_paise, notes, issued_at, issued_by, cancelled_at, cancellation_reason, orders(customer_name, guest_count)');

        const fallbackRes = await applyFilters(fallbackQuery);
        if (!fallbackRes.error) {
          rawBills = (fallbackRes.data || []) as unknown as Record<string, unknown>[];
        } else {
          // Direct bills query without joins
          let directQuery = db
            .from('bills')
            .select('id, bill_number, order_id, order_number, table_number, table_label, status, subtotal_paise, tax_rate, tax_paise, total_paise, notes, issued_at, issued_by, cancelled_at, cancellation_reason');

          const directRes = await applyFilters(directQuery);
          if (directRes.error) {
            return NextResponse.json(
              { error: `Database query failed: ${directRes.error.message}` },
              { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
            );
          }
          rawBills = (directRes.data || []) as unknown as Record<string, unknown>[];
        }
      }
    }

    const hasMore = rawBills.length > limit;
    const pageData = hasMore ? rawBills.slice(0, limit) : rawBills;
    let nextCursor: string | null = null;

    if (hasMore && pageData.length > 0) {
      const lastItem = pageData[pageData.length - 1];
      nextCursor = encodeCursor(lastItem.issued_at as string, lastItem.id as string);
    }

    const records = pageData.map((b) => {
      const linkedOrder = b.orders as unknown as {
        customer_name?: string;
        guest_count?: number;
        service_mode?: string;
        order_source?: string;
      } | null;

      const { date: issuedDateIst, time: issuedTimeIst } = formatIST(b.issued_at as string);
      const subtotalPaise = Number(b.subtotal_paise) || 0;
      const taxRate = Number(b.tax_rate) || 0;
      const taxPaise = Number(b.tax_paise) || 0;
      const totalPaise = Number(b.total_paise) || 0;

      return {
        bill_id: b.id,
        bill_number: b.bill_number,
        order_id: b.order_id,
        order_number: Number(b.order_number),
        issued_at: b.issued_at,
        issued_date_ist: issuedDateIst,
        issued_time_ist: issuedTimeIst,
        order_source: b.order_source || linkedOrder?.order_source || 'qr',
        service_mode: b.service_mode || linkedOrder?.service_mode || 'dine_in',
        table_number: Number(b.table_number) || 0,
        table_label: b.table_label || '',
        customer_name: b.customer_name || linkedOrder?.customer_name || null,
        guest_count: linkedOrder?.guest_count ?? 1,
        subtotal_paise: subtotalPaise,
        subtotal_inr: Math.round(subtotalPaise) / 100,
        tax_rate: taxRate,
        tax_rate_percent: Math.round(taxRate * 100),
        tax_paise: taxPaise,
        tax_inr: Math.round(taxPaise) / 100,
        total_paise: totalPaise,
        total_inr: Math.round(totalPaise) / 100,
        status: b.status,
        issued_by: b.issued_by || null,
        notes: b.notes || null,
        cancelled_at: b.cancelled_at || null,
        cancellation_reason: b.cancellation_reason || null,
      };
    });

    return NextResponse.json(
      {
        data: records,
        next_cursor: nextCursor,
        has_more: hasMore,
        page_size: records.length,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'Content-Type': 'application/json; charset=utf-8',
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: `Bills export failed: ${message}` },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}

// Reject non-GET HTTP methods
export async function POST() {
  return methodNotAllowedResponse();
}

export async function PUT() {
  return methodNotAllowedResponse();
}

export async function PATCH() {
  return methodNotAllowedResponse();
}

export async function DELETE() {
  return methodNotAllowedResponse();
}
