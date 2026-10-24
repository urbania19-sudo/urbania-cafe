// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { calculateBillDiscount, type Bill, SAMPLE_BILL } from '../src/lib/billing';
import { renderReceiptToCanvas } from '../src/lib/thermal-canvas';
import { POST as postBill, GET as getBill } from '../src/app/api/staff/orders/[orderId]/bill/route';
import { GET as getExcelBills } from '../src/app/api/reports/excel/bills/route';

// Mock Supabase Auth Server for API testing
const mockUser = { id: 'staff-user-uuid', email: 'staff@urbania.cafe' };
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/auth-server', () => ({
  authDb: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockUser },
        error: null,
      })),
    },
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

// Mock Supabase Server adminDb for Excel export testing
const mockAdminQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};

const mockAdminDb = {
  from: vi.fn(() => mockAdminQueryBuilder),
};

vi.mock('@/lib/supabase/server', () => ({
  adminDb: vi.fn(() => mockAdminDb),
}));

vi.mock('@/lib/preview-guard', () => ({
  enforcePreviewWriteGuard: vi.fn(() => null),
}));

describe('Urbania Café — Bill-Level Discounts Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Calculation Engine & Validation (calculateBillDiscount)', () => {
    it('Case 1: No discount leaves current bill total unchanged with hasDiscount false', () => {
      const result = calculateBillDiscount(50000, null);
      expect(result.subtotalBeforeDiscountPaise).toBe(50000);
      expect(result.discountPaise).toBe(0);
      expect(result.totalPaise).toBe(50000);
      expect(result.hasDiscount).toBe(false);
      expect(result.discountType).toBeNull();
      expect(result.discountValue).toBeNull();
    });

    it('Case 2: Zero discount results in hasDiscount false and unchanged total', () => {
      const fixedZero = calculateBillDiscount(50000, { type: 'fixed', value: 0 });
      expect(fixedZero.hasDiscount).toBe(false);
      expect(fixedZero.discountPaise).toBe(0);
      expect(fixedZero.totalPaise).toBe(50000);

      const percentZero = calculateBillDiscount(50000, { type: 'percentage', value: 0 });
      expect(percentZero.hasDiscount).toBe(false);
      expect(percentZero.discountPaise).toBe(0);
      expect(percentZero.totalPaise).toBe(50000);
    });

    it('Case 3: Fixed-amount discount of ₹50 on ₹500 bill results in ₹450 payable', () => {
      // 50000 paise = ₹500.00, ₹50.00 = 5000 paise
      const result = calculateBillDiscount(50000, { type: 'fixed', value: 50 });
      expect(result.subtotalBeforeDiscountPaise).toBe(50000);
      expect(result.discountPaise).toBe(5000);
      expect(result.totalPaise).toBe(45000);
      expect(result.hasDiscount).toBe(true);
      expect(result.discountType).toBe('fixed');
      expect(result.discountValue).toBe(50);
    });

    it('Case 4: Percentage discount of 10% on ₹500 bill results in ₹450 payable', () => {
      const result = calculateBillDiscount(50000, { type: 'percentage', value: 10 });
      expect(result.subtotalBeforeDiscountPaise).toBe(50000);
      expect(result.discountPaise).toBe(5000);
      expect(result.totalPaise).toBe(45000);
      expect(result.hasDiscount).toBe(true);
      expect(result.discountType).toBe('percentage');
      expect(result.discountValue).toBe(10);
    });

    it('Case 5: Deterministic percentage rounding to nearest paise', () => {
      // ₹33.33 bill = 3333 paise, 10% discount = 333.3 paise -> rounds to 333 paise
      const res1 = calculateBillDiscount(3333, { type: 'percentage', value: 10 });
      expect(res1.discountPaise).toBe(333);
      expect(res1.totalPaise).toBe(3000);

      // ₹33.35 bill = 3335 paise, 10% discount = 333.5 paise -> rounds to 334 paise
      const res2 = calculateBillDiscount(3335, { type: 'percentage', value: 10 });
      expect(res2.discountPaise).toBe(334);
      expect(res2.totalPaise).toBe(3001);
    });

    it('Case 6: 100% discount results in zero payable, never negative', () => {
      const result = calculateBillDiscount(50000, { type: 'percentage', value: 100 });
      expect(result.subtotalBeforeDiscountPaise).toBe(50000);
      expect(result.discountPaise).toBe(50000);
      expect(result.totalPaise).toBe(0);
      expect(result.hasDiscount).toBe(true);
    });

    it('Case 7: Rejects negative, malformed, over-100%, and over-total discounts', () => {
      // Negative fixed
      expect(() => calculateBillDiscount(50000, { type: 'fixed', value: -10 })).toThrow(
        /Fixed discount amount must be greater than zero/
      );

      // Negative percentage
      expect(() => calculateBillDiscount(50000, { type: 'percentage', value: -5 })).toThrow(
        /Percentage discount must be between 0 and 100/
      );

      // Over 100% percentage
      expect(() => calculateBillDiscount(50000, { type: 'percentage', value: 101 })).toThrow(
        /Percentage discount must be between 0 and 100/
      );

      // Fixed discount exceeding total bill
      expect(() => calculateBillDiscount(50000, { type: 'fixed', value: 501 })).toThrow(
        /Discount amount cannot exceed total bill amount/
      );

      // Invalid discount type
      expect(() =>
        calculateBillDiscount(50000, { type: 'arbitrary' as any, value: 50 })
      ).toThrow(/Invalid discount type/);
    });
  });

  describe('2. Server-side API & Idempotency (/api/staff/orders/[orderId]/bill)', () => {
    const validOrderId = 'a0000000-0000-4000-8000-000000000001';

    it('Case 8: Server independently receives and validates discount params, never trusting manipulated client totals', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          ok: true,
          already_issued: false,
          bill: {
            id: 'bill-1',
            order_id: validOrderId,
            subtotal_before_discount_paise: 50000,
            discount_type: 'percentage',
            discount_value: 10,
            discount_paise: 5000,
            total_paise: 45000,
          },
        },
        error: null,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/bill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          discount_type: 'percentage',
          discount_value: 10,
        }),
      });

      const res = await postBill(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(200);

      // Verify RPC was called with trusted server arguments
      expect(mockRpc).toHaveBeenCalledWith('generate_bill', {
        p_order_id: validOrderId,
        p_discount_type: 'percentage',
        p_discount_value: 10,
      });
    });

    it('Case 7b: Server rejects invalid discount payload before hitting the database', async () => {
      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/bill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          discount_type: 'percentage',
          discount_value: 150, // invalid > 100%
        }),
      });

      const res = await postBill(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Percentage discount must be between 0 and 100');
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('Case 9: Retry of bill generation returns already_issued without applying discount twice', async () => {
      const existingBill = {
        id: 'bill-1',
        order_id: validOrderId,
        bill_number: 'UB-00100',
        subtotal_before_discount_paise: 50000,
        discount_type: 'fixed',
        discount_value: 50,
        discount_paise: 5000,
        total_paise: 45000,
      };

      mockRpc.mockResolvedValueOnce({
        data: {
          ok: true,
          already_issued: true,
          bill: existingBill,
        },
        error: null,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/bill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          discount_type: 'fixed',
          discount_value: 50,
        }),
      });

      const res = await postBill(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.already_issued).toBe(true);
      expect(data.bill.total_paise).toBe(45000); // Unaltered, exact same bill
    });
  });

  describe('3. Thermal Receipt Rendering & Canvas Parity (renderReceiptToCanvas)', () => {
    it('Case 10 & 11: Non-discount bill prints cleanly without any discount row or zero discount', () => {
      const textCalls: string[] = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;

      (HTMLCanvasElement.prototype as any).getContext = function () {
        const ctx = origGetContext.call(this, '2d');
        return {
          ...ctx,
          fillText: (text: string) => textCalls.push(text),
          measureText: () => ({ width: 50 }),
          fillRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
        };
      };

      const nonDiscountBill: Bill = {
        ...SAMPLE_BILL,
        subtotal_paise: 50000,
        total_paise: 50000,
        discount_paise: 0,
        discount_type: null,
        discount_value: null,
      };

      renderReceiptToCanvas(nonDiscountBill, { scale: 1 });
      (HTMLCanvasElement.prototype as any).getContext = origGetContext;

      // Must show standard subtotal and total
      expect(textCalls).toContain('Subtotal:');
      expect(textCalls).toContain('TOTAL AMOUNT:');

      // Must NEVER contain discount rows
      expect(textCalls.some((t) => t.toLowerCase().includes('discount'))).toBe(false);
      expect(textCalls.some((t) => t.includes('-₹0'))).toBe(false);
      expect(textCalls).not.toContain('AMOUNT TO PAY:');
      expect(textCalls).not.toContain('BILL TOTAL:');
    });

    it('Case 11 & 12: Discounted bill prints breakdown and canvas height accounts for extra lines without clipping', () => {
      const textCalls: string[] = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;

      (HTMLCanvasElement.prototype as any).getContext = function () {
        const ctx = origGetContext.call(this, '2d');
        return {
          ...ctx,
          fillText: (text: string) => textCalls.push(text),
          measureText: () => ({ width: 50 }),
          fillRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
        };
      };

      const discountedBill: Bill = {
        ...SAMPLE_BILL,
        subtotal_before_discount_paise: 50000,
        subtotal_paise: 50000,
        discount_type: 'percentage',
        discount_value: 10,
        discount_paise: 5000,
        total_paise: 45000,
      };

      const canvas = renderReceiptToCanvas(discountedBill, { scale: 1 });
      (HTMLCanvasElement.prototype as any).getContext = origGetContext;

      // Must render clear breakdown
      expect(textCalls).toContain('BILL TOTAL:');
      expect(textCalls).toContain('₹500.00');
      expect(textCalls).toContain('Discount (10%):');
      expect(textCalls).toContain('-₹50.00');
      expect(textCalls).toContain('AMOUNT TO PAY:');
      expect(textCalls).toContain('₹450.00');

      // Standard non-discount headings should not be used
      expect(textCalls).not.toContain('TOTAL AMOUNT:');
      expect(textCalls).not.toContain('Subtotal:');

      // Canvas height must be positive and non-zero
      expect(canvas.height).toBeGreaterThan(300);
    });

    it('Case 10b: Historical bills without discount fields display correctly without crashing', () => {
      const textCalls: string[] = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;

      (HTMLCanvasElement.prototype as any).getContext = function () {
        const ctx = origGetContext.call(this, '2d');
        return {
          ...ctx,
          fillText: (text: string) => textCalls.push(text),
          measureText: () => ({ width: 50 }),
          fillRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
        };
      };

      // Simulates historical DB row where discount fields were not present
      const historicalBill: any = {
        ...SAMPLE_BILL,
        subtotal_before_discount_paise: undefined,
        discount_type: undefined,
        discount_value: undefined,
        discount_paise: undefined,
      };

      expect(() => renderReceiptToCanvas(historicalBill, { scale: 1 })).not.toThrow();
      (HTMLCanvasElement.prototype as any).getContext = origGetContext;

      expect(textCalls).toContain('Subtotal:');
      expect(textCalls).toContain('TOTAL AMOUNT:');
      expect(textCalls.some((t) => t.toLowerCase().includes('discount'))).toBe(false);
    });
  });

  describe('4. Excel Reporting Integration (/api/reports/excel/bills)', () => {
    const makeAuthReq = (url: string) =>
      new NextRequest(url, { headers: { Authorization: 'Bearer test-excel-token' } });

    it('Case 13: Excel bills report returns correct original total, discount fields, and payable total', async () => {
      const rows = [
        // Row 1: Bill with 10% discount
        {
          id: 'bill-disc-1',
          bill_number: 'UB-00101',
          order_id: 'ord-1',
          order_number: 101,
          table_number: 1,
          table_label: 'Table 1',
          status: 'issued',
          subtotal_before_discount_paise: 50000,
          discount_type: 'percentage',
          discount_value: 10,
          discount_paise: 5000,
          subtotal_paise: 50000,
          tax_rate: 0,
          tax_paise: 0,
          total_paise: 45000, // Final payable
          issued_at: '2026-10-24T10:00:00.000Z',
          orders: { customer_name: 'Rahul', guest_count: 2, service_mode: 'dine_in', order_source: 'qr' },
        },
        // Row 2: Bill without discount (or historical bill)
        {
          id: 'bill-hist-2',
          bill_number: 'UB-00102',
          order_id: 'ord-2',
          order_number: 102,
          table_number: 2,
          table_label: 'Table 2',
          status: 'issued',
          subtotal_before_discount_paise: 20000,
          discount_type: null,
          discount_value: null,
          discount_paise: 0,
          subtotal_paise: 20000,
          tax_rate: 0,
          tax_paise: 0,
          total_paise: 20000,
          issued_at: '2026-10-24T09:00:00.000Z',
          orders: { customer_name: 'Priya', guest_count: 1, service_mode: 'counter', order_source: 'manual' },
        },
      ];

      mockAdminQueryBuilder.limit.mockResolvedValueOnce({ data: rows, error: null });

      // Mock process.env.URBANIA_EXCEL_EXPORT_TOKEN
      const origToken = process.env.URBANIA_EXCEL_EXPORT_TOKEN;
      process.env.URBANIA_EXCEL_EXPORT_TOKEN = 'test-excel-token';

      try {
        const res = await getExcelBills(makeAuthReq('http://localhost/api/reports/excel/bills'));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.length).toBe(2);

        // Record 1 (with discount)
        const rec1 = json.data[0];
        expect(rec1.original_total_paise).toBe(50000);
        expect(rec1.original_total_inr).toBe(500);
        expect(rec1.discount_type).toBe('percentage');
        expect(rec1.discount_value).toBe(10);
        expect(rec1.discount_paise).toBe(5000);
        expect(rec1.discount_inr).toBe(50);
        expect(rec1.total_paise).toBe(45000);
        expect(rec1.total_inr).toBe(450);

        // Record 2 (no discount)
        const rec2 = json.data[1];
        expect(rec2.original_total_paise).toBe(20000);
        expect(rec2.original_total_inr).toBe(200);
        expect(rec2.discount_type).toBeNull();
        expect(rec2.discount_value).toBeNull();
        expect(rec2.discount_paise).toBe(0);
        expect(rec2.discount_inr).toBe(0);
        expect(rec2.total_paise).toBe(20000);
        expect(rec2.total_inr).toBe(200);
      } finally {
        process.env.URBANIA_EXCEL_EXPORT_TOKEN = origToken;
      }
    });
  });
});
