import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase/server';
import { verifyExcelExportAuth } from '@/lib/excel-export-auth';
import type { BillItemSnapshot } from '@/lib/billing';
import {
  validateBillsQueryParams,
  encodeCursor,
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

    // Helper to apply filters to query
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

    let primaryQuery = db
      .from('bills')
      .select('id, bill_number, order_number, status, issued_at, items_snapshot, order_source');

    const primaryRes = await applyFilters(primaryQuery);

    if (!primaryRes.error) {
      rawBills = (primaryRes.data || []) as unknown as Record<string, unknown>[];
    } else {
      console.warn('Primary items Excel export query failed, trying direct fallback:', primaryRes.error.message);

      if (orderSource === 'manual') {
        rawBills = [];
      } else {
        // Fallback without order_source
        let fallbackQuery = db
          .from('bills')
          .select('id, bill_number, order_number, status, issued_at, items_snapshot');

        const fallbackRes = await applyFilters(fallbackQuery);
        if (fallbackRes.error) {
          return NextResponse.json(
            { error: `Database query failed: ${fallbackRes.error.message}` },
            { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
          );
        }
        rawBills = (fallbackRes.data || []) as unknown as Record<string, unknown>[];
      }
    }

    const hasMore = rawBills.length > limit;
    const pageData = hasMore ? rawBills.slice(0, limit) : rawBills;
    let nextCursor: string | null = null;

    if (hasMore && pageData.length > 0) {
      const lastBill = pageData[pageData.length - 1];
      nextCursor = encodeCursor(lastBill.issued_at as string, lastBill.id as string);
    }

    const items: Record<string, unknown>[] = [];
    for (const b of pageData) {
      const lineItems = (b.items_snapshot as BillItemSnapshot[]) || [];
      for (const item of lineItems) {
        const optionsStr = item.selected_options?.map((o) => o.name).join('; ') || '';
        const unitPricePaise = Number(item.unit_price_paise) || 0;
        const lineTotalPaise = Number(item.line_total_paise) || 0;

        items.push({
          bill_id: b.id,
          bill_number: b.bill_number,
          order_number: Number(b.order_number),
          item_id: item.id,
          item_name: item.name,
          item_type: item.is_custom ? 'Custom Item' : 'Catalogue',
          quantity: Number(item.quantity) || 1,
          unit_price_paise: unitPricePaise,
          unit_price_inr: Math.round(unitPricePaise) / 100,
          line_total_paise: lineTotalPaise,
          line_total_inr: Math.round(lineTotalPaise) / 100,
          selected_options: optionsStr,
          item_note: item.note || '',
          bill_status: b.status,
          issued_at: b.issued_at,
        });
      }
    }

    return NextResponse.json(
      {
        data: items,
        next_cursor: nextCursor,
        has_more: hasMore,
        page_size: items.length,
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
      { error: `Bill items export failed: ${message}` },
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
