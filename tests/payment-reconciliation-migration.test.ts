// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getDailyServiceMetrics } from '@/lib/reports';

describe('Payment Reconciliation Migration & Backfill Regression Suite', () => {
  const mig0016Path = path.resolve('supabase/migrations/202610280016_operational_improvements.sql');
  const mig0018Path = path.resolve('supabase/migrations/202610280018_payment_reconciliation_hardening.sql');

  const mig0016Sql = fs.readFileSync(mig0016Path, 'utf8');
  const mig0018Sql = fs.readFileSync(mig0018Path, 'utf8');

  // ===========================================================================
  // 1. Static SQL Contract & Invariant Assertions
  // ===========================================================================
  describe('1. Static SQL Migration Schema & Invariant Contracts', () => {
    it('migration 0016 adds payment_status defaulting to unpaid and allowing NULL', () => {
      // In 0016, payment_status must NOT default to 'paid' (which poisoned historical rows)
      expect(mig0016Sql).not.toMatch(/payment_status text not null default 'paid'/i);
      expect(mig0016Sql).toMatch(/payment_status text default 'unpaid'/i);
      expect(mig0016Sql).toMatch(/check\s*\(\s*payment_status is null or payment_status in \('unpaid', 'partially_paid', 'paid', 'external'\)\)/i);
    });

    it('migration 0018 drops NOT NULL and asserts check constraints allowing NULL for cancelled bills', () => {
      expect(mig0018Sql).toMatch(/alter table public\.bills alter column payment_status drop not null;/i);
      expect(mig0018Sql).toMatch(/alter table public\.orders alter column payment_status drop not null;/i);
      expect(mig0018Sql).toMatch(/bills_payment_status_check\s+check\s*\(\s*payment_status is null or payment_status in \('unpaid', 'partially_paid', 'paid', 'external'\)\)/i);
      expect(mig0018Sql).toMatch(/orders_payment_status_check\s+check\s*\(\s*payment_status is null or payment_status in \('unpaid', 'partially_paid', 'paid', 'external'\)\)/i);
    });

    it('migration 0018 reconciles orders linked to issued bills using b.total_paise (respecting discounts)', () => {
      // Must set paid_paise = b.total_paise, NOT o.total_paise
      expect(mig0018Sql).toMatch(/update public\.orders o\s+set paid_paise = b\.total_paise/i);
      expect(mig0018Sql).toMatch(/from public\.bills b\s+where b\.order_id = o\.id\s+and b\.status = 'issued'/i);
    });

    it('migration 0018 sets payment_status = null and paid_paise = 0 on cancelled bills and linked orders', () => {
      expect(mig0018Sql).toMatch(/update public\.bills\s+set payment_status = null,\s+paid_paise = 0/i);
      expect(mig0018Sql).toMatch(/where status = 'cancelled'/i);
      expect(mig0018Sql).toMatch(/update public\.orders o\s+set payment_status = null,\s+paid_paise = 0/i);
    });

    it('migration 0018 enforces payment_status = unpaid on unbilled orders (cancelled or completed)', () => {
      expect(mig0018Sql).toMatch(/update public\.orders o\s+set payment_status = 'unpaid',\s+paid_paise = 0/i);
      expect(mig0018Sql).toMatch(/not exists \(\s*select 1 from public\.bills b where b\.order_id = o\.id\s*\)/i);
    });

    it('migration 0018 enforces multiple-bill safety gate that fails closed on ambiguous duplicate bills', () => {
      expect(mig0018Sql).toMatch(/URB:ambiguous_multiple_bills_detected/i);
      expect(mig0018Sql).toMatch(/group by order_id\s+having count\(\*\)\s*>\s*1/i);
      expect(mig0018Sql).toMatch(/not exists \(\s*select 1 from public\.bills b_issued\s+where b_issued\.order_id = o\.id\s+and b_issued\.status = 'issued'\s*\)/i);
    });

    it('migration 0018 sets append-only immutable trigger on customer_payments', () => {
      expect(mig0018Sql).toMatch(/customer_payments_immutable/i);
      expect(mig0018Sql).toMatch(/before update or delete on public\.customer_payments/i);
      expect(mig0018Sql).toMatch(/customer_payments is append-only/i);
    });
  });

  // ===========================================================================
  // 2. Deterministic Backfill Simulation & Accounting Invariant Tests
  // ===========================================================================
  describe('2. Deterministic Backfill Simulation across Production Findings', () => {
    interface RawOrder {
      id: string;
      order_number: number;
      status: string;
      order_source: string;
      subtotal_paise: number;
      total_paise: number;
      payment_status?: string | null;
      paid_paise?: number;
      payment_method?: string | null;
      created_at: string;
    }

    interface RawBill {
      id: string;
      order_id: string;
      order_number: number;
      status: 'issued' | 'cancelled';
      order_source: string;
      subtotal_paise: number;
      discount_paise: number;
      tax_paise: number;
      total_paise: number;
      payment_status?: string | null;
      paid_paise?: number;
      payment_method?: string | null;
      issued_at: string;
    }

    // Pure deterministic implementation of Migration 0018 SQL semantics
    function simulateMigration0018(orders: RawOrder[], bills: RawBill[]) {
      const ordersMap = new Map(orders.map((o) => [o.id, { ...o }]));
      const billsMap = new Map(bills.map((b) => [b.id, { ...b }]));

      // Rule 1b: Safety Gate: Detect ambiguous multiple bills per order
      const orderBillCounts = new Map<string, number>();
      for (const bill of bills) {
        orderBillCounts.set(bill.order_id, (orderBillCounts.get(bill.order_id) || 0) + 1);
      }
      for (const [orderId, count] of orderBillCounts) {
        if (count > 1) {
          throw new Error(`URB:ambiguous_multiple_bills_detected: Order ${orderId} has ${count} associated bills.`);
        }
      }

      // Rule 2: Historical Issued Bills & Linked Orders
      for (const bill of billsMap.values()) {
        if (bill.status === 'issued' && ['qr', 'manual'].includes(bill.order_source)) {
          bill.paid_paise = bill.total_paise;
          bill.payment_status = 'paid';
          bill.payment_method = null;

          const linkedOrder = ordersMap.get(bill.order_id);
          if (linkedOrder && ['qr', 'manual'].includes(linkedOrder.order_source)) {
            // Note: paid_paise set to b.total_paise, NOT o.total_paise!
            linkedOrder.paid_paise = bill.total_paise;
            linkedOrder.payment_status = 'paid';
            linkedOrder.payment_method = null;
          }
        }
      }

      // Rule 3: Cancelled Bills & Orders with Cancelled Bills
      for (const bill of billsMap.values()) {
        if (bill.status === 'cancelled' && ['qr', 'manual'].includes(bill.order_source)) {
          bill.payment_status = null;
          bill.paid_paise = 0;
          bill.payment_method = null;

          const linkedOrder = ordersMap.get(bill.order_id);
          if (linkedOrder && ['qr', 'manual'].includes(linkedOrder.order_source)) {
            linkedOrder.payment_status = null;
            linkedOrder.paid_paise = 0;
            linkedOrder.payment_method = null;
          }
        }
      }

      // Rule 4: Orders without Any Bill
      const billedOrderIds = new Set(Array.from(billsMap.values()).map((b) => b.order_id));
      for (const order of ordersMap.values()) {
        if (['qr', 'manual'].includes(order.order_source) && !billedOrderIds.has(order.id)) {
          order.payment_status = 'unpaid';
          order.paid_paise = 0;
          order.payment_method = null;
        }
      }

      // Rule 5: External Delivery Platform
      for (const order of ordersMap.values()) {
        if (['swiggy', 'zomato', 'delivery_platform'].includes(order.order_source)) {
          order.payment_status = 'external';
          order.paid_paise = 0;
          order.payment_method = null;
        }
      }
      for (const bill of billsMap.values()) {
        if (['swiggy', 'zomato', 'delivery_platform'].includes(bill.order_source)) {
          bill.payment_status = 'external';
          bill.paid_paise = 0;
          bill.payment_method = null;
        }
      }

      // Rule 6: Admin Credit
      for (const order of ordersMap.values()) {
        if (order.order_source === 'admin_credit' && (order.paid_paise || 0) === 0) {
          order.payment_status = 'unpaid';
          order.paid_paise = 0;
          order.payment_method = null;
        }
      }
      for (const bill of billsMap.values()) {
        if (bill.order_source === 'admin_credit' && (bill.paid_paise || 0) === 0) {
          bill.payment_status = 'unpaid';
          bill.paid_paise = 0;
          bill.payment_method = null;
        }
      }

      return {
        orders: Array.from(ordersMap.values()),
        bills: Array.from(billsMap.values()),
      };
    }

    // -------------------------------------------------------------------------
    // Finding 1: Cancelled & Completed Orders without Bills
    // -------------------------------------------------------------------------
    it('Finding 1: Excludes cancelled and completed unbilled orders from paid status', () => {
      // Exact production finding dataset:
      // 4 cancelled QR orders with no bill (total 147,600 paise)
      const cancelledUnbilledOrders: RawOrder[] = [
        { id: 'o-can-1', order_number: 1, status: 'CANCELLED', order_source: 'qr', subtotal_paise: 30000, total_paise: 30000, created_at: '2026-10-25T10:00:00Z' },
        { id: 'o-can-2', order_number: 2, status: 'CANCELLED', order_source: 'qr', subtotal_paise: 42000, total_paise: 42000, created_at: '2026-10-25T11:00:00Z' },
        { id: 'o-can-3', order_number: 3, status: 'CANCELLED', order_source: 'qr', subtotal_paise: 50600, total_paise: 50600, created_at: '2026-10-25T12:00:00Z' },
        { id: 'o-can-4', order_number: 4, status: 'CANCELLED', order_source: 'qr', subtotal_paise: 25000, total_paise: 25000, created_at: '2026-10-25T13:00:00Z' },
      ];
      const sumCancelledPaise = cancelledUnbilledOrders.reduce((s, o) => s + o.total_paise, 0);
      expect(sumCancelledPaise).toBe(147600); // 147,600 paise (₹1,476)

      // 3 completed QR orders with no bill (total 38,700 paise)
      const completedUnbilledOrders: RawOrder[] = [
        { id: 'o-comp-1', order_number: 5, status: 'COMPLETED', order_source: 'qr', subtotal_paise: 12000, total_paise: 12000, created_at: '2026-10-25T14:00:00Z' },
        { id: 'o-comp-2', order_number: 6, status: 'COMPLETED', order_source: 'qr', subtotal_paise: 15700, total_paise: 15700, created_at: '2026-10-25T15:00:00Z' },
        { id: 'o-comp-3', order_number: 7, status: 'COMPLETED', order_source: 'qr', subtotal_paise: 11000, total_paise: 11000, created_at: '2026-10-25T16:00:00Z' },
      ];
      const sumCompletedUnbilledPaise = completedUnbilledOrders.reduce((s, o) => s + o.total_paise, 0);
      expect(sumCompletedUnbilledPaise).toBe(38700); // 38,700 paise (₹387)

      // 1 completed QR order WITH an issued bill (total 25,800 paise)
      const completedBilledOrder: RawOrder = {
        id: 'o-billed-1',
        order_number: 8,
        status: 'COMPLETED',
        order_source: 'qr',
        subtotal_paise: 25800,
        total_paise: 25800,
        created_at: '2026-10-25T17:00:00Z',
      };
      const issuedBill: RawBill = {
        id: 'b-issued-1',
        order_id: 'o-billed-1',
        order_number: 8,
        status: 'issued',
        order_source: 'qr',
        subtotal_paise: 25800,
        discount_paise: 0,
        tax_paise: 0,
        total_paise: 25800,
        issued_at: '2026-10-25T17:05:00Z',
      };

      const all8Orders = [...cancelledUnbilledOrders, ...completedUnbilledOrders, completedBilledOrder];
      const allBills = [issuedBill];

      // Total matching original flawed predicate: 212,100 paise (₹2,121)
      const sumAll8 = all8Orders.reduce((s, o) => s + o.total_paise, 0);
      expect(sumAll8).toBe(212100);

      // Run corrected backfill
      const { orders: postOrders, bills: postBills } = simulateMigration0018(all8Orders, allBills);

      // Invariant 1: Exactly 1 order is marked paid (the one with the issued bill)
      const paidOrders = postOrders.filter((o) => o.payment_status === 'paid');
      expect(paidOrders.length).toBe(1);
      expect(paidOrders[0].id).toBe('o-billed-1');
      expect(paidOrders[0].paid_paise).toBe(25800);

      // Invariant 2: The 7 unbilled orders are strictly unpaid with paid_paise = 0
      const unpaidOrders = postOrders.filter((o) => o.payment_status === 'unpaid');
      expect(unpaidOrders.length).toBe(7);
      for (const u of unpaidOrders) {
        expect(u.paid_paise).toBe(0);
      }

      // Total money marked collected across all 8 orders is strictly ₹258 (NOT ₹2,121)
      const totalPaidCollected = postOrders.reduce((s, o) => s + (o.paid_paise || 0), 0);
      expect(totalPaidCollected).toBe(25800);
    });

    // -------------------------------------------------------------------------
    // Finding 2: Order and Bill Paid Balances with Discounts
    // -------------------------------------------------------------------------
    it('Finding 2: Order paid balance matches bill total when discounts apply', () => {
      // 5 manual orders where order.total_paise exceeds bill.total_paise with aggregate discount of 21,200 paise (₹212)
      const discountedOrders: RawOrder[] = [
        { id: 'o-disc-1', order_number: 10, status: 'COMPLETED', order_source: 'manual', subtotal_paise: 20000, total_paise: 20000, created_at: '2026-10-26T10:00:00Z' },
        { id: 'o-disc-2', order_number: 11, status: 'COMPLETED', order_source: 'manual', subtotal_paise: 35000, total_paise: 35000, created_at: '2026-10-26T11:00:00Z' },
        { id: 'o-disc-3', order_number: 12, status: 'COMPLETED', order_source: 'manual', subtotal_paise: 18000, total_paise: 18000, created_at: '2026-10-26T12:00:00Z' },
        { id: 'o-disc-4', order_number: 13, status: 'COMPLETED', order_source: 'manual', subtotal_paise: 42000, total_paise: 42000, created_at: '2026-10-26T13:00:00Z' },
        { id: 'o-disc-5', order_number: 14, status: 'COMPLETED', order_source: 'manual', subtotal_paise: 50000, total_paise: 50000, created_at: '2026-10-26T14:00:00Z' },
      ];
      const sumOrderTotal = discountedOrders.reduce((s, o) => s + o.total_paise, 0); // 165,000 paise

      // Corresponding issued bills with discounts totaling 21,200 paise
      const discountedBills: RawBill[] = [
        { id: 'b-disc-1', order_id: 'o-disc-1', order_number: 10, status: 'issued', order_source: 'manual', subtotal_paise: 20000, discount_paise: 2000, tax_paise: 0, total_paise: 18000, issued_at: '2026-10-26T10:05:00Z' },
        { id: 'b-disc-2', order_id: 'o-disc-2', order_number: 11, status: 'issued', order_source: 'manual', subtotal_paise: 35000, discount_paise: 5000, tax_paise: 0, total_paise: 30000, issued_at: '2026-10-26T11:05:00Z' },
        { id: 'b-disc-3', order_id: 'o-disc-3', order_number: 12, status: 'issued', order_source: 'manual', subtotal_paise: 18000, discount_paise: 3200, tax_paise: 0, total_paise: 14800, issued_at: '2026-10-26T12:05:00Z' },
        { id: 'b-disc-4', order_id: 'o-disc-4', order_number: 13, status: 'issued', order_source: 'manual', subtotal_paise: 42000, discount_paise: 6000, tax_paise: 0, total_paise: 36000, issued_at: '2026-10-26T13:05:00Z' },
        { id: 'b-disc-5', order_id: 'o-disc-5', order_number: 14, status: 'issued', order_source: 'manual', subtotal_paise: 50000, discount_paise: 5000, tax_paise: 0, total_paise: 45000, issued_at: '2026-10-26T14:05:00Z' },
      ];
      const sumBillTotal = discountedBills.reduce((s, b) => s + b.total_paise, 0); // 143,800 paise
      const sumDiscounts = discountedBills.reduce((s, b) => s + b.discount_paise, 0); // 21,200 paise

      expect(sumOrderTotal - sumBillTotal).toBe(21200); // Exactly ₹212 difference

      // Run corrected backfill
      const { orders: postOrders, bills: postBills } = simulateMigration0018(discountedOrders, discountedBills);

      // Verify that for EVERY discounted order, order.paid_paise === bill.total_paise
      for (const bill of postBills) {
        const order = postOrders.find((o) => o.id === bill.order_id)!;
        expect(order).toBeDefined();
        expect(bill.paid_paise).toBe(bill.total_paise);
        expect(order.paid_paise).toBe(bill.total_paise);
        expect(order.paid_paise).toBe(bill.paid_paise); // Discrepancy is zero!
        expect(order.paid_paise).toBeLessThan(order.total_paise); // Reflects the discount applied
        expect(order.total_paise - (order.paid_paise ?? 0)).toBe(bill.discount_paise);
      }

      // Total collected reported across all 5 bills/orders is 143,800 paise, NOT 165,000 paise
      const totalOrderPaid = postOrders.reduce((s, o) => s + (o.paid_paise || 0), 0);
      const totalBillPaid = postBills.reduce((s, b) => s + (b.paid_paise || 0), 0);
      expect(totalOrderPaid).toBe(143800);
      expect(totalBillPaid).toBe(143800);
      expect(totalOrderPaid).toBe(totalBillPaid);
    });

    // -------------------------------------------------------------------------
    // Finding 3: Existing Cancelled Bills & Unknown Payment State
    // -------------------------------------------------------------------------
    it('Finding 3: Corrects cancelled historical bills to payment_status = null and paid_paise = 0', () => {
      // 17 cancelled bills in production with an aggregate bill value of 481,100 paise (₹4,811)
      const cancelledBills: RawBill[] = [];
      const cancelledOrders: RawOrder[] = [];

      let runningTotal = 0;
      for (let i = 1; i <= 17; i++) {
        // Distribute 481,100 paise across 17 bills deterministically
        const billAmount = i === 17 ? 481100 - runningTotal : 28000;
        runningTotal += billAmount;

        const orderId = `o-cancelled-${i}`;
        const billId = `b-cancelled-${i}`;

        cancelledOrders.push({
          id: orderId,
          order_number: 100 + i,
          status: 'CANCELLED',
          order_source: 'qr',
          subtotal_paise: billAmount,
          total_paise: billAmount,
          created_at: '2026-10-24T10:00:00Z',
        });

        cancelledBills.push({
          id: billId,
          order_id: orderId,
          order_number: 100 + i,
          status: 'cancelled',
          order_source: 'qr',
          subtotal_paise: billAmount,
          discount_paise: 0,
          tax_paise: 0,
          total_paise: billAmount,
          issued_at: '2026-10-24T10:05:00Z',
        });
      }

      const sumCancelledBills = cancelledBills.reduce((s, b) => s + b.total_paise, 0);
      expect(sumCancelledBills).toBe(481100); // Exactly ₹4,811

      // Run corrected backfill
      const { orders: postOrders, bills: postBills } = simulateMigration0018(cancelledOrders, cancelledBills);

      // Invariant: All 17 cancelled bills must have payment_status === null and paid_paise === 0
      expect(postBills.length).toBe(17);
      for (const b of postBills) {
        expect(b.payment_status).toBeNull();
        expect(b.paid_paise).toBe(0);
        expect(b.payment_method).toBeNull();
      }

      // Invariant: All 17 linked cancelled orders must have payment_status === null and paid_paise === 0
      expect(postOrders.length).toBe(17);
      for (const o of postOrders) {
        expect(o.payment_status).toBeNull();
        expect(o.paid_paise).toBe(0);
      }

      // Invariant: Total collected paise from these 17 cancelled bills is strictly ZERO
      const totalCancelledPaid = postBills.reduce((s, b) => s + (b.paid_paise || 0), 0);
      expect(totalCancelledPaid).toBe(0);
    });

    // -------------------------------------------------------------------------
    // External Platform & Admin Credit Orders
    // -------------------------------------------------------------------------
    it('External Platform & Admin Credit: sets external and unpaid receivables with zero cash collected', () => {
      const externalOrders: RawOrder[] = [
        { id: 'o-swiggy-1', order_number: 201, status: 'COMPLETED', order_source: 'swiggy', subtotal_paise: 45000, total_paise: 45000, created_at: '2026-10-26T12:00:00Z' },
        { id: 'o-zomato-1', order_number: 202, status: 'COMPLETED', order_source: 'zomato', subtotal_paise: 62000, total_paise: 62000, created_at: '2026-10-26T12:30:00Z' },
      ];
      const adminCreditOrders: RawOrder[] = [
        { id: 'o-ac-1', order_number: 203, status: 'COMPLETED', order_source: 'admin_credit', subtotal_paise: 50000, total_paise: 50000, created_at: '2026-10-26T13:00:00Z' },
      ];

      const { orders: postOrders } = simulateMigration0018([...externalOrders, ...adminCreditOrders], []);

      const swiggy = postOrders.find((o) => o.id === 'o-swiggy-1')!;
      const zomato = postOrders.find((o) => o.id === 'o-zomato-1')!;
      const ac = postOrders.find((o) => o.id === 'o-ac-1')!;

      expect(swiggy.payment_status).toBe('external');
      expect(swiggy.paid_paise).toBe(0);

      expect(zomato.payment_status).toBe('external');
      expect(zomato.paid_paise).toBe(0);

      expect(ac.payment_status).toBe('unpaid');
      expect(ac.paid_paise).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Multiple-Bill Safety Gate Tests
    // -------------------------------------------------------------------------
    it('Multiple-Bill Gate: Fails closed with exception if an order has multiple associated bills', () => {
      const order: RawOrder = {
        id: 'o-dup-1',
        order_number: 999,
        status: 'COMPLETED',
        order_source: 'manual',
        subtotal_paise: 25000,
        total_paise: 25000,
        created_at: '2026-10-27T10:00:00Z',
      };
      const billA: RawBill = {
        id: 'b-dup-1a',
        order_id: 'o-dup-1',
        order_number: 999,
        status: 'cancelled',
        order_source: 'manual',
        subtotal_paise: 25000,
        discount_paise: 0,
        tax_paise: 0,
        total_paise: 25000,
        issued_at: '2026-10-27T10:05:00Z',
      };
      const billB: RawBill = {
        id: 'b-dup-1b',
        order_id: 'o-dup-1',
        order_number: 999,
        status: 'issued',
        order_source: 'manual',
        subtotal_paise: 25000,
        discount_paise: 0,
        tax_paise: 0,
        total_paise: 25000,
        issued_at: '2026-10-27T10:10:00Z',
      };

      expect(() => simulateMigration0018([order], [billA, billB])).toThrowError(
        /URB:ambiguous_multiple_bills_detected/
      );
    });
  });

  // ===========================================================================
  // 3. Reporting Metrics Integration with Reconciled Backfill Data
  // ===========================================================================
  describe('3. getDailyServiceMetrics with Post-Migration Reconciled Entities', () => {
    function createMockDb(fixtures: { orders?: any[]; bills?: any[] }) {
      return {
        from: (table: string) => ({
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
            gte: () => ({
              lte: () => {
                const allRows = table === 'orders' ? fixtures.orders || [] : table === 'bills' ? fixtures.bills || [] : [];
                return Promise.resolve({ data: allRows, error: null });
              },
            }),
          }),
        }),
      };
    }

    it('reports zero collected money for cancelled bills and unbilled orders', async () => {
      const mockOrders = [
        // Cancelled order without bill (Finding 1)
        { id: 'o-can-1', order_number: 1, status: 'CANCELLED', order_source: 'qr', subtotal_paise: 30000, total_paise: 30000, payment_status: 'unpaid', paid_paise: 0, created_at: '2026-10-28T10:00:00Z' },
        // Completed unbilled order (Finding 1)
        { id: 'o-comp-1', order_number: 2, status: 'COMPLETED', order_source: 'qr', subtotal_paise: 12000, total_paise: 12000, payment_status: 'unpaid', paid_paise: 0, created_at: '2026-10-28T11:00:00Z' },
        // Cancelled order with cancelled bill (Finding 3)
        { id: 'o-can-bill-1', order_number: 3, status: 'CANCELLED', order_source: 'qr', subtotal_paise: 28000, total_paise: 28000, payment_status: null, paid_paise: 0, created_at: '2026-10-28T12:00:00Z' },
        // Legitimate issued bill order (Finding 1 & 2)
        { id: 'o-valid-1', order_number: 4, status: 'COMPLETED', order_source: 'manual', subtotal_paise: 20000, total_paise: 20000, payment_status: 'paid', paid_paise: 18000, created_at: '2026-10-28T13:00:00Z' },
      ];

      const mockBills = [
        // Cancelled bill (Finding 3)
        { id: 'b-can-1', order_id: 'o-can-bill-1', order_number: 3, status: 'cancelled', order_source: 'qr', subtotal_paise: 28000, discount_paise: 0, tax_paise: 0, total_paise: 28000, payment_status: null, paid_paise: 0, issued_at: '2026-10-28T12:05:00Z' },
        // Issued bill with ₹20 discount (Finding 2)
        { id: 'b-valid-1', order_id: 'o-valid-1', order_number: 4, status: 'issued', order_source: 'manual', subtotal_paise: 20000, discount_paise: 2000, tax_paise: 0, total_paise: 18000, payment_status: 'paid', paid_paise: 18000, payment_method: null, issued_at: '2026-10-28T13:05:00Z' },
      ];

      const mockDb = createMockDb({ orders: mockOrders, bills: mockBills });
      const metrics = await getDailyServiceMetrics(mockDb as any, '2026-10-28', 'Asia/Kolkata');

      // Gross sales: Only non-cancelled customer orders (comp-1: 12000 + valid-1: 20000) = 32,000 paise
      expect(metrics.grossSalesPaise).toBe(32000);

      // Customer sales & collections from issued bills
      expect(metrics.customerOrderCount).toBe(2); // non-cancelled customer orders (comp-1 and valid-1)
      expect(metrics.discountsPaise).toBe(2000);
      expect(metrics.netSalesPaise).toBe(18000);

      // Customer collected: Only the issued bill's 18,000 paise is unclassified collection
      expect(metrics.unclassifiedCollectedPaise).toBe(18000);
      expect(metrics.customerCollectedPaise).toBe(18000);
      expect(metrics.customerOutstandingPaise).toBe(0); // Paid in full
      expect(metrics.totalCollectedPaise).toBe(18000);

      // Zero false cash or online collected
      expect(metrics.cashCollectedPaise).toBe(0);
      expect(metrics.onlineCollectedPaise).toBe(0);
    });
  });
});
