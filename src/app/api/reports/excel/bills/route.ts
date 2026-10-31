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

  const { limit, startUtcBoundary, endUtcBoundary, status, orderSource, sort, cursorPayload } =
    validation.params;

  try {
    const db = adminDb();

    let query = db
      .from('bills')
      .select(
        'id, bill_number, order_id, order_number, table_number, table_label, status, subtotal_paise, tax_rate, tax_paise, total_paise, notes, issued_at, issued_by, cancelled_at, cancellation_reason, order_source, service_mode, customer_name, orders(customer_name, guest_count, service_mode, order_source)'
      );

    if (status !== 'all') query = query.eq('status', status);
    if (orderSource !== 'all') query = query.eq('order_source', orderSource);
    if (startUtcBoundary) query = query.gte('issued_at', startUtcBoundary);
    if (endUtcBoundary) query = query.lte('issued_at', endUtcBoundary);

    if (cursorPayload) {
      if (sort === 'desc') {
        query = query.or(
          `issued_at.lt.${cursorPayload.t},and(issued_at.eq.${cursorPayload.t},id.lt.${cursorPayload.id})`
        );
      } else {
        query = query.or(
          `issued_at.gt.${cursorPayload.t},and(issued_at.eq.${cursorPayload.t},id.gt.${cursorPayload.id})`
        );
      }
    }

    query = query
      .order('issued_at', { ascending: sort === 'asc' })
      .order('id', { ascending: sort === 'asc' })
      .limit(limit + 1);

    const { data: rawBills, error } = await query;

    if (error) {
      console.error('Bills Excel export query failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to query bills' },
        { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const billsList = (rawBills || []) as Record<string, unknown>[];
    const hasMore = billsList.length > limit;
    const pageData = hasMore ? billsList.slice(0, limit) : billsList;
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
      const discountPaise = Number(b.discount_paise) || 0;
      const originalTotalPaise =
        b.subtotal_before_discount_paise != null
          ? Number(b.subtotal_before_discount_paise)
          : totalPaise + discountPaise;
      const discountType = (b.discount_type as string) || null;
      const discountValue = b.discount_value != null ? Number(b.discount_value) : null;

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
        original_total_paise: originalTotalPaise,
        original_total_inr: Math.round(originalTotalPaise) / 100,
        subtotal_before_discount_paise: originalTotalPaise,
        subtotal_before_discount_inr: Math.round(originalTotalPaise) / 100,
        discount_type: discountType,
        discount_value: discountValue,
        discount_paise: discountPaise,
        discount_inr: Math.round(discountPaise) / 100,
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
    console.error('Bills Excel export unexpected failure:', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
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
