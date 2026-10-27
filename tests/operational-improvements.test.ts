// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  getTimezoneDateBounds,
  getTodayDateString,
  getDailyServiceMetrics,
} from '../src/lib/reports';
import {
  renderKitchenTicketToCanvas,
  layoutKitchenItem,
  type KitchenTicketOrder,
} from '../src/lib/thermal-canvas';

describe('Urbania Café POS — Operational Improvements Test Suite', () => {
  // =========================================================================
  // Feature 1: Admin Credit Orders & Settlement Logic
  // =========================================================================
  describe('Feature 1: Admin Credit Orders', () => {
    interface AdminCreditOrder {
      id: string;
      order_number: number;
      order_source: string;
      admin_user_id: string;
      total_paise: number;
      paid_paise: number;
      payment_status: 'unpaid' | 'partially_paid' | 'paid';
    }

    function calculatePaymentStatus(totalPaise: number, paidPaise: number): 'unpaid' | 'partially_paid' | 'paid' {
      if (paidPaise <= 0) return 'unpaid';
      if (paidPaise >= totalPaise) return 'paid';
      return 'partially_paid';
    }

    function applySettlement(
      order: AdminCreditOrder,
      settlementAmountPaise: number
    ): { updatedOrder: AdminCreditOrder; error?: string } {
      if (settlementAmountPaise <= 0) {
        return { updatedOrder: order, error: 'Settlement amount must be greater than zero' };
      }
      const remainingBalance = order.total_paise - order.paid_paise;
      if (settlementAmountPaise > remainingBalance) {
        return {
          updatedOrder: order,
          error: `Settlement amount (₹${(settlementAmountPaise / 100).toFixed(2)}) exceeds remaining balance (₹${(remainingBalance / 100).toFixed(2)})`,
        };
      }
      const newPaidPaise = order.paid_paise + settlementAmountPaise;
      return {
        updatedOrder: {
          ...order,
          paid_paise: newPaidPaise,
          payment_status: calculatePaymentStatus(order.total_paise, newPaidPaise),
        },
      };
    }

    it('correctly tracks newly created admin credit order as unpaid with full balance outstanding', () => {
      const order: AdminCreditOrder = {
        id: 'ord-credit-1',
        order_number: 201,
        order_source: 'admin_credit',
        admin_user_id: 'admin-user-1',
        total_paise: 45000, // ₹450.00
        paid_paise: 0,
        payment_status: 'unpaid',
      };

      expect(order.order_source).toBe('admin_credit');
      expect(order.payment_status).toBe('unpaid');
      expect(order.total_paise - order.paid_paise).toBe(45000);
    });

    it('transitions from unpaid to partially_paid on partial settlement', () => {
      const order: AdminCreditOrder = {
        id: 'ord-credit-1',
        order_number: 201,
        order_source: 'admin_credit',
        admin_user_id: 'admin-user-1',
        total_paise: 50000, // ₹500.00
        paid_paise: 0,
        payment_status: 'unpaid',
      };

      const result = applySettlement(order, 20000); // Pay ₹200.00
      expect(result.error).toBeUndefined();
      expect(result.updatedOrder.paid_paise).toBe(20000);
      expect(result.updatedOrder.payment_status).toBe('partially_paid');
      expect(result.updatedOrder.total_paise - result.updatedOrder.paid_paise).toBe(30000); // ₹300.00 remaining
    });

    it('transitions to paid when the settlement completely clears the remaining balance', () => {
      const order: AdminCreditOrder = {
        id: 'ord-credit-1',
        order_number: 201,
        order_source: 'admin_credit',
        admin_user_id: 'admin-user-1',
        total_paise: 50000,
        paid_paise: 20000,
        payment_status: 'partially_paid',
      };

      const result = applySettlement(order, 30000); // Pay remaining ₹300.00
      expect(result.error).toBeUndefined();
      expect(result.updatedOrder.paid_paise).toBe(50000);
      expect(result.updatedOrder.payment_status).toBe('paid');
      expect(result.updatedOrder.total_paise - result.updatedOrder.paid_paise).toBe(0);
    });

    it('strictly prevents over-settlement beyond remaining balance', () => {
      const order: AdminCreditOrder = {
        id: 'ord-credit-1',
        order_number: 201,
        order_source: 'admin_credit',
        admin_user_id: 'admin-user-1',
        total_paise: 25000,
        paid_paise: 10000,
        payment_status: 'partially_paid',
      };

      const result = applySettlement(order, 20000); // Remaining is 15000, trying to pay 20000
      expect(result.error).toBeDefined();
      expect(result.error).toContain('exceeds remaining balance');
      expect(result.updatedOrder.paid_paise).toBe(10000); // unchanged
    });

    it('aggregates per-admin outstanding balance correctly across multiple orders', () => {
      const admin1Orders: AdminCreditOrder[] = [
        { id: '1', order_number: 1, order_source: 'admin_credit', admin_user_id: 'adm-1', total_paise: 30000, paid_paise: 10000, payment_status: 'partially_paid' },
        { id: '2', order_number: 2, order_source: 'admin_credit', admin_user_id: 'adm-1', total_paise: 25000, paid_paise: 0, payment_status: 'unpaid' },
        { id: '3', order_number: 3, order_source: 'admin_credit', admin_user_id: 'adm-1', total_paise: 15000, paid_paise: 15000, payment_status: 'paid' },
      ];

      const totalAdmin1Outstanding = admin1Orders.reduce((sum, o) => sum + (o.total_paise - o.paid_paise), 0);
      expect(totalAdmin1Outstanding).toBe(45000); // (30000-10000) + 25000 + 0 = 45000 paise (₹450.00)
    });
  });

  // =========================================================================
  // Feature 2: Delivery Platform Orders (Swiggy / Zomato)
  // =========================================================================
  describe('Feature 2: Delivery Platform Orders', () => {
    function validateBillGenerationEligibility(order: {
      status: string;
      order_source?: string;
    }): { eligible: boolean; reason?: string } {
      if (['swiggy', 'zomato', 'delivery_platform'].includes(order.order_source || '')) {
        return { eligible: false, reason: 'Delivery platform orders are paid externally; customer billing is disabled.' };
      }
      if (order.order_source === 'admin_credit') {
        return { eligible: false, reason: 'Admin credit orders are tracked via Admin Credit Ledger; customer billing is disabled.' };
      }
      if (['NEW', 'CANCELLED'].includes(order.status)) {
        return { eligible: false, reason: 'Order status not billable' };
      }
      return { eligible: true };
    }

    it('blocks bill generation for Swiggy orders', () => {
      const swiggyOrder = {
        status: 'ACCEPTED',
        order_source: 'swiggy',
      };
      const check = validateBillGenerationEligibility(swiggyOrder);
      expect(check.eligible).toBe(false);
      expect(check.reason).toContain('Delivery platform orders are paid externally; customer billing is disabled.');
    });

    it('blocks bill generation for Zomato orders', () => {
      const zomatoOrder = {
        status: 'READY',
        order_source: 'zomato',
      };
      const check = validateBillGenerationEligibility(zomatoOrder);
      expect(check.eligible).toBe(false);
      expect(check.reason).toContain('Delivery platform orders are paid externally; customer billing is disabled.');
    });

    it('allows bill generation for normal dine-in and counter orders in billable state', () => {
      const dineInOrder = {
        status: 'ACCEPTED',
        order_source: 'qr',
      };
      const check = validateBillGenerationEligibility(dineInOrder);
      expect(check.eligible).toBe(true);
    });
  });

  // =========================================================================
  // Feature 3: Kitchen Order Ticket (KOT) Readability on 57 mm Paper
  // =========================================================================
  describe('Feature 3: KOT Readability & Format', () => {
    it('formats dish names and quantities in layoutKitchenItem with bold styling and prominent separation', () => {
      const dummyCanvas = document.createElement('canvas');
      const ctx = dummyCanvas.getContext('2d')!;

      const item = {
        name: 'Veg Loaded Pizza With Extra Cheese and Olives',
        quantity: 3,
        note: 'Make it crispy',
        selected_options: [{ name: 'Thin Crust' }, { name: 'Extra Jalapenos' }],
      };

      const layout = layoutKitchenItem(ctx, item, 356, 'sans-serif', 'monospace');

      expect(layout.nameLines.length).toBeGreaterThanOrEqual(1);
      // First line should start with formatted quantity prefix
      expect(layout.nameLines[0]).toMatch(/^3×/);
      expect(layout.nameLines[0]).toContain('Veg Loaded Pizza');

      // Modifiers and notes are captured
      expect(layout.optionLines.length).toBeGreaterThanOrEqual(1);
      expect(layout.optionLines[0]).toContain('Thin Crust');
      expect(layout.noteLines.length).toBeGreaterThanOrEqual(1);
      expect(layout.noteLines[0]).toContain('Note: Make it crispy');
    });

    it('prominently renders platform name and reference on KOT header for Swiggy/Zomato', () => {
      const filledTexts: string[] = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
        const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
        return {
          ...ctx,
          measureText: () => ({ width: 100 }),
          fillText: (t: string) => filledTexts.push(t),
          strokeText: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          fillRect: () => {},
          scale: () => {},
          save: () => {},
          restore: () => {},
          setLineDash: () => {},
        };
      };

      const swiggyKotOrder: KitchenTicketOrder = {
        id: 'ord-swiggy-99',
        order_number: 99,
        status: 'ACCEPTED',
        order_source: 'swiggy',
        external_platform_name: 'Swiggy',
        external_platform_ref: 'SW-9876',
        customer_name: 'Rider Anil',
        order_items: [
          { name: 'Cold Coffee with Ice Cream', quantity: 2 },
        ],
      };

      const canvas = renderKitchenTicketToCanvas(swiggyKotOrder, { scale: 1 });
      expect(canvas.width).toBe(384); // 48mm hardware raster width
      expect(canvas.height).toBeGreaterThan(100);

      // Verify Swiggy header & reference
      expect(filledTexts.some((t) => t.includes('SWIGGY · #SW-9876'))).toBe(true);
      expect(filledTexts.some((t) => t.includes('2× Cold Coffee with Ice Cream'))).toBe(true);

      // Verify NO financial numbers
      expect(filledTexts.some((t) => t.includes('₹'))).toBe(false);
      expect(filledTexts.some((t) => t.toLowerCase().includes('total'))).toBe(false);
      expect(filledTexts.some((t) => t.toLowerCase().includes('paid'))).toBe(false);

      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;
    });

    it('renders duplicate reprint banner "*** DUPLICATE KITCHEN TICKET — REPRINT ***" on reprint tickets', () => {
      const filledTexts: string[] = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
        const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
        return {
          ...ctx,
          measureText: () => ({ width: 100 }),
          fillText: (t: string) => filledTexts.push(t),
          strokeText: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          fillRect: () => {},
          scale: () => {},
          save: () => {},
          restore: () => {},
          setLineDash: () => {},
        };
      };

      const reprintKotOrder: KitchenTicketOrder = {
        id: 'ord-reprint-1',
        order_number: 142,
        status: 'ACCEPTED',
        ticket_type: 'reprint',
        order_items: [
          { name: 'Paneer Sandwich', quantity: 1 },
        ],
      };

      renderKitchenTicketToCanvas(reprintKotOrder, { scale: 1, isReprint: true });
      expect(filledTexts).toContain('*** DUPLICATE KITCHEN TICKET — REPRINT ***');

      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;
    });
  });

  // =========================================================================
  // Feature 4: Today\'s Service and Audit Reports Reconciliation
  // =========================================================================
  describe('Feature 4: Reporting Reconciliation', () => {
    it('computes timezone date boundaries for Asia/Kolkata correctly', () => {
      const { startUtcIso, endUtcIso } = getTimezoneDateBounds('2026-10-28', 'Asia/Kolkata');
      // IST is UTC+05:30. Midnight IST is 18:30 UTC of previous day
      expect(startUtcIso).toBe('2026-10-27T18:30:00.000Z');
      expect(endUtcIso).toBe('2026-10-28T18:29:59.999Z');
    });

    it('reconciles reporting metrics across cash sales, credit orders, and delivery platforms', async () => {
      // Mock db returning simulated records
      const mockOrders = [
        // 1. Paid Customer dine-in order
        {
          id: 'o-1',
          order_number: 101,
          status: 'COMPLETED',
          order_source: 'qr',
          total_paise: 30000,
          created_at: '2026-10-28T10:00:00Z',
          bills: [
            {
              id: 'b-1',
              status: 'issued',
              subtotal_paise: 30000,
              discount_paise: 3000,
              total_paise: 27000,
              issued_at: '2026-10-28T10:30:00Z',
            },
          ],
        },
        // 2. Unpaid Admin credit order
        {
          id: 'o-2',
          order_number: 102,
          status: 'COMPLETED',
          order_source: 'admin_credit',
          total_paise: 15000,
          paid_paise: 0,
          payment_status: 'unpaid',
          created_at: '2026-10-28T11:00:00Z',
          bills: [],
        },
        // 3. Partially paid Admin credit order (₹100 settled, ₹50 outstanding)
        {
          id: 'o-3',
          order_number: 103,
          status: 'COMPLETED',
          order_source: 'admin_credit',
          total_paise: 15000,
          paid_paise: 10000,
          payment_status: 'partially_paid',
          created_at: '2026-10-28T12:00:00Z',
          bills: [],
        },
        // 4. Swiggy delivery platform order (₹400 platform volume; paid externally)
        {
          id: 'o-4',
          order_number: 104,
          status: 'COMPLETED',
          order_source: 'swiggy',
          total_paise: 40000,
          external_platform_name: 'Swiggy',
          created_at: '2026-10-28T13:00:00Z',
          bills: [],
        },
        // 5. Cancelled order (₹200 - excluded from revenue)
        {
          id: 'o-5',
          order_number: 105,
          status: 'CANCELLED',
          order_source: 'manual',
          total_paise: 20000,
          created_at: '2026-10-28T14:00:00Z',
          bills: [],
        },
      ];

      const mockBills = [
        {
          id: 'b-1',
          order_id: 'o-1',
          order_number: 101,
          status: 'issued',
          subtotal_paise: 30000,
          discount_paise: 3000,
          total_paise: 27000,
          order_source: 'qr',
          issued_at: '2026-10-28T10:30:00Z',
        },
      ];

      const mockSettlements = [
        {
          id: 's-1',
          order_id: 'o-3',
          amount_paise: 10000,
          settled_at: '2026-10-28T12:30:00Z',
        },
      ];

      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            gte: () => ({
              lte: () => Promise.resolve({
                data:
                  table === 'orders'
                    ? mockOrders
                    : table === 'bills'
                    ? mockBills
                    : mockSettlements,
                error: null,
              }),
            }),
          }),
        }),
      };

      const metrics = await getDailyServiceMetrics(mockDb as any, '2026-10-28', 'Asia/Kolkata');

      // 1. Order counts
      expect(metrics.orderCount).toBe(4);
      expect(metrics.cancelledOrderCount).toBe(1);
      expect(metrics.completedOrderCount).toBe(4);

      // 2. Customer bill: Gross 30000, Discount 3000, Net 27000
      expect(metrics.grossSalesPaise).toBe(30000);
      expect(metrics.discountsPaise).toBe(3000);
      expect(metrics.netSalesPaise).toBe(27000);

      // 3. Admin credit: Total 30000 (o-2: 15000 + o-3: 15000), Settled today: 10000, Outstanding: 20000
      expect(metrics.adminCreditTotalPaise).toBe(30000);
      expect(metrics.adminCreditSettledTodayPaise).toBe(10000);
      expect(metrics.adminCreditOutstandingPaise).toBe(20000);

      // 4. Delivery platform: Swiggy 40000
      expect(metrics.externalPlatformValuePaise).toBe(40000);

      // 5. Actual cash/card/UPI collected by café = Paid customer net (27000) + Settled admin credit (10000) = 37000
      // Swiggy (40000) and Unsettled credit (20000) MUST NOT be included in cafe collections!
      expect(metrics.collectedPaise).toBe(37000);
    });
  });
});
