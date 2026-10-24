import { NextResponse } from 'next/server';

export interface CursorPayload {
  t: string; // ISO 8601 timestamp (issued_at or created_at)
  id: string; // unique UUID tie-breaker
}

/**
 * Encodes an opaque, URL-safe base64 cursor from timestamp and id.
 */
export function encodeCursor(timestamp: string, id: string): string {
  const payload: CursorPayload = { t: timestamp, id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodes and validates a URL-safe base64 cursor.
 * Returns null if the cursor is invalid or malformed.
 */
export function decodeCursor(cursorStr: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.t !== 'string' || typeof parsed.id !== 'string') return null;
    const time = new Date(parsed.t).getTime();
    if (isNaN(time)) return null;
    if (!parsed.id.trim()) return null;
    return { t: parsed.t, id: parsed.id.trim() };
  } catch {
    return null;
  }
}

/**
 * Formats an ISO date into IST (Asia/Kolkata) date and time strings.
 */
export function formatIST(isoDateStr: string): { date: string; time: string } {
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const date = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  return { date, time };
}

export interface BillsQueryParams {
  limit: number;
  startDate?: string;
  endDate?: string;
  status: 'all' | 'issued' | 'cancelled';
  orderSource: 'all' | 'qr' | 'manual';
  sort: 'asc' | 'desc';
  cursorPayload: CursorPayload | null;
}

export function validateBillsQueryParams(searchParams: URLSearchParams): {
  params?: BillsQueryParams;
  error?: string;
} {
  // 1. limit
  const limitParam = searchParams.get('limit');
  let limit = 200;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 1000) {
      return { error: 'Invalid limit: must be an integer between 1 and 1000' };
    }
    limit = parsed;
  }

  // 2. startDate
  const startDate = searchParams.get('startDate')?.trim();
  if (startDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) && isNaN(new Date(startDate).getTime())) {
      return { error: 'Invalid startDate: must be YYYY-MM-DD or a valid ISO timestamp' };
    }
  }

  // 3. endDate
  const endDate = searchParams.get('endDate')?.trim();
  if (endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) && isNaN(new Date(endDate).getTime())) {
      return { error: 'Invalid endDate: must be YYYY-MM-DD or a valid ISO timestamp' };
    }
  }

  if (startDate && endDate && startDate > endDate) {
    return { error: 'startDate cannot be after endDate' };
  }

  // 4. status
  const statusParam = searchParams.get('status') || 'all';
  if (!['all', 'issued', 'cancelled'].includes(statusParam)) {
    return { error: "Invalid status: must be 'all', 'issued', or 'cancelled'" };
  }
  const status = statusParam as 'all' | 'issued' | 'cancelled';

  // 5. orderSource
  const orderSourceParam = searchParams.get('orderSource') || 'all';
  if (!['all', 'qr', 'manual'].includes(orderSourceParam)) {
    return { error: "Invalid orderSource: must be 'all', 'qr', or 'manual'" };
  }
  const orderSource = orderSourceParam as 'all' | 'qr' | 'manual';

  // 6. sort
  const sortParam = (searchParams.get('sort') || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(sortParam)) {
    return { error: "Invalid sort: must be 'asc' or 'desc'" };
  }
  const sort = sortParam as 'asc' | 'desc';

  // 7. cursor
  const cursorParam = searchParams.get('cursor')?.trim();
  let cursorPayload: CursorPayload | null = null;
  if (cursorParam) {
    cursorPayload = decodeCursor(cursorParam);
    if (!cursorPayload) {
      return { error: 'Invalid pagination cursor' };
    }
  }

  return {
    params: {
      limit,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      status,
      orderSource,
      sort,
      cursorPayload,
    },
  };
}

export interface EventsQueryParams {
  limit: number;
  startDate?: string;
  endDate?: string;
  eventType: 'all' | 'issued' | 'reprinted' | 'cancelled' | 'viewed';
  billId?: string;
  sort: 'asc' | 'desc';
  cursorPayload: CursorPayload | null;
}

export function validateEventsQueryParams(searchParams: URLSearchParams): {
  params?: EventsQueryParams;
  error?: string;
} {
  // 1. limit
  const limitParam = searchParams.get('limit');
  let limit = 200;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 1000) {
      return { error: 'Invalid limit: must be an integer between 1 and 1000' };
    }
    limit = parsed;
  }

  // 2. startDate
  const startDate = searchParams.get('startDate')?.trim();
  if (startDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) && isNaN(new Date(startDate).getTime())) {
      return { error: 'Invalid startDate: must be YYYY-MM-DD or a valid ISO timestamp' };
    }
  }

  // 3. endDate
  const endDate = searchParams.get('endDate')?.trim();
  if (endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) && isNaN(new Date(endDate).getTime())) {
      return { error: 'Invalid endDate: must be YYYY-MM-DD or a valid ISO timestamp' };
    }
  }

  if (startDate && endDate && startDate > endDate) {
    return { error: 'startDate cannot be after endDate' };
  }

  // 4. eventType
  const eventTypeParam = searchParams.get('eventType') || 'all';
  if (!['all', 'issued', 'reprinted', 'cancelled', 'viewed'].includes(eventTypeParam)) {
    return { error: "Invalid eventType: must be 'all', 'issued', 'reprinted', 'cancelled', or 'viewed'" };
  }
  const eventType = eventTypeParam as 'all' | 'issued' | 'reprinted' | 'cancelled' | 'viewed';

  // 5. billId
  const billId = searchParams.get('billId')?.trim();
  if (billId) {
    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(billId)) {
      return { error: 'Invalid billId: must be a valid UUID' };
    }
  }

  // 6. sort
  const sortParam = (searchParams.get('sort') || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(sortParam)) {
    return { error: "Invalid sort: must be 'asc' or 'desc'" };
  }
  const sort = sortParam as 'asc' | 'desc';

  // 7. cursor
  const cursorParam = searchParams.get('cursor')?.trim();
  let cursorPayload: CursorPayload | null = null;
  if (cursorParam) {
    cursorPayload = decodeCursor(cursorParam);
    if (!cursorPayload) {
      return { error: 'Invalid pagination cursor' };
    }
  }

  return {
    params: {
      limit,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      eventType,
      billId: billId || undefined,
      sort,
      cursorPayload,
    },
  };
}

/**
 * Standard method-not-allowed response for non-GET requests to Excel reporting endpoints.
 */
export function methodNotAllowedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Method Not Allowed. This reporting endpoint is read-only and accepts GET requests only.' },
    {
      status: 405,
      headers: {
        Allow: 'GET',
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}
