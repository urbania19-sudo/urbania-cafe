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

  const { limit, startUtcBoundary, endUtcBoundary, status, orderSource, sort, cursorPayload } =
    validation.params;

  try {
    const db = adminDb();

    // Query bills in bounded batches to expand item snapshots.
    // Fetch up to limit + 5 bills per batch (max 250).
    const billsBatch = Math.min(limit + 5, 250);
    // Allow scanning up to 5 consecutive batches per request if batches contain no items
    const MAX_BATCH_SCANS = 5;

    const items: Record<string, unknown>[] = [];
    let nextCursor: string | null = null;
    let hasMore = false;

    let currentCursorPayload = cursorPayload;
    let batchScanCount = 0;

    while (batchScanCount < MAX_BATCH_SCANS) {
      batchScanCount++;

      let query = db
        .from('bills')
        .select('id, bill_number, order_number, status, issued_at, items_snapshot, order_source');

      if (status !== 'all') query = query.eq('status', status);
      if (orderSource !== 'all') query = query.eq('order_source', orderSource);
      if (startUtcBoundary) query = query.gte('issued_at', startUtcBoundary);
      if (endUtcBoundary) query = query.lte('issued_at', endUtcBoundary);

      if (currentCursorPayload) {
        const hasOffset =
          typeof currentCursorPayload.offset === 'number' && currentCursorPayload.offset > 0;
        if (sort === 'desc') {
          if (hasOffset) {
            // Resume at the specific bill (inclusive) to continue remaining items
            query = query.or(
              `issued_at.lt.${currentCursorPayload.t},and(issued_at.eq.${currentCursorPayload.t},id.lte.${currentCursorPayload.id})`
            );
          } else {
            // The previous bill was fully consumed; advance strictly to next bill
            query = query.or(
              `issued_at.lt.${currentCursorPayload.t},and(issued_at.eq.${currentCursorPayload.t},id.lt.${currentCursorPayload.id})`
            );
          }
        } else {
          if (hasOffset) {
            query = query.or(
              `issued_at.gt.${currentCursorPayload.t},and(issued_at.eq.${currentCursorPayload.t},id.gte.${currentCursorPayload.id})`
            );
          } else {
            query = query.or(
              `issued_at.gt.${currentCursorPayload.t},and(issued_at.eq.${currentCursorPayload.t},id.gt.${currentCursorPayload.id})`
            );
          }
        }
      }

      query = query
        .order('issued_at', { ascending: sort === 'asc' })
        .order('id', { ascending: sort === 'asc' })
        .limit(billsBatch);

      const { data: rawBills, error } = await query;

      if (error) {
        console.error('Bill items Excel export query failed:', error.message);
        return NextResponse.json(
          { error: 'Failed to query bill items' },
          { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
        );
      }

      const billsList = (rawBills || []) as Record<string, unknown>[];

      // Genuinely no matching bills exist
      if (billsList.length === 0) {
        hasMore = false;
        nextCursor = null;
        break;
      }

      const startItemOffset = currentCursorPayload?.offset ?? 0;

      for (let bIndex = 0; bIndex < billsList.length; bIndex++) {
        const b = billsList[bIndex];
        const lineItems = (b.items_snapshot as BillItemSnapshot[]) || [];
        const itemStart = bIndex === 0 ? startItemOffset : 0;

        for (let i = itemStart; i < lineItems.length; i++) {
          if (items.length < limit) {
            const item = lineItems[i];
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
          } else {
            // Reached item limit! The next item to fetch is item index `i` of bill `b`.
            hasMore = true;
            nextCursor = encodeCursor(b.issued_at as string, b.id as string, i);
            break;
          }
        }

        if (hasMore) {
          break;
        }

        // Check boundary if we reached limit on the last item of the bill
        if (items.length === limit) {
          if (bIndex < billsList.length - 1) {
            hasMore = true;
            nextCursor = encodeCursor(b.issued_at as string, b.id as string);
            break;
          } else if (billsList.length === billsBatch) {
            hasMore = true;
            nextCursor = encodeCursor(b.issued_at as string, b.id as string);
            break;
          }
        }
      }

      if (hasMore) {
        break;
      }

      // If we exhausted all bills in this batch and it was fewer than billsBatch:
      // The database has no more matching bills.
      if (billsList.length < billsBatch) {
        hasMore = false;
        nextCursor = null;
        break;
      }

      // If billsList had a full billsBatch but items still did not reach limit:
      // More bills may exist in the database. Advance cursor to the end of the last bill in this batch.
      const lastBill = billsList[billsList.length - 1];
      currentCursorPayload = {
        t: lastBill.issued_at as string,
        id: lastBill.id as string,
      };

      // If we reached the maximum batch scan limit for this request, yield to the client
      // with next_cursor so Power Query can continue in the next request.
      if (batchScanCount >= MAX_BATCH_SCANS) {
        hasMore = true;
        nextCursor = encodeCursor(lastBill.issued_at as string, lastBill.id as string);
        break;
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
    console.error('Bill items Excel export unexpected failure:', err);
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
