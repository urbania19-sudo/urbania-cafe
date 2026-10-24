import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as getBills,
  POST as postBills,
  PUT as putBills,
  DELETE as deleteBills,
} from '@/app/api/reports/excel/bills/route';
import {
  GET as getItems,
  POST as postItems,
  PUT as putItems,
  DELETE as deleteItems,
} from '@/app/api/reports/excel/items/route';
import {
  GET as getEvents,
  POST as postEvents,
  PUT as putEvents,
  DELETE as deleteEvents,
} from '@/app/api/reports/excel/events/route';
import { encodeCursor, decodeCursor } from '@/lib/excel-export-helpers';

// Mock Supabase adminDb
const mockQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null })),
};

const mockDb = {
  from: vi.fn(() => mockQueryBuilder),
};

vi.mock('@/lib/supabase/server', () => ({
  adminDb: vi.fn(() => mockDb),
}));

describe('Excel Power Query Reporting Endpoints', () => {
  const originalEnv = process.env;
  const TEST_TOKEN = 'urbania_secure_test_token_1234567890';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      URBANIA_EXCEL_EXPORT_TOKEN: TEST_TOKEN,
    };
    mockQueryBuilder.select.mockReturnThis();
    mockQueryBuilder.eq.mockReturnThis();
    mockQueryBuilder.gte.mockReturnThis();
    mockQueryBuilder.lte.mockReturnThis();
    mockQueryBuilder.or.mockReturnThis();
    mockQueryBuilder.order.mockReturnThis();
    mockQueryBuilder.limit.mockImplementation(() => Promise.resolve({ data: [], error: null }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('1. Authentication & Security Guardrails', () => {
    it('fails closed with HTTP 500 when URBANIA_EXCEL_EXPORT_TOKEN is missing on server', async () => {
      delete process.env.URBANIA_EXCEL_EXPORT_TOKEN;

      const req = new NextRequest('http://localhost/api/reports/excel/bills', {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const res = await getBills(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain('not configured on the server');
      expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    });

    it('fails closed with HTTP 500 when URBANIA_EXCEL_EXPORT_TOKEN is empty whitespace', async () => {
      process.env.URBANIA_EXCEL_EXPORT_TOKEN = '   ';

      const req = new NextRequest('http://localhost/api/reports/excel/bills', {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const res = await getBills(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain('not configured on the server');
    });

    it('rejects requests with missing Authorization header with HTTP 401', async () => {
      const req = new NextRequest('http://localhost/api/reports/excel/bills');
      const res = await getBills(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Missing Authorization header');
    });

    it('rejects requests with non-Bearer Authorization header format with HTTP 401', async () => {
      const req = new NextRequest('http://localhost/api/reports/excel/bills', {
        headers: { Authorization: `Basic dXNlcjpwYXNz` },
      });
      const res = await getBills(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Expected 'Bearer <token>'");
    });

    it('rejects requests with empty bearer token with HTTP 401', async () => {
      const req = new NextRequest('http://localhost/api/reports/excel/bills', {
        headers: { Authorization: 'Bearer    ' },
      });
      const res = await getBills(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Bearer token is empty');
    });

    it('rejects requests with incorrect export token with HTTP 401', async () => {
      const req = new NextRequest('http://localhost/api/reports/excel/bills', {
        headers: { Authorization: 'Bearer incorrect_attacker_token_xyz' },
      });
      const res = await getBills(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Invalid export token');
    });

    it('never accepts export token in URL query parameter', async () => {
      const req = new NextRequest(`http://localhost/api/reports/excel/bills?token=${TEST_TOKEN}`);
      const res = await getBills(req);
      expect(res.status).toBe(401);
    });

    it('allows access with correct Bearer token', async () => {
      const req = new NextRequest('http://localhost/api/reports/excel/bills', {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      const res = await getBills(req);
      expect(res.status).toBe(200);
    });
  });

  describe('2. Read-Only Enforcement (Confirmation that endpoints cannot modify records)', () => {
    it('rejects POST, PUT, DELETE requests on /api/reports/excel/bills with HTTP 405', async () => {
      const resPost = await postBills();
      expect(resPost.status).toBe(405);
      expect(resPost.headers.get('Allow')).toBe('GET');

      const resPut = await putBills();
      expect(resPut.status).toBe(405);

      const resDelete = await deleteBills();
      expect(resDelete.status).toBe(405);
    });

    it('rejects POST, PUT, DELETE requests on /api/reports/excel/items with HTTP 405', async () => {
      const resPost = await postItems();
      expect(resPost.status).toBe(405);

      const resPut = await putItems();
      expect(resPut.status).toBe(405);

      const resDelete = await deleteItems();
      expect(resDelete.status).toBe(405);
    });

    it('rejects POST, PUT, DELETE requests on /api/reports/excel/events with HTTP 405', async () => {
      const resPost = await postEvents();
      expect(resPost.status).toBe(405);

      const resPut = await putEvents();
      expect(resPut.status).toBe(405);

      const resDelete = await deleteEvents();
      expect(resDelete.status).toBe(405);
    });
  });

  describe('3. Query Parameter Validation & Indian Date Boundaries (Asia/Kolkata)', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

    it('converts India business date (Asia/Kolkata) to exact UTC boundaries for bills', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

      // In IST (UTC+05:30):
      // 2026-10-24 00:00:00.000 IST = 2026-10-23T18:30:00.000Z UTC
      // 2026-10-24 23:59:59.999 IST = 2026-10-24T18:29:59.999Z UTC
      await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-10-24&endDate=2026-10-24'));

      expect(mockQueryBuilder.gte).toHaveBeenCalledWith('issued_at', '2026-10-23T18:30:00.000Z');
      expect(mockQueryBuilder.lte).toHaveBeenCalledWith('issued_at', '2026-10-24T18:29:59.999Z');
    });

    it('converts India business date (Asia/Kolkata) to exact UTC boundaries for audit events', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

      await getEvents(makeAuthReq('http://localhost/api/reports/excel/events?startDate=2026-10-24&endDate=2026-10-24'));

      expect(mockQueryBuilder.gte).toHaveBeenCalledWith('created_at', '2026-10-23T18:30:00.000Z');
      expect(mockQueryBuilder.lte).toHaveBeenCalledWith('created_at', '2026-10-24T18:29:59.999Z');
    });

    it('rejects impossible calendar date 2026-02-31 with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-02-31'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('not a valid calendar date');
    });

    it('rejects impossible calendar date 2026-04-31 (April has 30 days) with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-04-31'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('not a valid calendar date');
    });

    it('rejects impossible calendar date in non-leap year (2025-02-29) with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2025-02-29'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('not a valid calendar date');
    });

    it('accepts valid leap year date 2024-02-29 with HTTP 200', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2024-02-29'));
      expect(res.status).toBe(200);
      expect(mockQueryBuilder.gte).toHaveBeenCalledWith('issued_at', '2024-02-28T18:30:00.000Z');
    });

    it('rejects invalid month numbers with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-13-01'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('month must be between 01 and 12');
    });

    it('rejects invalid day numbers with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-01-00'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('day must be between 01 and 31');
    });

    it('rejects unsupported timestamp format (e.g. ISO string) in date-only filter with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-10-24T00:00:00Z'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('must be a calendar date in YYYY-MM-DD format');
    });

    it('rejects non-standard slash format (e.g. MM/DD/YYYY) with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=10/24/2026'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('must be a calendar date in YYYY-MM-DD format');
    });

    it('rejects startDate > endDate with HTTP 400', async () => {
      const res = await getBills(
        makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-10-25&endDate=2026-10-20')
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('startDate cannot be after endDate');
    });

    it('rejects limit < 1 with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?limit=0'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('must be an integer between 1 and 1000');
    });

    it('rejects limit > 1000 with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?limit=1001'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('must be an integer between 1 and 1000');
    });

    it('rejects invalid status filter with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?status=pending'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid status');
    });

    it('rejects invalid orderSource filter with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?orderSource=phone'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid orderSource');
    });

    it('rejects invalid sort option with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?sort=random'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid sort');
    });

    it('rejects malformed base64 cursor with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?cursor=not-valid-base64-json!'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid pagination cursor');
    });

    it('rejects invalid eventType on events endpoint with HTTP 400', async () => {
      const res = await getEvents(makeAuthReq('http://localhost/api/reports/excel/events?eventType=hacked'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid eventType');
    });

    it('rejects invalid billId UUID on events endpoint with HTTP 400', async () => {
      const res = await getEvents(makeAuthReq('http://localhost/api/reports/excel/events?billId=not-a-uuid'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid billId');
    });
  });

  describe('4. Error Transparency & Sanitization (Never hide reporting failures)', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

    it('returns HTTP 500 when audit events database query fails (does not return fake empty 200)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockQueryBuilder.limit.mockResolvedValueOnce({
        data: null,
        error: { message: 'relation "bill_audit_events" does not exist' },
      });

      const res = await getEvents(makeAuthReq('http://localhost/api/reports/excel/events'));
      expect(res.status).toBe(500);
      const json = await res.json();

      // Generic sanitized error returned to client
      expect(json.error).toBe('Failed to query audit events');
      // Must not leak raw SQL table names or database error details to client
      expect(json.error).not.toContain('bill_audit_events');
      // Detailed diagnostics logged server-side
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Audit events Excel export query failed'),
        expect.stringContaining('relation "bill_audit_events" does not exist')
      );

      consoleSpy.mockRestore();
    });

    it('returns HTTP 500 when bills database query fails (does not return fake empty data)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockQueryBuilder.limit.mockResolvedValueOnce({
        data: null,
        error: { message: 'connection timeout to database cluster' },
      });

      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills'));
      expect(res.status).toBe(500);
      const json = await res.json();

      expect(json.error).toBe('Failed to query bills');
      expect(json.error).not.toContain('connection timeout');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Bills Excel export query failed'),
        expect.stringContaining('connection timeout')
      );

      consoleSpy.mockRestore();
    });

    it('returns HTTP 500 when bill items database query fails (does not return fake empty data)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockQueryBuilder.limit.mockResolvedValueOnce({
        data: null,
        error: { message: 'database read replica unavailable' },
      });

      const res = await getItems(makeAuthReq('http://localhost/api/reports/excel/items'));
      expect(res.status).toBe(500);
      const json = await res.json();

      expect(json.error).toBe('Failed to query bill items');
      expect(json.error).not.toContain('replica unavailable');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Bill items Excel export query failed'),
        expect.stringContaining('replica unavailable')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('5. Bills Endpoint (/api/reports/excel/bills)', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

    it('handles legitimate zero-result queries cleanly with HTTP 200', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data).toEqual([]);
      expect(json.next_cursor).toBeNull();
      expect(json.has_more).toBe(false);
      expect(json.page_size).toBe(0);
      expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    });

    it('returns only authorized reporting columns and excludes internal or unneeded data', async () => {
      const sampleRow = {
        id: 'bill-uuid-1',
        bill_number: 'UB-01001',
        order_id: 'order-uuid-1',
        order_number: 101,
        table_number: 3,
        table_label: 'Table 3',
        status: 'issued',
        subtotal_paise: 24000,
        tax_rate: 0.05,
        tax_paise: 1200,
        total_paise: 25200,
        notes: 'Extra spicy',
        issued_at: '2026-10-24T08:00:00.000Z',
        issued_by: 'staff-uuid-1',
        cancelled_at: null,
        cancellation_reason: null,
        order_source: 'qr',
        service_mode: 'dine_in',
        customer_name: 'Aditya',
        orders: {
          customer_name: 'Aditya',
          guest_count: 2,
          service_mode: 'dine_in',
          order_source: 'qr',
        },
      };

      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [sampleRow], error: null });

      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.length).toBe(1);
      const bill = json.data[0];

      // Legitimate reporting fields present
      expect(bill.bill_id).toBe('bill-uuid-1');
      expect(bill.bill_number).toBe('UB-01001');
      expect(bill.order_id).toBe('order-uuid-1');
      expect(bill.order_number).toBe(101);
      expect(bill.table_number).toBe(3);
      expect(bill.subtotal_paise).toBe(24000);
      expect(bill.subtotal_inr).toBe(240);
      expect(bill.tax_rate_percent).toBe(5);
      expect(bill.tax_inr).toBe(12);
      expect(bill.total_inr).toBe(252);
      expect(bill.status).toBe('issued');
      expect(bill.customer_name).toBe('Aditya');
      expect(bill.guest_count).toBe(2);
      expect(bill.issued_date_ist).toBeDefined();
      expect(bill.issued_time_ist).toBeDefined();

      // Ensure internal unneeded data is NOT exposed
      expect(bill.business_snapshot).toBeUndefined();
      expect(bill.items_snapshot).toBeUndefined();
      expect(bill.secret).toBeUndefined();
    });

    it('generates a valid cursor when data exceeds page limit', async () => {
      const rows = [
        { id: 'uuid-1', bill_number: 'UB-1', issued_at: '2026-10-24T10:00:00.000Z', total_paise: 1000 },
        { id: 'uuid-2', bill_number: 'UB-2', issued_at: '2026-10-24T09:00:00.000Z', total_paise: 2000 },
        { id: 'uuid-3', bill_number: 'UB-3', issued_at: '2026-10-24T08:00:00.000Z', total_paise: 3000 },
      ];

      mockQueryBuilder.limit.mockResolvedValueOnce({ data: rows, error: null });

      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?limit=2'));
      const json = await res.json();

      expect(json.data.length).toBe(2);
      expect(json.has_more).toBe(true);
      expect(json.next_cursor).toBeDefined();

      const decoded = decodeCursor(json.next_cursor);
      expect(decoded).toEqual({
        t: '2026-10-24T09:00:00.000Z',
        id: 'uuid-2',
      });
    });

    it('paginates deterministically across more than 1,000 records without truncation', async () => {
      const totalRecords = 1500;
      const batchSize = 500;
      let currentCursor: string | null = null;
      let fetchedTotal = 0;

      for (let batch = 0; batch < 3; batch++) {
        const isLastBatch = batch === 2;
        const rowCount = isLastBatch ? batchSize : batchSize + 1;
        const mockRows = Array.from({ length: rowCount }, (_, i) => {
          const index = batch * batchSize + i;
          return {
            id: `uuid-${index}`,
            bill_number: `UB-${1000 + index}`,
            issued_at: new Date(1700000000000 - index * 1000).toISOString(),
            total_paise: 5000,
          };
        });

        mockQueryBuilder.limit.mockResolvedValueOnce({ data: mockRows, error: null });

        const url = currentCursor
          ? `http://localhost/api/reports/excel/bills?limit=${batchSize}&cursor=${currentCursor}`
          : `http://localhost/api/reports/excel/bills?limit=${batchSize}`;

        const res = await getBills(makeAuthReq(url));
        const json = await res.json();

        expect(json.data.length).toBe(batchSize);
        fetchedTotal += json.data.length;

        if (isLastBatch) {
          expect(json.has_more).toBe(false);
          expect(json.next_cursor).toBeNull();
        } else {
          expect(json.has_more).toBe(true);
          expect(json.next_cursor).toBeDefined();
          currentCursor = json.next_cursor;
        }
      }

      expect(fetchedTotal).toBe(totalRecords);
    });
  });

  describe('6. Bill Items Endpoint (/api/reports/excel/items) & Item-Level Pagination', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

    it('strictly bounds response size to the requested item limit and preserves item offsets across pages', async () => {
      // Bill 1 has 2 items: item-1a, item-1b
      // Bill 2 has 3 items: item-2a, item-2b, item-2c
      const bill1 = {
        id: 'bill-1',
        bill_number: 'UB-01001',
        order_number: 101,
        status: 'issued',
        issued_at: '2026-10-24T10:00:00.000Z',
        items_snapshot: [
          { id: 'item-1a', name: 'Coffee', unit_price_paise: 10000, quantity: 1, line_total_paise: 10000 },
          { id: 'item-1b', name: 'Sandwich', unit_price_paise: 15000, quantity: 1, line_total_paise: 15000 },
        ],
      };
      const bill2 = {
        id: 'bill-2',
        bill_number: 'UB-01002',
        order_number: 102,
        status: 'issued',
        issued_at: '2026-10-24T09:00:00.000Z',
        items_snapshot: [
          { id: 'item-2a', name: 'Pizza', unit_price_paise: 25000, quantity: 1, line_total_paise: 25000 },
          { id: 'item-2b', name: 'Garlic Bread', unit_price_paise: 12000, quantity: 1, line_total_paise: 12000 },
          { id: 'item-2c', name: 'Soda', unit_price_paise: 5000, quantity: 1, line_total_paise: 5000 },
        ],
      };

      // Request Page 1 with item limit = 3
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [bill1, bill2], error: null });

      const resPage1 = await getItems(makeAuthReq('http://localhost/api/reports/excel/items?limit=3'));
      expect(resPage1.status).toBe(200);

      const jsonPage1 = await resPage1.json();
      // Must NOT exceed limit (3 items)
      expect(jsonPage1.data.length).toBe(3);
      expect(jsonPage1.data.map((i: any) => i.item_id)).toEqual(['item-1a', 'item-1b', 'item-2a']);
      expect(jsonPage1.has_more).toBe(true);
      expect(jsonPage1.next_cursor).toBeDefined();

      // Verify the cursor encodes offset=1 for bill-2 (meaning item-2a was returned, next item is index 1: item-2b)
      const decodedCursor = decodeCursor(jsonPage1.next_cursor);
      expect(decodedCursor).toEqual({
        t: '2026-10-24T09:00:00.000Z',
        id: 'bill-2',
        offset: 1,
      });

      // Request Page 2 with item limit = 3 and the cursor from Page 1
      // Server queries bills starting at or after bill-2 (inclusive)
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [bill2], error: null });

      const resPage2 = await getItems(
        makeAuthReq(`http://localhost/api/reports/excel/items?limit=3&cursor=${jsonPage1.next_cursor}`)
      );
      expect(resPage2.status).toBe(200);

      const jsonPage2 = await resPage2.json();
      // Remaining 2 items of bill-2: item-2b and item-2c
      expect(jsonPage2.data.length).toBe(2);
      expect(jsonPage2.data.map((i: any) => i.item_id)).toEqual(['item-2b', 'item-2c']);
      expect(jsonPage2.has_more).toBe(false);
      expect(jsonPage2.next_cursor).toBeNull();

      // Verify query builder applied the correct inclusive tie-breaker (id.lte) when offset > 0
      expect(mockQueryBuilder.or).toHaveBeenCalledWith(
        'issued_at.lt.2026-10-24T09:00:00.000Z,and(issued_at.eq.2026-10-24T09:00:00.000Z,id.lte.bill-2)'
      );
    });

    it('unpacks items_snapshot into clean line items with correct INR prices', async () => {
      const mockBill = {
        id: 'bill-1',
        bill_number: 'UB-01001',
        order_number: 101,
        status: 'issued',
        issued_at: '2026-10-24T08:30:00.000Z',
        items_snapshot: [
          {
            id: 'item-1',
            name: 'Classic Cold Coffee',
            unit_price_paise: 12000,
            quantity: 2,
            line_total_paise: 24000,
            selected_options: [{ name: 'Extra Ice' }],
            note: 'Less sweet',
            is_custom: false,
          },
          {
            id: 'item-2',
            name: 'Custom Paneer Sandwich',
            unit_price_paise: 15000,
            quantity: 1,
            line_total_paise: 15000,
            selected_options: [],
            note: null,
            is_custom: true,
          },
        ],
      };

      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [mockBill], error: null });

      const res = await getItems(makeAuthReq('http://localhost/api/reports/excel/items'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.length).toBe(2);

      const item1 = json.data[0];
      expect(item1.bill_id).toBe('bill-1');
      expect(item1.bill_number).toBe('UB-01001');
      expect(item1.item_name).toBe('Classic Cold Coffee');
      expect(item1.item_type).toBe('Catalogue');
      expect(item1.quantity).toBe(2);
      expect(item1.unit_price_inr).toBe(120);
      expect(item1.line_total_inr).toBe(240);
      expect(item1.selected_options).toBe('Extra Ice');
      expect(item1.item_note).toBe('Less sweet');

      const item2 = json.data[1];
      expect(item2.item_name).toBe('Custom Paneer Sandwich');
      expect(item2.item_type).toBe('Custom Item');
      expect(item2.unit_price_inr).toBe(150);
      expect(item2.line_total_inr).toBe(150);
    });

    it('returns empty array cleanly when database has no bills or bills have no items', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

      const res = await getItems(makeAuthReq('http://localhost/api/reports/excel/items'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data).toEqual([]);
      expect(json.has_more).toBe(false);
      expect(json.next_cursor).toBeNull();
    });
  });

  describe('7. Audit Events Endpoint (/api/reports/excel/events)', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

    it('handles legitimate zero-result queries cleanly with HTTP 200', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

      const res = await getEvents(makeAuthReq('http://localhost/api/reports/excel/events'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data).toEqual([]);
      expect(json.next_cursor).toBeNull();
      expect(json.has_more).toBe(false);
      expect(json.page_size).toBe(0);
      expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    });

    it('returns formatted audit events with IST timestamps', async () => {
      const mockEvent = {
        id: 'event-uuid-1',
        bill_id: 'bill-uuid-1',
        bill_number: 'UB-01001',
        event_type: 'cancelled',
        actor_id: 'user-uuid-1',
        actor_role: 'admin',
        actor_email: 'owner@urbania.cafe',
        metadata: { reason: 'Incorrect table' },
        created_at: '2026-10-24T12:00:00.000Z',
      };

      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [mockEvent], error: null });

      const res = await getEvents(makeAuthReq('http://localhost/api/reports/excel/events?eventType=cancelled'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.length).toBe(1);

      const event = json.data[0];
      expect(event.event_id).toBe('event-uuid-1');
      expect(event.bill_number).toBe('UB-01001');
      expect(event.event_type).toBe('cancelled');
      expect(event.actor_role).toBe('admin');
      expect(event.actor_email).toBe('owner@urbania.cafe');
      expect(event.metadata).toEqual({ reason: 'Incorrect table' });
      expect(event.event_date_ist).toBeDefined();
      expect(event.event_time_ist).toBeDefined();
    });
  });

  describe('8. Power Query Client Error Transparency Simulation', () => {
    // Simulates the exact Power Query M evaluation logic from docs/excel-power-query.md
    async function simulatePowerQueryFetch(
      fetchPageFn: (cursor: string | null) => Promise<{ status: number; body: any }>
    ) {
      const fetchPage = async (cursor: string | null) => {
        const res = await fetchPageFn(cursor);
        const httpStatus = res.status;
        const parsedJson = res.body;

        const serverErrorMessage =
          parsedJson && parsedJson.error ? parsedJson.error : `HTTP ${httpStatus}`;

        if (httpStatus >= 400) {
          throw new Error(`Urbania Café API error (${httpStatus}): ${serverErrorMessage}`);
        }

        if (!parsedJson || !Array.isArray(parsedJson.data)) {
          throw new Error('Invalid API response structure: missing data array');
        }

        return parsedJson;
      };

      // M List.Generate equivalent
      const pages: any[][] = [];
      let currentPage = await fetchPage(null);

      while (currentPage && Array.isArray(currentPage.data)) {
        pages.push(currentPage.data);
        if (currentPage.has_more === true && currentPage.next_cursor) {
          currentPage = await fetchPage(currentPage.next_cursor);
        } else {
          break;
        }
      }

      // M List.Combine
      return pages.flat();
    }

    it('Power Query evaluation fails visibly on HTTP 401 and never silently creates an empty table', async () => {
      // Calling getBills without Authorization header results in 401
      const fetcher = async () => {
        const req = new NextRequest('http://localhost/api/reports/excel/bills');
        const res = await getBills(req);
        return { status: res.status, body: await res.json() };
      };

      await expect(simulatePowerQueryFetch(fetcher)).rejects.toThrow(
        /Urbania Café API error \(401\): Unauthorized/
      );
    });

    it('Power Query evaluation fails visibly on HTTP 500 when database error occurs', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection failed' },
      });

      const fetcher = async () => {
        const req = new NextRequest('http://localhost/api/reports/excel/bills', {
          headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        });
        const res = await getBills(req);
        return { status: res.status, body: await res.json() };
      };

      await expect(simulatePowerQueryFetch(fetcher)).rejects.toThrow(
        /Urbania Café API error \(500\): Failed to query bills/
      );
    });

    it('Power Query evaluation continues through a valid empty page when has_more is true', async () => {
      // Page 1 returns empty items with has_more: true
      const page1 = {
        data: [],
        next_cursor: encodeCursor('2026-10-24T10:00:00.000Z', 'uuid-1'),
        has_more: true,
        page_size: 0,
      };
      // Page 2 returns actual items with has_more: false
      const page2 = {
        data: [{ item_id: 'item-2', item_name: 'Hot Chocolate' }],
        next_cursor: null,
        has_more: false,
        page_size: 1,
      };

      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { status: 200, body: callCount === 1 ? page1 : page2 };
      };

      const result = await simulatePowerQueryFetch(fetcher);
      expect(result.length).toBe(1);
      expect(result[0].item_id).toBe('item-2');
      expect(callCount).toBe(2);
    });
  });

  describe('9. Multi-Batch Scanning Across Bills With Empty Item Snapshots', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

    it('scans through a first batch of bills with no items and returns valid items from a later batch in the same request', async () => {
      // When limit = 1, billsBatch = 6.
      // Batch 1 has 6 bills, all with empty items_snapshot: []
      const emptyBatch = Array.from({ length: 6 }, (_, i) => ({
        id: `empty-bill-${i + 1}`,
        bill_number: `UB-E${i + 1}`,
        issued_at: new Date(1700000000000 - i * 1000).toISOString(),
        items_snapshot: [],
      }));

      // Batch 2 has 2 bills with items
      const validBatch = [
        {
          id: 'valid-bill-1',
          bill_number: 'UB-V1',
          issued_at: new Date(1700000000000 - 10000).toISOString(),
          items_snapshot: [
            { id: 'item-v1', name: 'Masala Chai', unit_price_paise: 4000, quantity: 1, line_total_paise: 4000 },
          ],
        },
      ];

      // First query returns the full empty batch (length = 6 = billsBatch)
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: emptyBatch, error: null });
      // Second query returns the batch with items
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: validBatch, error: null });

      const res = await getItems(makeAuthReq('http://localhost/api/reports/excel/items?limit=1'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.length).toBe(1);
      expect(json.data[0].item_id).toBe('item-v1');
      expect(json.data[0].item_name).toBe('Masala Chai');
    });

    it('scans through multiple consecutive empty batches before finding bills with valid items', async () => {
      // Batch 1: 6 empty bills
      const emptyBatch1 = Array.from({ length: 6 }, (_, i) => ({
        id: `empty-b1-${i}`,
        bill_number: `UB-E1-${i}`,
        issued_at: new Date(1700000000000 - i * 1000).toISOString(),
        items_snapshot: [],
      }));
      // Batch 2: 6 empty bills
      const emptyBatch2 = Array.from({ length: 6 }, (_, i) => ({
        id: `empty-b2-${i}`,
        bill_number: `UB-E2-${i}`,
        issued_at: new Date(1700000000000 - (6 + i) * 1000).toISOString(),
        items_snapshot: [],
      }));
      // Batch 3: 1 bill with item
      const batchWithItem = [
        {
          id: 'item-bill-3',
          bill_number: 'UB-I3',
          issued_at: new Date(1700000000000 - 20000).toISOString(),
          items_snapshot: [
            { id: 'item-3x', name: 'Filter Coffee', unit_price_paise: 6000, quantity: 1, line_total_paise: 6000 },
          ],
        },
      ];

      mockQueryBuilder.limit.mockResolvedValueOnce({ data: emptyBatch1, error: null });
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: emptyBatch2, error: null });
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: batchWithItem, error: null });

      const res = await getItems(makeAuthReq('http://localhost/api/reports/excel/items?limit=1'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.length).toBe(1);
      expect(json.data[0].item_id).toBe('item-3x');
      expect(json.data[0].item_name).toBe('Filter Coffee');
    });

    it('preserves stable cursor ordering without skipping or duplicating items when resuming after empty batches', async () => {
      // 1 empty bill, then Bill A with 2 items, then 1 empty bill, then Bill B with 1 item
      const billEmpty1 = {
        id: 'bill-e1',
        bill_number: 'UB-E1',
        issued_at: '2026-10-24T12:00:00.000Z',
        items_snapshot: [],
      };
      const billA = {
        id: 'bill-a',
        bill_number: 'UB-A',
        issued_at: '2026-10-24T11:00:00.000Z',
        items_snapshot: [
          { id: 'item-a1', name: 'Item A1', unit_price_paise: 1000, quantity: 1, line_total_paise: 1000 },
          { id: 'item-a2', name: 'Item A2', unit_price_paise: 2000, quantity: 1, line_total_paise: 2000 },
        ],
      };
      const billEmpty2 = {
        id: 'bill-e2',
        bill_number: 'UB-E2',
        issued_at: '2026-10-24T10:00:00.000Z',
        items_snapshot: [],
      };
      const billB = {
        id: 'bill-b',
        bill_number: 'UB-B',
        issued_at: '2026-10-24T09:00:00.000Z',
        items_snapshot: [
          { id: 'item-b1', name: 'Item B1', unit_price_paise: 3000, quantity: 1, line_total_paise: 3000 },
        ],
      };

      // Page 1 with limit = 2
      mockQueryBuilder.limit.mockResolvedValueOnce({
        data: [billEmpty1, billA, billEmpty2, billB],
        error: null,
      });

      const res1 = await getItems(makeAuthReq('http://localhost/api/reports/excel/items?limit=2'));
      const json1 = await res1.json();

      expect(json1.data.length).toBe(2);
      expect(json1.data.map((i: any) => i.item_id)).toEqual(['item-a1', 'item-a2']);
      expect(json1.has_more).toBe(true);

      // Page 2 resuming from cursor
      mockQueryBuilder.limit.mockResolvedValueOnce({
        data: [billEmpty2, billB],
        error: null,
      });

      const res2 = await getItems(
        makeAuthReq(`http://localhost/api/reports/excel/items?limit=2&cursor=${json1.next_cursor}`)
      );
      const json2 = await res2.json();

      expect(json2.data.length).toBe(1);
      expect(json2.data[0].item_id).toBe('item-b1');
      expect(json2.has_more).toBe(false);
      expect(json2.next_cursor).toBeNull();
    });
  });
});
