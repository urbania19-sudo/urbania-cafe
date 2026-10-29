// @vitest-environment node
import { describe, expect, it, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Dedicated Two-Phase Migration Replay Test Suite
// Executes against ephemeral disposable Supabase stack only.
describe('Urbania Café — Two-Phase Historical Migration Replay Test Harness', () => {
  let adminClient: SupabaseClient;
  const targetUrl = process.env.DISPOSABLE_SUPABASE_URL || 'http://127.0.0.1:54431';
  const serviceKey = process.env.DISPOSABLE_SERVICE_KEY;
  const replayPhase = process.env.REPLAY_PHASE || 'all';

  beforeAll(() => {
    const isAllowed =
      process.env.ALLOW_TWO_PHASE_REPLAY === 'true' ||
      Boolean(process.env.DISPOSABLE_SUPABASE_URL);

    if (!isAllowed) {
      throw new Error(
        'BLOCKED: Two-phase migration replay harness mutates database state and requires a dedicated disposable environment. Invoke via scripts/run-two-phase-migration-replay.ps1 with ALLOW_TWO_PHASE_REPLAY=true.'
      );
    }

    const urlObj = new URL(targetUrl);
    const isLocal =
      urlObj.hostname === 'localhost' ||
      urlObj.hostname === '127.0.0.1' ||
      urlObj.hostname === '0.0.0.0';

    if (!isLocal || !serviceKey) {
      throw new Error(
        `SECURITY CHECK FAILED: Target URL (${targetUrl}) must be local and service key must be provided.`
      );
    }

    adminClient = createClient(targetUrl, serviceKey, {
      auth: { persistSession: false },
    });
  });

  // ===========================================================================
  // PHASE 1: Legacy State & Historical Fixture Insertion (at migration 0015)
  // ===========================================================================
  if (replayPhase === 'phase1_seed' || replayPhase === 'all') {
    describe('Phase 1: Seed Controlled Historical Fixtures at Migration 0015', () => {
      it('1.1 Verifies database is at migration 0015 (pre-0016 schema)', async () => {
        // Query orders table directly with select
        const { data: testOrder, error: orderErr } = await adminClient
          .from('orders')
          .select('*')
          .limit(1);
        expect(orderErr).toBeNull();
        if (testOrder && testOrder.length > 0) {
          expect(testOrder[0]).not.toHaveProperty('payment_status');
          expect(testOrder[0]).not.toHaveProperty('paid_paise');
        }
      });

      it('1.2 Inserts production-derived legacy fixtures into pre-0016 schema', async () => {
        // Fetch a valid cafe_table
        const { data: tables, error: tableErr } = await adminClient
          .from('cafe_tables')
          .select('id')
          .limit(1);
        expect(tableErr).toBeNull();
        expect(tables && tables.length > 0).toBe(true);
        const tableId = tables![0].id;

        // Fetch a valid menu_item
        const { data: items } = await adminClient.from('menu_items').select('id, price_paise').limit(1);
        const menuItemId = items?.[0]?.id || null;

        // Finding 1: 4 Cancelled QR orders without bill (147,600 paise total)
        const cancelledUnbilledData = [
          { order_number: 10001, total_paise: 30000 },
          { order_number: 10002, total_paise: 42000 },
          { order_number: 10003, total_paise: 50600 },
          { order_number: 10004, total_paise: 25000 },
        ];
        const sumCan = cancelledUnbilledData.reduce((s, o) => s + o.total_paise, 0);
        expect(sumCan).toBe(147600); // ₹1,476

        for (const f of cancelledUnbilledData) {
          const { error: insErr } = await adminClient.from('orders').insert({
            order_number: f.order_number,
            table_id: tableId,
            order_source: 'qr',
            status: 'CANCELLED',
            subtotal_paise: f.total_paise,
            total_paise: f.total_paise,
            idempotency_key: crypto.randomUUID(),
          });
          expect(insErr).toBeNull();
        }

        // Finding 1: 3 Completed QR orders without bill (38,700 paise total)
        const compUnbilledData = [
          { order_number: 10005, total_paise: 12000 },
          { order_number: 10006, total_paise: 15700 },
          { order_number: 10007, total_paise: 11000 },
        ];
        const sumComp = compUnbilledData.reduce((s, o) => s + o.total_paise, 0);
        expect(sumComp).toBe(38700); // ₹387

        for (const f of compUnbilledData) {
          const { error: insErr } = await adminClient.from('orders').insert({
            order_number: f.order_number,
            table_id: tableId,
            order_source: 'qr',
            status: 'COMPLETED',
            subtotal_paise: f.total_paise,
            total_paise: f.total_paise,
            idempotency_key: crypto.randomUUID(),
          });
          expect(insErr).toBeNull();
        }

        // Finding 1: 1 Completed QR order WITH issued bill (25,800 paise)
        const billedOrderId = crypto.randomUUID();
        const { error: ordBilledErr } = await adminClient.from('orders').insert({
          id: billedOrderId,
          order_number: 10008,
          table_id: tableId,
          order_source: 'qr',
          status: 'COMPLETED',
          subtotal_paise: 25800,
          total_paise: 25800,
          idempotency_key: crypto.randomUUID(),
        });
        expect(ordBilledErr).toBeNull();

        const { error: billBilledErr } = await adminClient.from('bills').insert({
          order_id: billedOrderId,
          order_number: 10008,
          bill_number: 'UB-10008',
          bill_seq: 10008,
          status: 'issued',
          order_source: 'qr',
          document_type: 'bill',
          business_snapshot: {},
          items_snapshot: [],
          subtotal_paise: 25800,
          discount_paise: 0,
          tax_paise: 0,
          total_paise: 25800,
        });
        expect(billBilledErr).toBeNull();

        // Finding 2: 5 Discounted manual bills (165,000 subtotal, 21,200 discount, 143,800 billed)
        const discountedData = [
          { order_number: 10009, subtotal: 30000, discount: 4000, total: 26000 },
          { order_number: 10010, subtotal: 40000, discount: 5200, total: 34800 },
          { order_number: 10011, subtotal: 25000, discount: 3000, total: 22000 },
          { order_number: 10012, subtotal: 35000, discount: 4000, total: 31000 },
          { order_number: 10013, subtotal: 35000, discount: 5000, total: 30000 },
        ];
        expect(discountedData.reduce((s, d) => s + d.subtotal, 0)).toBe(165000);
        expect(discountedData.reduce((s, d) => s + d.discount, 0)).toBe(21200);
        expect(discountedData.reduce((s, d) => s + d.total, 0)).toBe(143800);

        for (const d of discountedData) {
          const ordId = crypto.randomUUID();
          const { error: oErr } = await adminClient.from('orders').insert({
            id: ordId,
            order_number: d.order_number,
            table_id: tableId,
            order_source: 'manual',
            status: 'COMPLETED',
            subtotal_paise: d.subtotal,
            total_paise: d.subtotal, // Order records undiscounted total
            idempotency_key: crypto.randomUUID(),
          });
          expect(oErr).toBeNull();

          const { error: bErr } = await adminClient.from('bills').insert({
            order_id: ordId,
            order_number: d.order_number,
            bill_number: `UB-${d.order_number}`,
            bill_seq: d.order_number,
            status: 'issued',
            order_source: 'manual',
            document_type: 'bill',
            business_snapshot: {},
            items_snapshot: [],
            subtotal_paise: d.subtotal,
            discount_paise: d.discount,
            tax_paise: 0,
            total_paise: d.total, // Bill records discounted total
          });
          expect(bErr).toBeNull();
        }

        // Finding 3: 17 Cancelled historical bills (481,100 paise total)
        // 16 bills at 28,000 paise (448,000 paise) + 1 bill at 33,100 paise = 481,100 paise (₹4,811)
        const cancelledBillAmounts: number[] = Array(16).fill(28000).concat([33100]);
        expect(cancelledBillAmounts.reduce((s, a) => s + a, 0)).toBe(481100);

        for (let i = 0; i < 17; i++) {
          const ordNum = 10014 + i;
          const amt = cancelledBillAmounts[i];
          const ordId = crypto.randomUUID();

          const { error: oErr } = await adminClient.from('orders').insert({
            id: ordId,
            order_number: ordNum,
            table_id: tableId,
            order_source: 'manual',
            status: 'CANCELLED',
            subtotal_paise: amt,
            total_paise: amt,
            idempotency_key: crypto.randomUUID(),
          });
          expect(oErr).toBeNull();

          const { error: bErr } = await adminClient.from('bills').insert({
            order_id: ordId,
            order_number: ordNum,
            bill_number: `UB-${ordNum}`,
            bill_seq: ordNum,
            status: 'cancelled',
            order_source: 'manual',
            document_type: 'bill',
            business_snapshot: {},
            items_snapshot: [],
            subtotal_paise: amt,
            discount_paise: 0,
            tax_paise: 0,
            total_paise: amt,
          });
          expect(bErr).toBeNull();
        }

        // External Delivery Orders: Swiggy and Zomato
        const swiggyOrderId = crypto.randomUUID();
        const { error: sOrdErr } = await adminClient.from('orders').insert({
          id: swiggyOrderId,
          order_number: 10031,
          table_id: tableId,
          order_source: 'swiggy',
          status: 'COMPLETED',
          subtotal_paise: 45000,
          total_paise: 45000,
          idempotency_key: crypto.randomUUID(),
        });
        expect(sOrdErr).toBeNull();

        const { error: sBillErr } = await adminClient.from('bills').insert({
          order_id: swiggyOrderId,
          order_number: 10031,
          bill_number: 'UB-10031',
          bill_seq: 10031,
          status: 'issued',
          order_source: 'swiggy',
          document_type: 'bill',
          business_snapshot: {},
          items_snapshot: [],
          subtotal_paise: 45000,
          discount_paise: 0,
          tax_paise: 0,
          total_paise: 45000,
        });
        expect(sBillErr).toBeNull();

        const zomatoOrderId = crypto.randomUUID();
        const { error: zOrdErr } = await adminClient.from('orders').insert({
          id: zomatoOrderId,
          order_number: 10032,
          table_id: tableId,
          order_source: 'zomato',
          status: 'COMPLETED',
          subtotal_paise: 60000,
          total_paise: 60000,
          idempotency_key: crypto.randomUUID(),
        });
        expect(zOrdErr).toBeNull();

        const { error: zBillErr } = await adminClient.from('bills').insert({
          order_id: zomatoOrderId,
          order_number: 10032,
          bill_number: 'UB-10032',
          bill_seq: 10032,
          status: 'issued',
          order_source: 'zomato',
          document_type: 'bill',
          business_snapshot: {},
          items_snapshot: [],
          subtotal_paise: 60000,
          discount_paise: 0,
          tax_paise: 0,
          total_paise: 60000,
        });
        expect(zBillErr).toBeNull();

        // Admin Credit Order
        const acOrderId = crypto.randomUUID();
        const { error: acOrdErr } = await adminClient.from('orders').insert({
          id: acOrderId,
          order_number: 10033,
          table_id: tableId,
          order_source: 'admin_credit',
          status: 'COMPLETED',
          subtotal_paise: 50000,
          total_paise: 50000,
          idempotency_key: crypto.randomUUID(),
        });
        expect(acOrdErr).toBeNull();

        const { error: acBillErr } = await adminClient.from('bills').insert({
          order_id: acOrderId,
          order_number: 10033,
          bill_number: 'UB-10033',
          bill_seq: 10033,
          status: 'issued',
          order_source: 'admin_credit',
          document_type: 'bill',
          business_snapshot: {},
          items_snapshot: [],
          subtotal_paise: 50000,
          discount_paise: 0,
          tax_paise: 0,
          total_paise: 50000,
        });
        expect(acBillErr).toBeNull();
      });
    });
  }

  // ===========================================================================
  // PHASE 2: Post-Migration Assertions against Real Rows (after migrations 0016–0026)
  // ===========================================================================
  if (replayPhase === 'phase2_verify' || replayPhase === 'all') {
    describe('Phase 2: Post-Migration Database Rows & Invariant Assertions', () => {
      it('2.1 Finding 1: 4 Cancelled QR orders without bill strictly remain unpaid with paid_paise = 0', async () => {
        const { data: orders, error } = await adminClient
          .from('orders')
          .select('order_number, status, payment_status, paid_paise, total_paise')
          .in('order_number', [10001, 10002, 10003, 10004]);

        expect(error).toBeNull();
        expect(orders).toBeDefined();
        expect(orders!.length).toBe(4);

        const totalPaise = orders!.reduce((s, o) => s + o.total_paise, 0);
        expect(totalPaise).toBe(147600); // 147,600 paise (₹1,476)

        for (const o of orders!) {
          expect(o.status).toBe('CANCELLED');
          expect(o.payment_status).toBe('unpaid');
          expect(o.paid_paise).toBe(0);
        }
      });

      it('2.2 Finding 1: 3 Completed QR orders without bill strictly remain unpaid with paid_paise = 0', async () => {
        const { data: orders, error } = await adminClient
          .from('orders')
          .select('order_number, status, payment_status, paid_paise, total_paise')
          .in('order_number', [10005, 10006, 10007]);

        expect(error).toBeNull();
        expect(orders).toBeDefined();
        expect(orders!.length).toBe(3);

        const totalPaise = orders!.reduce((s, o) => s + o.total_paise, 0);
        expect(totalPaise).toBe(38700); // 38,700 paise (₹387)

        for (const o of orders!) {
          expect(o.status).toBe('COMPLETED');
          expect(o.payment_status).toBe('unpaid');
          expect(o.paid_paise).toBe(0);
        }
      });

      it('2.3 Finding 1: 1 Completed QR order with issued bill is marked paid with paid_paise = 25800', async () => {
        const { data: order, error: ordErr } = await adminClient
          .from('orders')
          .select('order_number, status, payment_status, paid_paise, total_paise')
          .eq('order_number', 10008)
          .single();

        expect(ordErr).toBeNull();
        expect(order).toBeDefined();
        expect(order!.status).toBe('COMPLETED');
        expect(order!.payment_status).toBe('paid');
        expect(order!.paid_paise).toBe(25800);

        const { data: bill, error: billErr } = await adminClient
          .from('bills')
          .select('order_number, status, payment_status, paid_paise, total_paise')
          .eq('order_number', 10008)
          .single();

        expect(billErr).toBeNull();
        expect(bill).toBeDefined();
        expect(bill!.status).toBe('issued');
        expect(bill!.payment_status).toBe('paid');
        expect(bill!.paid_paise).toBe(25800);
      });

      it('2.4 Finding 2: 5 Discounted manual orders match bill totals with exactly zero discrepancy', async () => {
        const orderNums = [10009, 10010, 10011, 10012, 10013];

        const { data: orders, error: ordErr } = await adminClient
          .from('orders')
          .select('id, order_number, status, payment_status, paid_paise, total_paise')
          .in('order_number', orderNums);

        const { data: bills, error: billErr } = await adminClient
          .from('bills')
          .select('id, order_id, order_number, status, payment_status, paid_paise, subtotal_paise, discount_paise, total_paise')
          .in('order_number', orderNums);

        expect(ordErr).toBeNull();
        expect(billErr).toBeNull();
        expect(orders!.length).toBe(5);
        expect(bills!.length).toBe(5);

        // Undiscounted order sum is 165,000 paise (₹1,650)
        const grossOrderTotal = orders!.reduce((s, o) => s + o.total_paise, 0);
        expect(grossOrderTotal).toBe(165000);

        // Total discounts is 21,200 paise (₹212)
        const totalDiscounts = bills!.reduce((s, b) => s + (b.discount_paise || 0), 0);
        expect(totalDiscounts).toBe(21200);

        // Billed total is 143,800 paise (₹1,438)
        const netBillTotal = bills!.reduce((s, b) => s + b.total_paise, 0);
        expect(netBillTotal).toBe(143800);

        // For each order/bill pair:
        for (const bill of bills!) {
          const ord = orders!.find((o) => o.id === bill.order_id)!;
          expect(ord).toBeDefined();
          expect(bill.payment_status).toBe('paid');
          expect(ord.payment_status).toBe('paid');

          // CRITICAL INVARIANT: order.paid_paise matches the actual discounted bill total!
          expect(ord.paid_paise).toBe(bill.total_paise);
          expect(ord.paid_paise).toBe(bill.paid_paise);
          expect(ord.total_paise - (ord.paid_paise ?? 0)).toBe(bill.discount_paise);
        }

        // Total paid reported across orders and bills is identical
        const totalOrderPaid = orders!.reduce((s, o) => s + (o.paid_paise || 0), 0);
        const totalBillPaid = bills!.reduce((s, b) => s + (b.paid_paise || 0), 0);
        expect(totalOrderPaid).toBe(143800);
        expect(totalBillPaid).toBe(143800);
        expect(totalOrderPaid - totalBillPaid).toBe(0);
      });

      it('2.5 Finding 3: 17 Cancelled historical bills and their orders have payment_status = NULL and paid_paise = 0', async () => {
        const canOrderNums = Array.from({ length: 17 }, (_, i) => 10014 + i);

        const { data: bills, error: billErr } = await adminClient
          .from('bills')
          .select('order_id, order_number, status, payment_status, paid_paise, total_paise')
          .in('order_number', canOrderNums);

        const { data: orders, error: ordErr } = await adminClient
          .from('orders')
          .select('id, order_number, status, payment_status, paid_paise, total_paise')
          .in('order_number', canOrderNums);

        expect(billErr).toBeNull();
        expect(ordErr).toBeNull();
        expect(bills!.length).toBe(17);
        expect(orders!.length).toBe(17);

        const sumCancelledBills = bills!.reduce((s, b) => s + b.total_paise, 0);
        expect(sumCancelledBills).toBe(481100); // 481,100 paise (₹4,811)

        for (const bill of bills!) {
          expect(bill.status).toBe('cancelled');
          expect(bill.payment_status).toBeNull();
          expect(bill.paid_paise).toBe(0);

          const ord = orders!.find((o) => o.id === bill.order_id)!;
          expect(ord).toBeDefined();
          expect(ord.status).toBe('CANCELLED');
          expect(ord.payment_status).toBeNull();
          expect(ord.paid_paise).toBe(0);
        }
      });

      it('2.6 External orders & Admin Credit are classified with zero customer cash collected', async () => {
        const { data: extOrders } = await adminClient
          .from('orders')
          .select('order_number, order_source, payment_status, paid_paise')
          .in('order_number', [10031, 10032, 10033]);

        const swiggy = extOrders!.find((o) => o.order_number === 10031)!;
        const zomato = extOrders!.find((o) => o.order_number === 10032)!;
        const ac = extOrders!.find((o) => o.order_number === 10033)!;

        expect(swiggy.payment_status).toBe('external');
        expect(swiggy.paid_paise).toBe(0);

        expect(zomato.payment_status).toBe('external');
        expect(zomato.paid_paise).toBe(0);

        expect(ac.payment_status).toBe('unpaid');
        expect(ac.paid_paise).toBe(0);
      });

      it('2.7 customer_payments ledger is untouched by migration backfill (0 fake payments)', async () => {
        const { data: payments, error } = await adminClient
          .from('customer_payments')
          .select('id');

        expect(error).toBeNull();
        expect(payments).toBeDefined();
        expect(payments!.length).toBe(0); // Zero fake rows fabricated!
      });

      it('2.8 Schema constraints allow payment_status = null and reject invalid strings', async () => {
        const testOrderId = crypto.randomUUID();
        const testOrderNum = Math.floor(Math.random() * 900000) + 200000;

        // Inserting payment_status = null succeeds
        const { error: insNullErr } = await adminClient.from('orders').insert({
          id: testOrderId,
          order_number: testOrderNum,
          idempotency_key: crypto.randomUUID(),
          order_source: 'qr',
          service_mode: 'takeaway',
          status: 'CANCELLED',
          subtotal_paise: 20000,
          total_paise: 20000,
          payment_status: null,
          paid_paise: 0,
        });
        expect(insNullErr).toBeNull();

        // Inserting invalid payment_status is rejected by CHECK constraint
        const { error: insInvalidErr } = await adminClient.from('orders').insert({
          order_number: testOrderNum + 1,
          idempotency_key: crypto.randomUUID(),
          order_source: 'qr',
          service_mode: 'takeaway',
          status: 'NEW',
          subtotal_paise: 20000,
          total_paise: 20000,
          payment_status: 'invalid_status',
          paid_paise: 0,
        });
        expect(insInvalidErr).not.toBeNull();
        expect(insInvalidErr?.message).toContain('check constraint');
      });

      it('2.9 Append-only trigger prevents mutation on customer_payments', async () => {
        // Record a legitimate customer payment via RPC or direct insert via service_role
        const billId = (await adminClient.from('bills').select('id').eq('order_number', 10008).single()).data!.id;

        const { data: payRow, error: payErr } = await adminClient
          .from('customer_payments')
          .insert({
            bill_id: billId,
            order_id: (await adminClient.from('bills').select('order_id').eq('id', billId).single()).data!.order_id,
            amount_paise: 5000,
            payment_method: 'cash',
            idempotency_key: crypto.randomUUID(),
          })
          .select('id')
          .single();

        expect(payErr).toBeNull();
        expect(payRow?.id).toBeDefined();

        // Attempting to UPDATE the payment row must fail closed via trigger
        const { error: updErr } = await adminClient
          .from('customer_payments')
          .update({ amount_paise: 10000 })
          .eq('id', payRow!.id);

        expect(updErr).not.toBeNull();
        expect(updErr?.message).toContain('customer_payments is append-only');

        // Attempting to DELETE the payment row must fail closed via trigger
        const { error: delErr } = await adminClient
          .from('customer_payments')
          .delete()
          .eq('id', payRow!.id);

        expect(delErr).not.toBeNull();
        expect(delErr?.message).toContain('customer_payments is append-only');
      });
    });
  }
});
