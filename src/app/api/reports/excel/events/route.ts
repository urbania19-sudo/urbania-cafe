import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase/server';
import { verifyExcelExportAuth } from '@/lib/excel-export-auth';
import {
  validateEventsQueryParams,
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
  const validation = validateEventsQueryParams(searchParams);
  if (validation.error || !validation.params) {
    return NextResponse.json(
      { error: validation.error || 'Invalid query parameters' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const { limit, startUtcBoundary, endUtcBoundary, eventType, billId, sort, cursorPayload } =
    validation.params;

  try {
    const db = adminDb();

    let query = db
      .from('bill_audit_events')
      .select(
        'id, bill_id, bill_number, event_type, actor_id, actor_role, actor_email, metadata, created_at'
      );

    if (eventType !== 'all') query = query.eq('event_type', eventType);
    if (billId) query = query.eq('bill_id', billId);
    if (startUtcBoundary) query = query.gte('created_at', startUtcBoundary);
    if (endUtcBoundary) query = query.lte('created_at', endUtcBoundary);

    if (cursorPayload) {
      if (sort === 'desc') {
        query = query.or(
          `created_at.lt.${cursorPayload.t},and(created_at.eq.${cursorPayload.t},id.lt.${cursorPayload.id})`
        );
      } else {
        query = query.or(
          `created_at.gt.${cursorPayload.t},and(created_at.eq.${cursorPayload.t},id.gt.${cursorPayload.id})`
        );
      }
    }

    query = query
      .order('created_at', { ascending: sort === 'asc' })
      .order('id', { ascending: sort === 'asc' })
      .limit(limit + 1);

    const { data: rawEvents, error } = await query;

    if (error) {
      console.error('Audit events Excel export query failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to query audit events' },
        { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const rows = (rawEvents || []) as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const pageData = hasMore ? rows.slice(0, limit) : rows;
    let nextCursor: string | null = null;

    if (hasMore && pageData.length > 0) {
      const lastEvent = pageData[pageData.length - 1];
      nextCursor = encodeCursor(lastEvent.created_at as string, lastEvent.id as string);
    }

    const records = pageData.map((e) => {
      const { date: eventDateIst, time: eventTimeIst } = formatIST(e.created_at as string);
      return {
        event_id: e.id,
        bill_id: e.bill_id,
        bill_number: e.bill_number,
        event_timestamp: e.created_at,
        event_date_ist: eventDateIst,
        event_time_ist: eventTimeIst,
        event_type: e.event_type,
        actor_id: e.actor_id || null,
        actor_role: e.actor_role || null,
        actor_email: e.actor_email || null,
        metadata: e.metadata || {},
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
    console.error('Audit events Excel export unexpected failure:', err);
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
