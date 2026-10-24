import { NextResponse } from 'next/server';

export interface CursorPayload {
  t: string; // ISO 8601 timestamp (issued_at or created_at)
  id: string; // unique UUID tie-breaker
  offset?: number; // item index within the bill for item-level pagination (0-based)
}

/**
 * Encodes an opaque, URL-safe base64 cursor from timestamp, id, and optional item offset.
 */
export function encodeCursor(timestamp: string, id: string, offset?: number): string {
  const payload: CursorPayload = { t: timestamp, id };
  if (typeof offset === 'number' && offset > 0) {
    payload.offset = offset;
  }
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

    let offset: number | undefined;
    if (parsed.offset !== undefined) {
      if (typeof parsed.offset !== 'number' || parsed.offset < 0 || !Number.isInteger(parsed.offset)) {
        return null;
      }
      offset = parsed.offset;
    }

    return { t: parsed.t, id: parsed.id.trim(), offset };
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

/**
 * Validates a date string as a strict calendar date in YYYY-MM-DD format.
 * Rejects impossible dates (e.g. 2026-02-31, 2026-04-31, 2026-13-45) and unsupported timestamp formats.
 * Returns { year, month, day } or an error string.
 */
export function validateCalendarDate(dateStr: string, paramName: string): {
  year?: number;
  month?: number;
  day?: number;
  error?: string;
} {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return {
      error: `Invalid ${paramName}: must be a calendar date in YYYY-MM-DD format (representing an Indian business date)`,
    };
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) {
    return { error: `Invalid ${paramName}: month must be between 01 and 12` };
  }

  if (day < 1 || day > 31) {
    return { error: `Invalid ${paramName}: day must be between 01 and 31` };
  }

  // Strict check using UTC Date to verify month/day did not roll over
  const testDate = new Date(Date.UTC(year, month - 1, day));
  if (
    testDate.getUTCFullYear() !== year ||
    testDate.getUTCMonth() !== month - 1 ||
    testDate.getUTCDate() !== day
  ) {
    return { error: `Invalid ${paramName}: ${dateStr} is not a valid calendar date` };
  }

  return { year, month, day };
}

/**
 * Converts an Indian business date (YYYY-MM-DD in Asia/Kolkata) to UTC timestamp boundaries.
 * 
 * IST is UTC+05:30 (fixed offset of +330 minutes with no daylight saving time).
 * 
 * Start of business day (00:00:00.000 IST):
 * 2026-10-24 00:00:00.000 IST = 2026-10-23T18:30:00.000Z UTC
 * 
 * End of business day (23:59:59.999 IST):
 * 2026-10-24 23:59:59.999 IST = 2026-10-24T18:29:59.999Z UTC
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 5 hours 30 minutes in milliseconds

export function istDateToUtcStartBoundary(year: number, month: number, day: number): string {
  const localMidnightUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return new Date(localMidnightUtc - IST_OFFSET_MS).toISOString();
}

export function istDateToUtcEndBoundary(year: number, month: number, day: number): string {
  const localEndOfDayUtc = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  return new Date(localEndOfDayUtc - IST_OFFSET_MS).toISOString();
}

export interface BillsQueryParams {
  limit: number;
  startDate?: string;
  endDate?: string;
  startUtcBoundary?: string;
  endUtcBoundary?: string;
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

  // 2. startDate (Asia/Kolkata business date)
  let startUtcBoundary: string | undefined;
  const startDate = searchParams.get('startDate')?.trim();
  if (startDate) {
    const val = validateCalendarDate(startDate, 'startDate');
    if (val.error) return { error: val.error };
    startUtcBoundary = istDateToUtcStartBoundary(val.year!, val.month!, val.day!);
  }

  // 3. endDate (Asia/Kolkata business date)
  let endUtcBoundary: string | undefined;
  const endDate = searchParams.get('endDate')?.trim();
  if (endDate) {
    const val = validateCalendarDate(endDate, 'endDate');
    if (val.error) return { error: val.error };
    endUtcBoundary = istDateToUtcEndBoundary(val.year!, val.month!, val.day!);
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
      startUtcBoundary,
      endUtcBoundary,
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
  startUtcBoundary?: string;
  endUtcBoundary?: string;
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

  // 2. startDate (Asia/Kolkata business date)
  let startUtcBoundary: string | undefined;
  const startDate = searchParams.get('startDate')?.trim();
  if (startDate) {
    const val = validateCalendarDate(startDate, 'startDate');
    if (val.error) return { error: val.error };
    startUtcBoundary = istDateToUtcStartBoundary(val.year!, val.month!, val.day!);
  }

  // 3. endDate (Asia/Kolkata business date)
  let endUtcBoundary: string | undefined;
  const endDate = searchParams.get('endDate')?.trim();
  if (endDate) {
    const val = validateCalendarDate(endDate, 'endDate');
    if (val.error) return { error: val.error };
    endUtcBoundary = istDateToUtcEndBoundary(val.year!, val.month!, val.day!);
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
      startUtcBoundary,
      endUtcBoundary,
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
