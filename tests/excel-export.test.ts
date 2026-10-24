import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getBills, POST as postBills, PUT as putBills, DELETE as deleteBills } from '@/app/api/reports/excel/bills/route';
import { GET as getItems, POST as postItems, PUT as putItems, DELETE as deleteItems } from '@/app/api/reports/excel/items/route';
import { GET as getEvents, POST as postEvents, PUT as putEvents, DELETE as deleteEvents } from '@/app/api/reports/excel/events/route';
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
      // Query param token should be rejected if Authorization header is missing
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

  describe('3. Query Parameter Validation', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

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

    it('rejects invalid startDate format with HTTP 400', async () => {
      const res = await getBills(makeAuthReq('http://localhost/api/reports/excel/bills?startDate=invalid-date'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid startDate');
    });

    it('rejects startDate > endDate with HTTP 400', async () => {
      const res = await getBills(
        makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-10-25&endDate=2026-10-20')
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('startDate cannot be after endDate');
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

  describe('4. Bills Endpoint (/api/reports/excel/bills)', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

    it('handles empty results cleanly', async () => {
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

    it('applies date-range and status filters correctly', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

      await getBills(
        makeAuthReq('http://localhost/api/reports/excel/bills?startDate=2026-10-01&endDate=2026-10-15&status=issued&orderSource=qr')
      );

      expect(mockQueryBuilder.gte).toHaveBeenCalledWith('issued_at', '2026-10-01T00:00:00.000Z');
      expect(mockQueryBuilder.lte).toHaveBeenCalledWith('issued_at', '2026-10-15T23:59:59.999Z');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('status', 'issued');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('order_source', 'qr');
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
      // Limit requested: 2. Return 3 rows (limit + 1)
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

      // Validate cursor payload
      const decoded = decodeCursor(json.next_cursor);
      expect(decoded).toEqual({
        t: '2026-10-24T09:00:00.000Z',
        id: 'uuid-2',
      });
    });

    it('applies decoded cursor in subsequent page query', async () => {
      const cursor = encodeCursor('2026-10-24T09:00:00.000Z', 'uuid-2');
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

      await getBills(makeAuthReq(`http://localhost/api/reports/excel/bills?cursor=${cursor}&sort=desc`));

      expect(mockQueryBuilder.or).toHaveBeenCalledWith(
        'issued_at.lt.2026-10-24T09:00:00.000Z,and(issued_at.eq.2026-10-24T09:00:00.000Z,id.lt.uuid-2)'
      );
    });

    it('paginates deterministically across more than 1,000 records without truncation', async () => {
      // Simulate retrieving 1,500 records across 3 batches of 500 records
      const totalRecords = 1500;
      const batchSize = 500;
      let currentCursor: string | null = null;
      let fetchedTotal = 0;

      for (let batch = 0; batch < 3; batch++) {
        // Return 501 rows for batch 0 and 1, and 500 rows for batch 2
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

  describe('5. Bill Items Endpoint (/api/reports/excel/items)', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

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

    it('returns empty array cleanly when bills have no items', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

      const res = await getItems(makeAuthReq('http://localhost/api/reports/excel/items'));
      const json = await res.json();
      expect(json.data).toEqual([]);
      expect(json.has_more).toBe(false);
      expect(json.next_cursor).toBeNull();
    });
  });

  describe('6. Audit Events Endpoint (/api/reports/excel/events)', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

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

    it('gracefully handles missing database table without crashing', async () => {
      mockQueryBuilder.limit.mockResolvedValueOnce({
        data: null,
        error: { message: 'relation "bill_audit_events" does not exist' },
      });

      const res = await getEvents(makeAuthReq('http://localhost/api/reports/excel/events'));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual([]);
      expect(json.has_more).toBe(false);
      expect(json.next_cursor).toBeNull();
    });
  });
});
