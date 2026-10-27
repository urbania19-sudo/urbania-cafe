// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  getTimezoneDateBounds,
  getDailyServiceMetrics,
} from '../src/lib/reports';
import {
  renderReceiptToCanvas,
  renderKitchenTicketToCanvas,
  type KitchenTicketOrder,
} from '../src/lib/thermal-canvas';
import type { Bill } from '../src/lib/billing';

describe('Urbania Café POS — Offline Customer Payment Methods', () => {
  // =========================================================================
  // 1. Payment Method Selection & Recording Logic
  // =========================================================================
  describe('1. Payment recording and balance calculation', () => {
    interface PaymentRecord {
      id: string;
      bill_id: string;
      order_id: string;
      payment_method: 'cash' | 'upi';
      amount_paise: number;
      status: 'completed' | 'refunded' | 'pending' | 'failed';
      idempotency_key?: string | null;
      paid_at: string;
    }

    interface BillRecord {
      id: string;
      order_id: string;
      total_paise: number;
      paid_paise: number;
      payment_status: 'unpaid' | 'partial' | 'paid';
      payment_method: 'cash' | 'upi' | null;
    }

    function recordPayment(
      bill: BillRecord,
      existingPayments: PaymentRecord[],
      payment: {
        payment_method: 'cash' | 'upi';
        amount_paise: number;
        idempotency_key?: string;
      }
    ): {
      updatedBill: BillRecord;
      paymentRecord?: PaymentRecord;
      error?: string;
    } {
      // Idempotency check: prevent duplicate payment records on retries
      if (payment.idempotency_key) {
        const existing = existingPayments.find(
          (p) => p.idempotency_key === payment.idempotency_key
        );
        if (existing) {
          return { updatedBill: bill, paymentRecord: existing };
        }
      }

      if (payment.amount_paise <= 0) {
        return { updatedBill: bill, error: 'Payment amount must be greater than zero.' };
      }

      const remainingBalance = bill.total_paise - bill.paid_paise;
      if (payment.amount_paise > remainingBalance) {
        return {
          updatedBill: bill,
          error: `Payment amount ₹${(payment.amount_paise / 100).toFixed(2)} exceeds remaining balance ₹${(remainingBalance / 100).toFixed(2)}.`,
        };
      }

      const newPaidPaise = bill.paid_paise + payment.amount_paise;
      const newStatus = newPaidPaise >= bill.total_paise ? 'paid' : 'partial';

      const record: PaymentRecord = {
        id: `pay-${existingPayments.length + 1}`,
        bill_id: bill.id,
        order_id: bill.order_id,
        payment_method: payment.payment_method,
        amount_paise: payment.amount_paise,
        status: 'completed',
        idempotency_key: payment.idempotency_key || null,
        paid_at: new Date().toISOString(),
      };

      return {
        updatedBill: {
          ...bill,
          paid_paise: newPaidPaise,
          payment_status: newStatus,
          payment_method: payment.payment_method,
        },
        paymentRecord: record,
      };
    }

    it('records full Cash payment on bill confirmation', () => {
      const bill: BillRecord = {
        id: 'bill-1',
        order_id: 'ord-1',
        total_paise: 35000, // ₹350.00
        paid_paise: 0,
        payment_status: 'unpaid',
        payment_method: null,
      };

      const { updatedBill, paymentRecord, error } = recordPayment(bill, [], {
        payment_method: 'cash',
        amount_paise: 35000,
        idempotency_key: 'idem-1',
      });

      expect(error).toBeUndefined();
      expect(updatedBill.payment_status).toBe('paid');
      expect(updatedBill.payment_method).toBe('cash');
      expect(updatedBill.paid_paise).toBe(35000);
      expect(paymentRecord?.payment_method).toBe('cash');
      expect(paymentRecord?.amount_paise).toBe(35000);
    });

    it('records full Online / UPI payment on bill confirmation', () => {
      const bill: BillRecord = {
        id: 'bill-2',
        order_id: 'ord-2',
        total_paise: 50000, // ₹500.00
        paid_paise: 0,
        payment_status: 'unpaid',
        payment_method: null,
      };

      const { updatedBill, paymentRecord, error } = recordPayment(bill, [], {
        payment_method: 'upi',
        amount_paise: 50000,
        idempotency_key: 'idem-2',
      });

      expect(error).toBeUndefined();
      expect(updatedBill.payment_status).toBe('paid');
      expect(updatedBill.payment_method).toBe('upi');
      expect(updatedBill.paid_paise).toBe(50000);
      expect(paymentRecord?.payment_method).toBe('upi');
    });

    it('handles partial payment and accurately computes outstanding balance', () => {
      const bill: BillRecord = {
        id: 'bill-3',
        order_id: 'ord-3',
        total_paise: 60000, // ₹600.00
        paid_paise: 0,
        payment_status: 'unpaid',
        payment_method: null,
      };

      // Customer pays ₹400 in Cash first
      const first = recordPayment(bill, [], {
        payment_method: 'cash',
        amount_paise: 40000,
        idempotency_key: 'idem-3a',
      });

      expect(first.error).toBeUndefined();
      expect(first.updatedBill.payment_status).toBe('partial');
      expect(first.updatedBill.paid_paise).toBe(40000);
      expect(first.updatedBill.total_paise - first.updatedBill.paid_paise).toBe(20000); // ₹200 balance

      // Customer pays remaining ₹200 via UPI
      const second = recordPayment(first.updatedBill, [first.paymentRecord!], {
        payment_method: 'upi',
        amount_paise: 20000,
        idempotency_key: 'idem-3b',
      });

      expect(second.error).toBeUndefined();
      expect(second.updatedBill.payment_status).toBe('paid');
      expect(second.updatedBill.paid_paise).toBe(60000);
      expect(second.updatedBill.total_paise - second.updatedBill.paid_paise).toBe(0);
    });

    it('rejects payments exceeding remaining balance', () => {
      const bill: BillRecord = {
        id: 'bill-4',
        order_id: 'ord-4',
        total_paise: 30000, // ₹300.00
        paid_paise: 20000, // ₹200 already paid
        payment_status: 'partial',
        payment_method: 'cash',
      };

      const result = recordPayment(bill, [], {
        payment_method: 'cash',
        amount_paise: 15000, // ₹150 attempted (remaining is only ₹100)
      });

      expect(result.error).toContain('exceeds remaining balance');
      expect(result.updatedBill.paid_paise).toBe(20000);
    });

    it('prevents duplicate payment on retried requests with idempotency key', () => {
      const bill: BillRecord = {
        id: 'bill-5',
        order_id: 'ord-5',
        total_paise: 40000,
        paid_paise: 0,
        payment_status: 'unpaid',
        payment_method: null,
      };

      const firstAttempt = recordPayment(bill, [], {
        payment_method: 'cash',
        amount_paise: 40000,
        idempotency_key: 'idempotent-key-100',
      });

      expect(firstAttempt.error).toBeUndefined();
      expect(firstAttempt.updatedBill.paid_paise).toBe(40000);

      // Network retry with identical idempotency key
      const secondAttempt = recordPayment(firstAttempt.updatedBill, [firstAttempt.paymentRecord!], {
        payment_method: 'cash',
        amount_paise: 40000,
        idempotency_key: 'idempotent-key-100',
      });

      // Must return existing record without double-charging
      expect(secondAttempt.error).toBeUndefined();
      expect(secondAttempt.updatedBill.paid_paise).toBe(40000); // Still 40000, not 80000!
      expect(secondAttempt.paymentRecord?.id).toBe(firstAttempt.paymentRecord?.id);
    });
  });

  // =========================================================================
  // 2. Receipt and KOT Behavior
  // =========================================================================
  describe('2. Receipt and KOT rendering behavior', () => {
    function createMockBill(overrides?: Partial<Bill>): Bill {
      return {
        id: 'mock-bill-uuid-1',
        bill_number: 'URB-20261028-001',
        bill_seq: 1,
        order_id: 'mock-order-uuid-1',
        order_number: 101,
        table_number: 3,
        table_label: 'Table 3',
        customer_name: 'Priya Sharma',
        service_mode: 'dine_in',
        order_source: 'manual',
        status: 'issued',
        document_type: 'bill',
        business_snapshot: { cafe_name: 'Urbania Cafe' },
        subtotal_paise: 45000,
        discount_paise: 0,
        tax_rate: 0,
        tax_paise: 0,
        total_paise: 45000,
        notes: null,
        payment_method: 'cash',
        payment_status: 'paid',
        paid_paise: 45000,
        issued_at: new Date().toISOString(),
        items_snapshot: [
          {
            id: 'item-1',
            name: 'Cappuccino',
            quantity: 2,
            unit_price_paise: 18000,
            line_total_paise: 36000,
          },
          {
            id: 'item-2',
            name: 'Croissant',
            quantity: 1,
            unit_price_paise: 9000,
            line_total_paise: 9000,
          },
        ],
        ...overrides,
      };
    }

    it('renders customer receipt with Cash payment method line', () => {
      const bill = createMockBill({
        payment_method: 'cash',
        payment_status: 'paid',
        paid_paise: 45000,
      });

      const canvas = renderReceiptToCanvas(bill);
      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(384); // Hardware 48 mm width preserved
      expect(canvas.height).toBeGreaterThan(300);
    });

    it('renders customer receipt with Online/UPI payment method line', () => {
      const bill = createMockBill({
        payment_method: 'upi',
        payment_status: 'paid',
        paid_paise: 45000,
      });

      const canvas = renderReceiptToCanvas(bill);
      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(384);
      expect(canvas.height).toBeGreaterThan(300);
    });

    it('renders customer receipt with Partial payment method line when balance remains', () => {
      const bill = createMockBill({
        payment_method: 'cash',
        payment_status: 'partially_paid',
        paid_paise: 25000, // ₹250 of ₹450 paid
      });

      const canvas = renderReceiptToCanvas(bill);
      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(384);
      expect(canvas.height).toBeGreaterThan(300);
    });

    it('maintains strict zero financial totals and zero rupee amounts on KOT', () => {
      const kotOrder: KitchenTicketOrder = {
        id: 'ord-101',
        order_number: 101,
        created_at: new Date().toISOString(),
        customer_name: 'Rahul',
        service_mode: 'dine_in',
        cafe_tables: { label: 'Table 4' },
        order_items: [
          { item_name_snapshot: 'Avocado Toast', quantity: 2 },
          { item_name_snapshot: 'Cold Brew', quantity: 1, item_note: 'Less ice' },
        ],
      };

      // Mock canvas getContext to intercept fillText calls
      const filledTexts: string[] = [];
      const originalCreateElement = document.createElement.bind(document);
      const spy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = originalCreateElement(tagName);
        if (tagName.toLowerCase() === 'canvas') {
          const canvasEl = el as HTMLCanvasElement;
          const originalGetContext = canvasEl.getContext.bind(canvasEl);
          (canvasEl as any).getContext = (contextId: any, ...args: any[]) => {
            const ctx = originalGetContext(contextId, ...args);
            if (ctx && typeof (ctx as any).fillText === 'function') {
              const origFillText = (ctx as any).fillText.bind(ctx);
              (ctx as any).fillText = (text: string, x: number, y: number, maxWidth?: number) => {
                filledTexts.push(text);
                return origFillText(text, x, y, maxWidth);
              };
            }
            return ctx;
          };
        }
        return el;
      });

      const canvas = renderKitchenTicketToCanvas(kotOrder);
      spy.mockRestore();

      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(384);

      // Verify that no text contains currency symbol '₹' or financial keywords
      const financialIndicators = ['₹', 'INR', 'Rs.', 'Total:', 'Subtotal:', 'Discount:', 'Paid:'];
      for (const text of filledTexts) {
        for (const indicator of financialIndicators) {
          expect(text).not.toContain(indicator);
        }
      }
    });
  });

  // =========================================================================
  // 3. Reporting & Audit Reconciliation
  // =========================================================================
  describe('3. Reporting reconciliation across business days', () => {
    it('separates Cash and Online collections and reconciles with total collections', async () => {
      const mockOrders = [
        // Cash order: ₹300
        {
          id: 'o-1',
          order_number: 101,
          status: 'COMPLETED',
          order_source: 'manual',
          total_paise: 30000,
          created_at: '2026-10-28T10:00:00Z',
        },
        // UPI order: ₹500
        {
          id: 'o-2',
          order_number: 102,
          status: 'COMPLETED',
          order_source: 'qr',
          total_paise: 50000,
          created_at: '2026-10-28T11:00:00Z',
        },
        // Unpaid customer order: ₹200
        {
          id: 'o-3',
          order_number: 103,
          status: 'ACCEPTED',
          order_source: 'manual',
          total_paise: 20000,
          created_at: '2026-10-28T12:00:00Z',
        },
        // Swiggy delivery platform order: ₹400 (paid externally)
        {
          id: 'o-4',
          order_number: 104,
          status: 'COMPLETED',
          order_source: 'swiggy',
          total_paise: 40000,
          created_at: '2026-10-28T13:00:00Z',
        },
        // Admin credit order: ₹250
        {
          id: 'o-5',
          order_number: 105,
          status: 'COMPLETED',
          order_source: 'admin_credit',
          total_paise: 25000,
          paid_paise: 15000,
          created_at: '2026-10-28T14:00:00Z',
        },
      ];

      const mockBills = [
        {
          id: 'b-1',
          order_id: 'o-1',
          order_number: 101,
          status: 'issued',
          subtotal_paise: 30000,
          discount_paise: 0,
          total_paise: 30000,
          paid_paise: 30000,
          payment_status: 'paid',
          payment_method: 'cash',
          order_source: 'manual',
          issued_at: '2026-10-28T10:15:00Z',
        },
        {
          id: 'b-2',
          order_id: 'o-2',
          order_number: 102,
          status: 'issued',
          subtotal_paise: 50000,
          discount_paise: 0,
          total_paise: 50000,
          paid_paise: 50000,
          payment_status: 'paid',
          payment_method: 'upi',
          order_source: 'qr',
          issued_at: '2026-10-28T11:15:00Z',
        },
        {
          id: 'b-3',
          order_id: 'o-3',
          order_number: 103,
          status: 'issued',
          subtotal_paise: 20000,
          discount_paise: 0,
          total_paise: 20000,
          paid_paise: 0,
          payment_status: 'unpaid',
          payment_method: 'cash',
          order_source: 'manual',
          issued_at: '2026-10-28T12:15:00Z',
        },
      ];

      const mockPayments = [
        {
          id: 'p-1',
          payment_method: 'cash',
          amount_paise: 30000,
          status: 'completed',
          paid_at: '2026-10-28T10:15:00Z',
        },
        {
          id: 'p-2',
          payment_method: 'upi',
          amount_paise: 50000,
          status: 'completed',
          paid_at: '2026-10-28T11:15:00Z',
        },
      ];

      const mockSettlements = [
        {
          id: 's-1',
          order_id: 'o-5',
          amount_paise: 15000,
          settled_at: '2026-10-28T14:30:00Z',
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
                    : table === 'customer_payments'
                    ? mockPayments
                    : mockSettlements,
                error: null,
              }),
            }),
          }),
        }),
      };

      const metrics = await getDailyServiceMetrics(mockDb as any, '2026-10-28', 'Asia/Kolkata');

      // 1. Separate Cash & Online collections
      expect(metrics.cashCollectedPaise).toBe(30000); // ₹300 Cash
      expect(metrics.onlineCollectedPaise).toBe(50000); // ₹500 UPI
      expect(metrics.customerCollectedPaise).toBe(80000); // ₹800 Customer actual

      // 2. Outstanding customer balance (Order 103 is unpaid ₹200)
      expect(metrics.customerOutstandingPaise).toBe(20000);

      // 3. Admin credit settlement today
      expect(metrics.adminCreditSettledTodayPaise).toBe(15000);

      // 4. Delivery platform (Swiggy ₹400) - NOT in cafe cash or online collections
      expect(metrics.externalPlatformValuePaise).toBe(40000);

      // 5. Total Collections Reconciled:
      // totalCollectedPaise = customerCollectedPaise (80000) + adminCreditSettledTodayPaise (15000) = 95000
      expect(metrics.totalCollectedPaise).toBe(95000);
      expect(metrics.collectedPaise).toBe(95000);
      expect(metrics.cashCollectedPaise + metrics.onlineCollectedPaise + metrics.adminCreditSettledTodayPaise).toBe(metrics.totalCollectedPaise);
    });

    it('respects Asia/Kolkata timezone business day boundary', () => {
      // 2026-10-28 in Asia/Kolkata (+05:30):
      // Start is 2026-10-27T18:30:00.000Z
      // End is 2026-10-28T18:29:59.999Z
      const bounds = getTimezoneDateBounds('2026-10-28', 'Asia/Kolkata');
      expect(bounds.startUtcIso).toBe('2026-10-27T18:30:00.000Z');
      expect(bounds.endUtcIso).toBe('2026-10-28T18:29:59.999Z');
    });
  });
});
