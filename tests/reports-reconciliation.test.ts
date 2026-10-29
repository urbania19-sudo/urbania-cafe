// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  getDailyServiceMetrics,
  getTimezoneDateBounds,
  getTodayDateString,
  parseReportSearch,
} from '@/lib/reports';

describe('Reporting Reconciliation & Deterministic Audit Suite', () => {
  const targetDate = '2026-10-28';
  const timezone = 'Asia/Kolkata';

  // Helper to create a mock Supabase database that filters fixtures based on gte/lte bounds
  function createMockDb(fixtures: {
    orders?: any[];
    bills?: any[];
    customerPayments?: any[];
    settlements?: any[];
  }) {
    return {
      from: (table: string) => ({
        select: () => ({
          in: (col: string, vals: any[]) => {
            const allRows =
              table === 'orders'
                ? fixtures.orders || []
                : table === 'bills'
                ? fixtures.bills || []
                : table === 'customer_payments'
                ? fixtures.customerPayments || []
                : table === 'admin_credit_settlements'
                ? fixtures.settlements || []
                : [];
            const filtered = allRows.filter((r) => vals.includes(r[col]));
            return Promise.resolve({ data: filtered, error: null });
          },
          gte: (colGte: string, startIso: string) => ({
            lte: (colLte: string, endIso: string) => {
              const allRows =
                table === 'orders'
                  ? fixtures.orders || []
                  : table === 'bills'
                  ? fixtures.bills || []
                  : table === 'customer_payments'
                  ? fixtures.customerPayments || []
                  : table === 'admin_credit_settlements'
                  ? fixtures.settlements || []
                  : [];

              // Deterministic in-memory range filtering matching database ISO comparison
              const filtered = allRows.filter((row) => {
                const val = row[colGte] || row[colLte];
                if (!val) return true;
                return val >= startIso && val <= endIso;
              });

              return Promise.resolve({ data: filtered, error: null });
            },
          }),
        }),
      }),
    };
  }

  // ===========================================================================
  // 1. Business-day boundaries in Asia/Kolkata around midnight
  // ===========================================================================
  describe('1. Business-day boundaries in Asia/Kolkata', () => {
    it('computes exact UTC ISO timestamps for 00:00:00.000 IST to 23:59:59.999 IST', () => {
      const bounds = getTimezoneDateBounds('2026-10-28', 'Asia/Kolkata');
      // IST is UTC+5:30.
      // 2026-10-28 00:00:00.000 IST = 2026-10-27 18:30:00.000 UTC
      expect(bounds.startUtcIso).toBe('2026-10-27T18:30:00.000Z');
      // 2026-10-28 23:59:59.999 IST = 2026-10-28 18:29:59.999 UTC
      expect(bounds.endUtcIso).toBe('2026-10-28T18:29:59.999Z');
      expect(bounds.dateStr).toBe('2026-10-28');
    });

    it('strictly isolates midnight transactions into their respective business days', async () => {
      // Order A: 2026-10-27 23:59:59 IST (UTC 18:29:59Z) -> Previous business day
      // Order B: 2026-10-28 00:00:01 IST (UTC 18:30:01Z) -> Target business day (2026-10-28)
      // Order C: 2026-10-28 23:59:59 IST (UTC 18:29:59Z on 28th) -> Target business day (2026-10-28)
      // Order D: 2026-10-29 00:00:01 IST (UTC 18:30:01Z on 28th) -> Next business day
      const orders = [
        {
          id: 'ord-prev-day',
          order_number: 100,
          status: 'COMPLETED',
          total_paise: 15000,
          subtotal_paise: 15000,
          order_source: 'qr',
          created_at: '2026-10-27T18:29:59.000Z', // 23:59:59 IST on 27th
        },
        {
          id: 'ord-curr-morning',
          order_number: 101,
          status: 'COMPLETED',
          total_paise: 20000,
          subtotal_paise: 20000,
          order_source: 'qr',
          created_at: '2026-10-27T18:30:01.000Z', // 00:00:01 IST on 28th
        },
        {
          id: 'ord-curr-night',
          order_number: 102,
          status: 'COMPLETED',
          total_paise: 30000,
          subtotal_paise: 30000,
          order_source: 'qr',
          created_at: '2026-10-28T18:29:59.000Z', // 23:59:59 IST on 28th
        },
        {
          id: 'ord-next-day',
          order_number: 103,
          status: 'COMPLETED',
          total_paise: 40000,
          subtotal_paise: 40000,
          order_source: 'qr',
          created_at: '2026-10-28T18:30:01.000Z', // 00:00:01 IST on 29th
        },
      ];

      const mockDb = createMockDb({ orders });
      const metrics = await getDailyServiceMetrics(mockDb as any, '2026-10-28', 'Asia/Kolkata');

      // Only ord-curr-morning (20000) and ord-curr-night (30000) must be included!
      expect(metrics.orderCount).toBe(2);
      expect(metrics.grossSalesPaise).toBe(50000); // 20000 + 30000
    });
  });

  // ===========================================================================
  // 2. Comprehensive Reconciliation with Deterministic Numerical Fixtures
  // ===========================================================================
  describe('2. Exact Reconciliation of Collections, Sales, Discounts, and Outstanding', () => {
    it('aggregates exact amounts across Cash, UPI, Unclassified, Settlements, Discounts, and Cancelled Bills', async () => {
      // -----------------------------------------------------------------------
      // Controlled Order Fixtures
      // -----------------------------------------------------------------------
      const orders = [
        // 1. QR customer order: subtotal 25000, COMPLETED
        {
          id: 'o-1',
          order_number: 201,
          status: 'COMPLETED',
          subtotal_paise: 25000,
          total_paise: 25000,
          order_source: 'qr',
          payment_status: 'paid',
          paid_paise: 22000,
          created_at: '2026-10-28T05:00:00Z',
        },
        // 2. Manual customer order: subtotal 18000, ACTIVE (PREPARING)
        {
          id: 'o-2',
          order_number: 202,
          status: 'PREPARING',
          subtotal_paise: 18000,
          total_paise: 18000,
          order_source: 'manual',
          payment_status: 'unpaid',
          paid_paise: 0,
          created_at: '2026-10-28T06:00:00Z',
        },
        // 3. Cancelled customer order: subtotal 12000, CANCELLED
        {
          id: 'o-3',
          order_number: 203,
          status: 'CANCELLED',
          subtotal_paise: 12000,
          total_paise: 12000,
          order_source: 'qr',
          payment_status: 'unpaid',
          paid_paise: 0,
          created_at: '2026-10-28T07:00:00Z',
        },
        // 4. Swiggy delivery platform order: subtotal 35000, COMPLETED
        {
          id: 'o-4',
          order_number: 204,
          status: 'COMPLETED',
          subtotal_paise: 35000,
          total_paise: 35000,
          order_source: 'swiggy',
          payment_status: 'external',
          paid_paise: 35000,
          created_at: '2026-10-28T08:00:00Z',
        },
        // 5. Admin credit order: total 40000, paid 15000, unpaid remaining 25000
        {
          id: 'o-5',
          order_number: 205,
          status: 'COMPLETED',
          subtotal_paise: 40000,
          total_paise: 40000,
          order_source: 'admin_credit',
          payment_status: 'partially_paid',
          paid_paise: 15000,
          created_at: '2026-10-28T09:00:00Z',
        },
        // 6. Pre-ledger legacy customer order 1: subtotal 8000, COMPLETED (linked to b-legacy-cash)
        {
          id: 'o-legacy-1',
          order_number: 206,
          status: 'COMPLETED',
          subtotal_paise: 8000,
          total_paise: 8000,
          order_source: 'manual',
          payment_status: 'paid',
          paid_paise: 7500,
          created_at: '2026-10-28T07:30:00Z',
        },
        // 7. Pre-ledger legacy customer order 2: subtotal 6000, COMPLETED (linked to b-legacy-unclassified)
        {
          id: 'o-legacy-2',
          order_number: 207,
          status: 'COMPLETED',
          subtotal_paise: 6000,
          total_paise: 6000,
          order_source: 'qr',
          payment_status: 'paid',
          paid_paise: 6000,
          created_at: '2026-10-28T08:00:00Z',
        },
      ];

      // -----------------------------------------------------------------------
      // Controlled Bill Fixtures
      // -----------------------------------------------------------------------
      const bills = [
        // Bill 1: For order o-1. Subtotal 25000, discount 3000, total 22000. Status issued. Paid 22000. Has ledger rows.
        {
          id: 'b-1',
          order_id: 'o-1',
          order_number: 201,
          status: 'issued',
          subtotal_paise: 25000,
          discount_paise: 3000,
          tax_paise: 0,
          total_paise: 22000,
          order_source: 'qr',
          payment_status: 'paid',
          payment_method: 'upi',
          paid_paise: 22000,
          issued_at: '2026-10-28T05:30:00Z',
        },
        // Bill 2: For order o-2. Subtotal 18000, discount 0, total 18000. Status issued. Unpaid.
        {
          id: 'b-2',
          order_id: 'o-2',
          order_number: 202,
          status: 'issued',
          subtotal_paise: 18000,
          discount_paise: 0,
          tax_paise: 0,
          total_paise: 18000,
          order_source: 'manual',
          payment_status: 'unpaid',
          payment_method: null,
          paid_paise: 0,
          issued_at: '2026-10-28T06:30:00Z',
        },
        // Bill 3: Cancelled bill (e.g. reprint error). Subtotal 10000, total 10000. Status cancelled.
        {
          id: 'b-3',
          order_id: 'o-cancelled',
          order_number: 299,
          status: 'cancelled',
          subtotal_paise: 10000,
          discount_paise: 1000,
          tax_paise: 0,
          total_paise: 9000,
          order_source: 'qr',
          payment_status: 'unpaid',
          payment_method: null,
          paid_paise: 0,
          issued_at: '2026-10-28T07:15:00Z',
        },
        // Bill 4: Legacy bill with NO ledger entries. Subtotal 8000, discount 500, net 7500. payment_method='cash', paid_paise=7500.
        {
          id: 'b-legacy-cash',
          order_id: 'o-legacy-1',
          order_number: 206,
          status: 'issued',
          subtotal_paise: 8000,
          discount_paise: 500,
          tax_paise: 0,
          total_paise: 7500,
          order_source: 'manual',
          payment_status: 'paid',
          payment_method: 'cash',
          paid_paise: 7500,
          issued_at: '2026-10-28T08:00:00Z',
        },
        // Bill 5: Legacy bill with NO ledger entries. Subtotal 6000, discount 0, net 6000. payment_method='cheque' (unclassified), paid_paise=6000.
        {
          id: 'b-legacy-unclassified',
          order_id: 'o-legacy-2',
          order_number: 207,
          status: 'issued',
          subtotal_paise: 6000,
          discount_paise: 0,
          tax_paise: 0,
          total_paise: 6000,
          order_source: 'qr',
          payment_status: 'paid',
          payment_method: 'cheque',
          paid_paise: 6000,
          issued_at: '2026-10-28T08:30:00Z',
        },
      ];

      // -----------------------------------------------------------------------
      // Controlled Customer Payment Ledger Fixtures
      // -----------------------------------------------------------------------
      const customerPayments = [
        // Payment 1 for Bill 1: 12000 paise Cash, completed
        {
          bill_id: 'b-1',
          payment_method: 'cash',
          amount_paise: 12000,
          status: 'completed',
          paid_at: '2026-10-28T05:35:00Z',
        },
        // Payment 2 for Bill 1: 10000 paise UPI, completed
        {
          bill_id: 'b-1',
          payment_method: 'upi',
          amount_paise: 10000,
          status: 'completed',
          paid_at: '2026-10-28T05:40:00Z',
        },
        // Payment 3: Unclassified payment method (e.g. 'card' or 'other') for another bill: 4500 paise, completed
        {
          bill_id: 'b-card-test',
          payment_method: 'card',
          amount_paise: 4500,
          status: 'completed',
          paid_at: '2026-10-28T09:00:00Z',
        },
        // Payment 4: Historical payment row audit-classified with status='refunded' (5000 paise)
        {
          bill_id: 'b-refund-test',
          payment_method: 'upi',
          amount_paise: 5000,
          status: 'refunded',
          paid_at: '2026-10-28T10:00:00Z',
        },
      ];

      // -----------------------------------------------------------------------
      // Controlled Admin Credit Settlement Fixtures
      // -----------------------------------------------------------------------
      const settlements = [
        // Settlement for order o-5: 15000 paise received via Bank Transfer
        {
          amount_paise: 15000,
          settled_at: '2026-10-28T11:00:00Z',
        },
      ];

      const mockDb = createMockDb({ orders, bills, customerPayments, settlements });
      const metrics = await getDailyServiceMetrics(mockDb as any, targetDate, timezone);

      // -----------------------------------------------------------------------
      // Exact Numerical Verification
      // -----------------------------------------------------------------------

      // 1. Order Volume Breakdown:
      // Total orders = 7. Cancelled = 1 (o-3).
      // Non-cancelled = 6 (o-1, o-2, o-4, o-5, o-legacy-1, o-legacy-2).
      expect(metrics.orderCount).toBe(6);
      expect(metrics.cancelledOrderCount).toBe(1);
      // Completed = 5 (o-1, o-4, o-5, o-legacy-1, o-legacy-2)
      expect(metrics.completedOrderCount).toBe(5);
      // Active = 1 (o-2)
      expect(metrics.activeOrderCount).toBe(1);
      // Customer orders (QR + manual) = 4 (o-1, o-2, o-legacy-1, o-legacy-2)
      expect(metrics.customerOrderCount).toBe(4);
      // Platform orders = 1 (o-4)
      expect(metrics.externalPlatformCount).toBe(1);
      // Admin credit orders = 1 (o-5)
      expect(metrics.adminCreditCount).toBe(1);

      // 2. Gross vs Net Sales and Discounts:
      // Gross sales = customer orders (o-1: 25000 + o-2: 18000 + o-legacy-1: 8000 + o-legacy-2: 6000) = 57000 paise
      expect(metrics.grossSalesPaise).toBe(57000);
      // Issued customer bills = b-1 (disc: 3000, tot: 22000), b-2 (disc: 0, tot: 18000),
      //                         b-legacy-cash (disc: 500, tot: 7500), b-legacy-unclassified (disc: 0, tot: 6000)
      // Cancelled bill b-3 is strictly excluded!
      // Total discounts = 3000 + 0 + 500 + 0 = 3500 paise
      expect(metrics.discountsPaise).toBe(3500);
      // Net billed customer sales = 22000 + 18000 + 7500 + 6000 = 53500 paise
      expect(metrics.netSalesPaise).toBe(53500);
      // In this intra-day scenario where every bill corresponds to an order placed today:
      // Gross Customer Sales (57000) - Discounts (3500) === Net Billed Sales (53500)
      expect(metrics.grossSalesPaise - metrics.discountsPaise).toBe(metrics.netSalesPaise);

      // 3. Cash Collections:
      // Ledger Cash (b-1): 12000
      // Legacy Cash (b-legacy-cash): 7500
      // Total cash = 19500 paise
      expect(metrics.cashCollectedPaise).toBe(19500);

      // 4. UPI/Online Collections:
      // Ledger UPI (b-1): 10000 paise
      expect(metrics.onlineCollectedPaise).toBe(10000);

      // 5. Unclassified Collections:
      // Ledger 'card' payment: 4500 paise
      // Legacy 'cheque' bill: 6000 paise
      // Total unclassified = 10500 paise
      expect(metrics.unclassifiedCollectedPaise).toBe(10500);

      // 6. Net Recorded Customer Collections:
      // 19500 (cash) + 10000 (upi) + 10500 (unclassified) = 40000 paise
      expect(metrics.customerCollectedPaise).toBe(40000);

      // 7. Audit Status Classification ('refunded'):
      // 5000 paise historical payment record classified as 'refunded' for audit inspection.
      // Financial refunds, partial refunds, and payment reversals are not implemented;
      // this is an audit classification of an existing record, not a refund transaction or confirmed payout.
      expect(metrics.customerRefundsPaise).toBe(5000);
      expect(metrics.historicalRefundClassifiedPaise).toBe(5000);
      expect(metrics.historicalRefundClassifiedPaise).toBe(metrics.customerRefundsPaise);
      // Confirmed that historical 'refunded' rows are strictly excluded from completed customer collections:
      expect(metrics.customerCollectedPaise).toBe(40000);
      // Confirmed that historical 'refunded' rows are not subtracted a second time from net sales:
      expect(metrics.netSalesPaise).toBe(53500);

      // 8. Customer Outstanding Balance:
      // Unpaid bill b-2: 18000 paise
      expect(metrics.customerOutstandingPaise).toBe(18000);

      // 9. Admin Credit Breakdown:
      // Total consumption = 40000 paise (o-5)
      expect(metrics.adminCreditTotalPaise).toBe(40000);
      // Settled today = 15000 paise
      expect(metrics.adminCreditSettledTodayPaise).toBe(15000);
      // Outstanding admin credit = 40000 - 15000 = 25000 paise
      expect(metrics.adminCreditOutstandingPaise).toBe(25000);

      // 10. External Delivery Platform Value:
      // Swiggy order o-4: 35000 paise. (Managed externally, NOT collected by cafe)
      expect(metrics.externalPlatformValuePaise).toBe(35000);

      // 11. Total Actual Collections Received by Café:
      // Customer collections (40000) + Settled admin credit (15000) = 55000 paise
      expect(metrics.totalCollectedPaise).toBe(55000);
      expect(metrics.collectedPaise).toBe(55000);
    });

    it('does not double-count a bill when customerPayments exist for that bill', async () => {
      // Bill with paid_paise=10000 in bills table, but also has a customer_payments row of 10000.
      // Must ONLY count the ledger row (10000), not 20000!
      const bills = [
        {
          id: 'b-double-check',
          order_id: 'o-x',
          order_number: 501,
          status: 'issued',
          subtotal_paise: 10000,
          discount_paise: 0,
          total_paise: 10000,
          order_source: 'qr',
          payment_status: 'paid',
          payment_method: 'cash',
          paid_paise: 10000,
          issued_at: '2026-10-28T04:00:00Z',
        },
      ];
      const customerPayments = [
        {
          bill_id: 'b-double-check',
          payment_method: 'cash',
          amount_paise: 10000,
          status: 'completed',
          paid_at: '2026-10-28T04:05:00Z',
        },
      ];

      const mockDb = createMockDb({ bills, customerPayments });
      const metrics = await getDailyServiceMetrics(mockDb as any, targetDate, timezone);

      expect(metrics.cashCollectedPaise).toBe(10000);
      expect(metrics.customerCollectedPaise).toBe(10000);
    });

    it('proves historical refunded classifications are audit markers only, excluded from collections, and never subtracted twice', async () => {
      // Setup a bill with 1 completed payment of 10000 paise and 1 historical 'refunded' classified payment of 4000 paise
      const bills = [
        {
          id: 'b-refund-audit',
          order_id: 'o-refund-audit',
          order_number: 991,
          status: 'issued',
          subtotal_paise: 10000,
          discount_paise: 0,
          total_paise: 10000,
          order_source: 'qr',
          payment_status: 'paid',
          payment_method: 'cash',
          paid_paise: 10000,
          issued_at: '2026-10-28T04:00:00Z',
        },
      ];
      const customerPayments = [
        {
          bill_id: 'b-refund-audit',
          payment_method: 'cash',
          amount_paise: 10000,
          status: 'completed',
          paid_at: '2026-10-28T04:05:00Z',
        },
        {
          bill_id: 'b-refund-audit',
          payment_method: 'cash',
          amount_paise: 4000,
          status: 'refunded', // Historical classification only, not proof of financial payout
          paid_at: '2026-10-28T04:10:00Z',
        },
      ];

      const mockDb = createMockDb({ bills, customerPayments });
      const metrics = await getDailyServiceMetrics(mockDb as any, targetDate, timezone);

      // 1. Completed cash collections must count strictly the completed row (10000), not subtracting the refunded row:
      expect(metrics.cashCollectedPaise).toBe(10000);
      expect(metrics.customerCollectedPaise).toBe(10000);

      // 2. The refunded row is tracked under customerRefundsPaise & historicalRefundClassifiedPaise for audit visibility:
      expect(metrics.customerRefundsPaise).toBe(4000);
      expect(metrics.historicalRefundClassifiedPaise).toBe(4000);
      expect(metrics.historicalRefundClassifiedPaise).toBe(metrics.customerRefundsPaise);

      // 3. Proves historical 'refunded' classification is NOT subtracted a second time from collections:
      expect(metrics.customerCollectedPaise).toBe(10000);
    });

    it('correctly handles search queries for orders, bills, and customers', () => {
      expect(parseReportSearch('  105  ')).toEqual({
        raw: '  105  ',
        trimmed: '105',
        orderNumber: 105,
        searchTerm: '105',
      });

      expect(parseReportSearch('Order # 42')).toEqual({
        raw: 'Order # 42',
        trimmed: 'Order # 42',
        orderNumber: 42,
        searchTerm: 'Order # 42',
      });

      expect(parseReportSearch('Aditi Rao')).toEqual({
        raw: 'Aditi Rao',
        trimmed: 'Aditi Rao',
        orderNumber: null,
        searchTerm: 'Aditi Rao',
      });

      expect(parseReportSearch('   ')).toEqual({
        raw: '   ',
        trimmed: '',
        orderNumber: null,
        searchTerm: '',
      });
    });
  });

  // ===========================================================================
  // 3. Cross-Day Scenarios and Independent Event Populations
  // ===========================================================================
  describe('3. Cross-Day Event Populations & Reconciliation', () => {
    it('accurately reconciles when an order is created on Day 1 and billed on Day 2', async () => {
      // Day 1: 2026-10-27 IST (UTC bounds: 2026-10-26T18:30:00Z to 2026-10-27T18:29:59.999Z)
      // Day 2: 2026-10-28 IST (UTC bounds: 2026-10-27T18:30:00Z to 2026-10-28T18:29:59.999Z)
      // Order created at 2026-10-27 23:45 IST = 2026-10-27T18:15:00Z (Day 1)
      const orders = [
        {
          id: 'ord-cross-1',
          order_number: 301,
          status: 'COMPLETED',
          subtotal_paise: 25000,
          total_paise: 25000,
          order_source: 'qr',
          payment_status: 'paid',
          paid_paise: 25000,
          created_at: '2026-10-27T18:15:00.000Z', // Day 1: 23:45 IST
        },
      ];

      // Bill issued at 2026-10-28 00:15 IST = 2026-10-27T18:45:00Z (Day 2)
      const bills = [
        {
          id: 'bill-cross-1',
          order_id: 'ord-cross-1',
          order_number: 301,
          status: 'issued',
          subtotal_paise: 25000,
          discount_paise: 2000,
          tax_paise: 0,
          total_paise: 23000,
          order_source: 'qr',
          payment_status: 'paid',
          payment_method: 'upi',
          paid_paise: 23000,
          issued_at: '2026-10-27T18:45:00.000Z', // Day 2: 00:15 IST
        },
      ];

      // Payment completed at 2026-10-28 00:20 IST = 2026-10-27T18:50:00Z (Day 2)
      const customerPayments = [
        {
          bill_id: 'bill-cross-1',
          payment_method: 'upi',
          amount_paise: 23000,
          status: 'completed',
          paid_at: '2026-10-27T18:50:00.000Z', // Day 2: 00:20 IST
        },
      ];

      const mockDb = createMockDb({ orders, bills, customerPayments });

      // Check Day 1 (2026-10-27): Order was created, but no bill or payment yet
      const day1Metrics = await getDailyServiceMetrics(mockDb as any, '2026-10-27', timezone);
      expect(day1Metrics.orderCount).toBe(1);
      expect(day1Metrics.grossSalesPaise).toBe(25000);
      expect(day1Metrics.netSalesPaise).toBe(0);
      expect(day1Metrics.discountsPaise).toBe(0);
      expect(day1Metrics.customerCollectedPaise).toBe(0);

      // Check Day 2 (2026-10-28): Bill was issued and payment received, no new order created
      const day2Metrics = await getDailyServiceMetrics(mockDb as any, '2026-10-28', timezone);
      expect(day2Metrics.orderCount).toBe(0);
      expect(day2Metrics.grossSalesPaise).toBe(0);
      expect(day2Metrics.netSalesPaise).toBe(23000);
      expect(day2Metrics.discountsPaise).toBe(2000);
      expect(day2Metrics.onlineCollectedPaise).toBe(23000);
      expect(day2Metrics.customerCollectedPaise).toBe(23000);
    });

    it('accurately reconciles when a bill is issued on Day 1 but paid on Day 2', async () => {
      // Bill issued at 2026-10-27 23:30 IST = 2026-10-27T18:00:00Z (Day 1)
      // When issued on Day 1, the bill was unpaid (payment_status: 'unpaid', paid_paise: 0)
      const billsDay1Initial = [
        {
          id: 'bill-cross-2',
          order_id: 'ord-cross-2',
          order_number: 302,
          status: 'issued',
          subtotal_paise: 18000,
          discount_paise: 0,
          tax_paise: 0,
          total_paise: 18000,
          order_source: 'manual',
          payment_status: 'unpaid',
          payment_method: null,
          paid_paise: 0,
          issued_at: '2026-10-27T18:00:00.000Z', // Day 1
        },
      ];

      // Payment received on Day 2: 2026-10-28 01:00 IST = 2026-10-27T19:30:00Z
      const customerPayments = [
        {
          bill_id: 'bill-cross-2',
          payment_method: 'cash',
          amount_paise: 18000,
          status: 'completed',
          paid_at: '2026-10-27T19:30:00.000Z', // Day 2
        },
      ];

      const mockDbDay1 = createMockDb({ bills: billsDay1Initial });

      // Day 1: Bill was issued on Day 1. No customer payments occurred on Day 1.
      const day1Metrics = await getDailyServiceMetrics(mockDbDay1 as any, '2026-10-27', timezone);
      expect(day1Metrics.netSalesPaise).toBe(18000);
      expect(day1Metrics.cashCollectedPaise).toBe(0);
      expect(day1Metrics.customerCollectedPaise).toBe(0);
      expect(day1Metrics.customerOutstandingPaise).toBe(18000); // 18000 unpaid on Day 1

      // Day 2: Cash payment received on Day 2 via customer_payments
      // Bill updated in DB post-payment
      const billsPostPayment = [
        {
          ...billsDay1Initial[0],
          payment_status: 'paid',
          payment_method: 'cash',
          paid_paise: 18000,
        },
      ];
      const mockDbDay2 = createMockDb({ bills: billsPostPayment, customerPayments });

      // On Day 2: No bills issued on Day 2. Cash payment received on Day 2.
      const day2Metrics = await getDailyServiceMetrics(mockDbDay2 as any, '2026-10-28', timezone);
      expect(day2Metrics.netSalesPaise).toBe(0); // Billed on Day 1, not Day 2
      expect(day2Metrics.cashCollectedPaise).toBe(18000); // Paid on Day 2
      expect(day2Metrics.customerCollectedPaise).toBe(18000);
      expect(day2Metrics.customerOutstandingPaise).toBe(0);

      // When inspecting Day 1 report post-payment:
      // Even though the bill row now has paid_paise: 18000, because the ledger payment occurred on Day 2,
      // Day 1 does NOT count it as Day 1 cash collected!
      const day1PostMetrics = await getDailyServiceMetrics(mockDbDay2 as any, '2026-10-27', timezone);
      expect(day1PostMetrics.cashCollectedPaise).toBe(0);
      expect(day1PostMetrics.customerCollectedPaise).toBe(0);
    });

    it('accurately reconciles when an Admin Credit order is placed on Day 1 and settled on Day 2', async () => {
      // Order placed on Day 1: 2026-10-27 22:00 IST = 2026-10-27T16:30:00Z
      // Initially unpaid (paid_paise = 0)
      const ordersDay1Initial = [
        {
          id: 'ord-ac-cross',
          order_number: 303,
          status: 'COMPLETED',
          subtotal_paise: 30000,
          total_paise: 30000,
          order_source: 'admin_credit',
          payment_status: 'unpaid',
          paid_paise: 0,
          created_at: '2026-10-27T16:30:00.000Z', // Day 1
        },
      ];

      // Settlement received on Day 2: 2026-10-28 12:00 IST = 2026-10-28T06:30:00Z
      const settlements = [
        {
          amount_paise: 30000,
          settled_at: '2026-10-28T06:30:00.000Z', // Day 2
        },
      ];

      const mockDbDay1 = createMockDb({ orders: ordersDay1Initial });

      // Day 1: Admin Credit consumption recorded, no settlement received yet
      const day1Metrics = await getDailyServiceMetrics(mockDbDay1 as any, '2026-10-27', timezone);
      expect(day1Metrics.adminCreditCount).toBe(1);
      expect(day1Metrics.adminCreditTotalPaise).toBe(30000);
      expect(day1Metrics.adminCreditSettledTodayPaise).toBe(0);
      expect(day1Metrics.adminCreditOutstandingPaise).toBe(30000);
      expect(day1Metrics.totalCollectedPaise).toBe(0);

      // Day 2: Settlement received on Day 2, no new Admin Credit consumption
      const mockDbDay2 = createMockDb({ orders: ordersDay1Initial, settlements });
      const day2Metrics = await getDailyServiceMetrics(mockDbDay2 as any, '2026-10-28', timezone);
      expect(day2Metrics.adminCreditCount).toBe(0);
      expect(day2Metrics.adminCreditTotalPaise).toBe(0);
      expect(day2Metrics.adminCreditSettledTodayPaise).toBe(30000);
      expect(day2Metrics.totalCollectedPaise).toBe(30000);

      // Once the order's paid_paise is updated to 30000 post-settlement:
      const ordersDay1AfterSettlement = [
        {
          ...ordersDay1Initial[0],
          payment_status: 'paid',
          paid_paise: 30000,
        },
      ];
      const mockDbPostSettlement = createMockDb({ orders: ordersDay1AfterSettlement, settlements });
      const day1PostSettlementMetrics = await getDailyServiceMetrics(mockDbPostSettlement as any, '2026-10-27', timezone);
      expect(day1PostSettlementMetrics.adminCreditTotalPaise).toBe(30000);
      expect(day1PostSettlementMetrics.adminCreditOutstandingPaise).toBe(0); // settled in full
      expect(day1PostSettlementMetrics.adminCreditSettledTodayPaise).toBe(0); // still 0 on Day 1 because settlement was Day 2
    });
  });
});
