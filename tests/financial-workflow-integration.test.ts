// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { getDailyServiceMetrics } from '../src/lib/reports';

// Load .env.local
const envPath = path.resolve('.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(
      fs
        .readFileSync(envPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('=').map((s) => s.trim()))
        .filter((p) => p.length === 2)
    )
  : {};

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

describe('Urbania Café — Financial Workflow Integration & Database Release Gate', () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let staffClient: SupabaseClient;

  let ownerUserId: string;
  let staffUserId: string;

  let tableId: string | null = null;
  let qrToken: string | null = null;
  let menuItemId: string | null = null;
  let menuItemPricePaise: number = 0;

  const createdOrderIds: string[] = [];
  const createdBillIds: string[] = [];

  beforeAll(async () => {
    // -------------------------------------------------------------------------
    // Isolation Requirement Guard
    // Financial integration tests mutate the append-only customer_payments ledger,
    // which cannot be deleted or mutated without violating the customer_payments_immutable
    // trigger. Therefore, this suite must only run against a dedicated disposable
    // database environment explicitly invoked via:
    //   ALLOW_DISPOSABLE_FINANCIAL_INTEGRATION=true npm run test:integration:financial
    // -------------------------------------------------------------------------
    const isExplicitDisposable =
      process.env.ALLOW_DISPOSABLE_FINANCIAL_INTEGRATION === 'true' ||
      Boolean(process.env.DISPOSABLE_SUPABASE_URL);

    if (!isExplicitDisposable) {
      throw new Error(
        'BLOCKED: Financial integration tests mutate the append-only customer_payments ledger, which cannot be cleaned up on a shared instance without violating the customer_payments_immutable trigger or dropping the database. To protect the persistent development database (127.0.0.1:54321), this integration suite must be explicitly invoked against a dedicated disposable test database using `npm run test:integration:financial` with ALLOW_DISPOSABLE_FINANCIAL_INTEGRATION=true.'
      );
    }

    // -------------------------------------------------------------------------
    // Safety Guard: Fail closed if target database is not strictly local
    // -------------------------------------------------------------------------
    const targetUrl = process.env.DISPOSABLE_SUPABASE_URL || SUPABASE_URL;
    const targetAnonKey = process.env.DISPOSABLE_ANON_KEY || ANON_KEY;
    const targetServiceKey = process.env.DISPOSABLE_SERVICE_KEY || SERVICE_KEY;

    const urlObj = new URL(targetUrl);
    const isLocal =
      urlObj.hostname === 'localhost' ||
      urlObj.hostname === '127.0.0.1' ||
      urlObj.hostname === '[::1]' ||
      urlObj.hostname === '0.0.0.0';

    if (!isLocal) {
      throw new Error(
        `SECURITY CHECK FAILED: Financial integration test suite is strictly prohibited from running against non-local environments (${targetUrl}). Tests aborted.`
      );
    }

    adminClient = createClient(targetUrl, targetServiceKey, { auth: { persistSession: false } });

    async function setupTestUserSession(email: string, envPasswordKey: string) {
      const { data: usersData, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) throw new Error(`Failed to list users: ${listErr.message}`);

      let user = usersData.users.find((u) => u.email === email);
      const testPassword = process.env[envPasswordKey] || env[envPasswordKey] || `${crypto.randomUUID()}!Aa1`;

      if (!user) {
        const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password: testPassword,
          email_confirm: true,
        });
        if (createErr) throw new Error(`Failed to create test user ${email}: ${createErr.message}`);
        user = newUser.user;
      } else {
        await adminClient.auth.admin.updateUserById(user.id, { password: testPassword });
      }

      const client = createClient(targetUrl, targetAnonKey, { auth: { persistSession: false } });
      const { data: authData, error: authErr } = await client.auth.signInWithPassword({
        email,
        password: testPassword,
      });

      if (authErr || !authData.session) {
        throw new Error(`Failed to authenticate ${email}: ${authErr?.message}`);
      }

      const authedClient = createClient(targetUrl, targetAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } },
      });

      return { user, client: authedClient };
    }

    const ownerAuth = await setupTestUserSession('owner@urbaniacafe.com', 'TEST_OWNER_PASSWORD');
    ownerClient = ownerAuth.client;
    ownerUserId = ownerAuth.user.id;
    await adminClient.from('admin_profiles').upsert({ user_id: ownerUserId, role: 'owner' });

    const staffAuth = await setupTestUserSession('staff@urbaniacafe.com', 'TEST_STAFF_PASSWORD');
    staffClient = staffAuth.client;
    staffUserId = staffAuth.user.id;
    await adminClient.from('admin_profiles').upsert({ user_id: staffUserId, role: 'staff' });

    // Fetch active table and menu item (or seed fallback if starting with bare migrations)
    const { data: tables } = await adminClient.from('cafe_tables').select('id, qr_token').eq('is_active', true).limit(1);
    if (tables && tables.length > 0) {
      tableId = tables[0].id;
      qrToken = tables[0].qr_token;
    } else {
      const { data: newTable } = await adminClient.from('cafe_tables').insert({
        table_number: 99,
        label: 'Table 99',
        qr_token: crypto.randomUUID(),
        is_active: true,
      }).select().single();
      tableId = newTable?.id || null;
      qrToken = newTable?.qr_token || null;
    }

    const { data: items } = await adminClient.from('menu_items').select('id, price_paise').eq('is_available', true).limit(1);
    if (items && items.length > 0) {
      menuItemId = items[0].id;
      menuItemPricePaise = items[0].price_paise || 20000;
    } else {
      let { data: cat } = await adminClient.from('menu_categories').select('id').limit(1).maybeSingle();
      if (!cat) {
        const { data: newCat } = await adminClient.from('menu_categories').insert({
          name: 'Coffee',
          slug: 'coffee',
          sort_order: 1,
        }).select().single();
        cat = newCat;
      }
      const { data: newItem } = await adminClient.from('menu_items').insert({
        category_id: cat?.id,
        name: 'Cappuccino',
        description: 'Test Cappuccino',
        price_paise: 20000,
        is_veg: true,
        is_available: true,
        sort_order: 1,
      }).select().single();
      menuItemId = newItem?.id || null;
      menuItemPricePaise = newItem?.price_paise || 20000;
    }
  });

  afterAll(async () => {
    // Non-destructive cleanup of ephemeral test records
    // Note: customer_payments has an immutable trigger preventing DELETE/UPDATE.
    // In our disposable database architecture, cleanup is performed at the container/volume
    // level by scripts/run-disposable-financial-integration.ps1 tearing down the ephemeral stack.
    // Payment rows are never deleted via SQL.
  });

  // ===========================================================================
  // 1. Bill Generation & Initial Financial Status
  // ===========================================================================
  it('1. Newly generated bill begins with unpaid status and zero paid balance', async () => {
    // Place a customer order using transactional place_public_order
    const orderKey = crypto.randomUUID();
    const { data: orderRes, error: orderErr } = await adminClient.rpc('place_public_order', {
      p_payload: {
        tableToken: qrToken,
        customerName: 'Financial Gate Test',
        guestCount: 2,
        idempotencyKey: orderKey,
        items: [{ menuItemId, quantity: 2, optionIds: [] }],
      },
    });
    expect(orderErr).toBeNull();
    expect(orderRes?.order_number).toBeDefined();

    const { data: orderRow } = await adminClient
      .from('orders')
      .select('id, total_paise, payment_status, paid_paise')
      .eq('idempotency_key', orderKey)
      .single();

    expect(orderRow).toBeDefined();
    const orderId = orderRow!.id;
    createdOrderIds.push(orderId);
    expect(orderRow!.payment_status).toBe('unpaid');
    expect(orderRow!.paid_paise).toBe(0);

    // Accept order and generate bill
    await staffClient.rpc('update_staff_order_status', {
      p_order_id: orderId,
      p_next: 'ACCEPTED',
    });

    const { data: billRes, error: billErr } = await staffClient.rpc('generate_bill', {
      p_order_id: orderId,
    });
    expect(billErr).toBeNull();
    expect(billRes?.ok).toBe(true);
    createdBillIds.push(billRes.bill.id);

    // Verify bill starts unpaid
    const { data: billRow } = await adminClient
      .from('bills')
      .select('id, total_paise, payment_status, paid_paise, status')
      .eq('id', billRes.bill.id)
      .single();

    expect(billRow!.status).toBe('issued');
    expect(billRow!.payment_status).toBe('unpaid');
    expect(billRow!.paid_paise).toBe(0);
    expect(billRow!.total_paise).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 2. Offline Customer Payment Lifecycle (Partial, Full, Overpayment)
  // ===========================================================================
  it('2. Customer payment lifecycle: partial payment, overpayment rejection, and full settlement', async () => {
    expect(createdBillIds.length).toBeGreaterThan(0);
    const billId = createdBillIds[0];
    const { data: billBefore } = await adminClient.from('bills').select('total_paise').eq('id', billId).single();
    expect(billBefore).toBeDefined();
    const totalPaise = billBefore!.total_paise;
    const halfPaise = Math.floor(totalPaise / 2);

    // 2.1 Record partial Cash payment
    const partialKey = crypto.randomUUID();
    const { data: partRes, error: partErr } = await staffClient.rpc('record_customer_payment', {
      p_bill_id: billId,
      p_amount_paise: halfPaise,
      p_payment_method: 'cash',
      p_notes: 'Advance cash payment',
      p_idempotency_key: partialKey,
    });
    expect(partErr).toBeNull();
    expect(partRes?.ok).toBe(true);
    expect(partRes?.already_recorded).toBe(false);

    // Verify bill is partially paid
    const { data: billMid } = await adminClient
      .from('bills')
      .select('paid_paise, payment_status, payment_method')
      .eq('id', billId)
      .single();

    expect(billMid!.paid_paise).toBe(halfPaise);
    expect(billMid!.payment_status).toBe('partially_paid');
    expect(billMid!.payment_method).toBe('cash');

    // 2.2 Reject payment exceeding remaining balance
    const remaining = totalPaise - halfPaise;
    const { error: overErr } = await staffClient.rpc('record_customer_payment', {
      p_bill_id: billId,
      p_amount_paise: remaining + 5000, // exceeds balance by ₹50
      p_payment_method: 'cash',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(overErr).not.toBeNull();
    expect(overErr?.message).toContain('URB:amount_exceeds_remaining_balance');

    // 2.3 Idempotency key conflict: reusing key with different amount or method raises conflict
    const { error: conflictErr } = await staffClient.rpc('record_customer_payment', {
      p_bill_id: billId,
      p_amount_paise: halfPaise + 500, // definitely different amount with partialKey
      p_payment_method: 'cash',
      p_idempotency_key: partialKey,
    });
    expect(conflictErr).not.toBeNull();
    expect(conflictErr?.message).toContain('URB:idempotency_conflict');

    // 2.4 Idempotency replay: exact retry returns original record safely
    const { data: replayRes, error: replayErr } = await staffClient.rpc('record_customer_payment', {
      p_bill_id: billId,
      p_amount_paise: halfPaise,
      p_payment_method: 'cash',
      p_notes: 'Advance cash payment',
      p_idempotency_key: partialKey,
    });
    expect(replayErr).toBeNull();
    expect(replayRes?.ok).toBe(true);
    expect(replayRes?.already_recorded).toBe(true);

    // 2.5 Complete payment via Online/UPI
    const fullKey = crypto.randomUUID();
    const { data: fullRes, error: fullErr } = await staffClient.rpc('record_customer_payment', {
      p_bill_id: billId,
      p_amount_paise: remaining,
      p_payment_method: 'upi',
      p_notes: 'Balance via Google Pay UPI',
      p_idempotency_key: fullKey,
    });
    expect(fullErr).toBeNull();
    expect(fullRes?.ok).toBe(true);

    const { data: billFinal } = await adminClient
      .from('bills')
      .select('paid_paise, payment_status, payment_method')
      .eq('id', billId)
      .single();

    expect(billFinal!.paid_paise).toBe(totalPaise);
    expect(billFinal!.payment_status).toBe('paid');
    expect(billFinal!.payment_method).toBe('upi');
  });

  // ===========================================================================
  // 3. Immutability of Customer Payment Ledger
  // ===========================================================================
  it('3. Customer payment ledger is strictly append-only (prevent_customer_payment_mutation)', async () => {
    expect(createdBillIds.length).toBeGreaterThan(0);
    const billId = createdBillIds[0];
    const { data: paymentRow } = await adminClient
      .from('customer_payments')
      .select('id, amount_paise')
      .eq('bill_id', billId)
      .limit(1)
      .single();

    expect(paymentRow).toBeDefined();

    // 3.1 Direct UPDATE is rejected by trigger
    const { error: updateErr } = await adminClient
      .from('customer_payments')
      .update({ amount_paise: 99999 })
      .eq('id', paymentRow!.id);

    expect(updateErr).not.toBeNull();
    expect(updateErr?.message).toContain('customer_payments is append-only');

    // 3.2 Direct DELETE is rejected by trigger
    const { error: deleteErr } = await adminClient
      .from('customer_payments')
      .delete()
      .eq('id', paymentRow!.id);

    expect(deleteErr).not.toBeNull();
    expect(deleteErr?.message).toContain('customer_payments is append-only');
  });

  // ===========================================================================
  // 4. Bill Cancellation & Voiding Integrity
  // ===========================================================================
  it('4. Bill cancellation marks bill cancelled and linked order CANCELLED; paying cancelled bill is blocked', async () => {
    const orderKey = crypto.randomUUID();
    const { data: orderRes, error: orderErr } = await adminClient.rpc('place_public_order', {
      p_payload: {
        tableToken: qrToken,
        customerName: 'Cancellation Integrity Test',
        guestCount: 1,
        idempotencyKey: orderKey,
        items: [{ menuItemId, quantity: 1, optionIds: [] }],
      },
    });
    expect(orderErr).toBeNull();
    expect(orderRes?.order_number).toBeDefined();

    const { data: orderRow } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', orderKey)
      .single();
    expect(orderRow).toBeDefined();
    const orderId = orderRow!.id;
    createdOrderIds.push(orderId);

    await staffClient.rpc('update_staff_order_status', {
      p_order_id: orderId,
      p_next: 'ACCEPTED',
    });

    const { data: billRes } = await staffClient.rpc('generate_bill', {
      p_order_id: orderId,
    });
    const cancelBillId = billRes.bill.id;
    createdBillIds.push(cancelBillId);

    // Cancel the bill via owner
    const { data: cancelRes, error: cancelErr } = await ownerClient.rpc('cancel_bill', {
      p_bill_id: cancelBillId,
      p_reason: 'Customer left before preparation',
    });
    expect(cancelErr).toBeNull();
    expect(cancelRes?.ok).toBe(true);

    // Verify bill status is cancelled
    const { data: cancelledBill } = await adminClient
      .from('bills')
      .select('status, cancellation_reason')
      .eq('id', cancelBillId)
      .single();
    expect(cancelledBill!.status).toBe('cancelled');
    expect(cancelledBill!.cancellation_reason).toContain('Customer left before preparation');

    // Verify linked order status is CANCELLED
    const { data: cancelledOrder } = await adminClient
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single();
    expect(cancelledOrder!.status).toBe('CANCELLED');

    // Verify attempting to record payment on cancelled bill fails closed
    const { error: payCancelErr } = await staffClient.rpc('record_customer_payment', {
      p_bill_id: cancelBillId,
      p_amount_paise: 5000,
      p_payment_method: 'cash',
    });
    expect(payCancelErr).not.toBeNull();
    expect(payCancelErr?.message).toContain('URB:cannot_pay_cancelled_bill');
  });

  // ===========================================================================
  // 5. Admin Credit Orders & Settlement Reconciliation
  // ===========================================================================
  it('5. Admin credit orders: creates unpaid receivable and reconciles via settlement RPC', async () => {
    const idempotencyKey = crypto.randomUUID();
    const { data: creditRes, error: creditErr } = await ownerClient.rpc('create_admin_credit_order', {
      p_payload: {
        adminUserId: ownerUserId,
        customerName: 'Owner Credit Tab',
        customerNote: 'Executive lunch',
        items: [{ menuItemId: menuItemId, quantity: 2 }],
        idempotencyKey,
      },
    });
    expect(creditErr).toBeNull();
    expect(creditRes?.ok).toBe(true);
    expect(creditRes?.order_id).toBeDefined();

    const creditOrderId = creditRes.order_id;
    createdOrderIds.push(creditOrderId);

    // Verify admin credit order starts as unpaid with zero paid balance
    const { data: creditOrderRow } = await adminClient
      .from('orders')
      .select('order_source, payment_status, total_paise, paid_paise')
      .eq('id', creditOrderId)
      .single();

    expect(creditOrderRow!.order_source).toBe('admin_credit');
    expect(creditOrderRow!.payment_status).toBe('unpaid');
    expect(creditOrderRow!.paid_paise).toBe(0);

    const totalPaise = creditOrderRow!.total_paise;

    // Settle partial payment via RPC
    const { data: settleRes, error: settleErr } = await ownerClient.rpc('settle_admin_credit_payment', {
      p_order_id: creditOrderId,
      p_amount_paise: Math.floor(totalPaise / 2),
      p_payment_method: 'bank_transfer',
      p_notes: 'Bank transfer batch 1',
    });
    expect(settleErr).toBeNull();
    expect(settleRes?.ok).toBe(true);

    // Verify status is partially paid
    const { data: settledMid } = await adminClient
      .from('orders')
      .select('payment_status, paid_paise')
      .eq('id', creditOrderId)
      .single();
    expect(settledMid!.payment_status).toBe('partially_paid');

    // Settle remaining balance
    const remaining = totalPaise - settledMid!.paid_paise;
    const { data: settleFullRes, error: settleFullErr } = await ownerClient.rpc('settle_admin_credit_payment', {
      p_order_id: creditOrderId,
      p_amount_paise: remaining,
      p_payment_method: 'bank_transfer',
      p_notes: 'Final bank transfer',
    });
    expect(settleFullErr).toBeNull();
    expect(settleFullRes?.ok).toBe(true);

    const { data: settledFinal } = await adminClient
      .from('orders')
      .select('payment_status, paid_paise')
      .eq('id', creditOrderId)
      .single();
    expect(settledFinal!.payment_status).toBe('paid');
    expect(settledFinal!.paid_paise).toBe(totalPaise);
  });

  // ===========================================================================
  // 6. Live Database Reporting Reconciliation
  // ===========================================================================
  it('6. Reporting reconciliation: getDailyServiceMetrics calculates correct cash, UPI, and net metrics', async () => {
    const metrics = await getDailyServiceMetrics(adminClient as any);
    expect(metrics).toBeDefined();

    // Verify mathematical reconciliation
    expect(metrics.customerCollectedPaise).toBe(
      metrics.cashCollectedPaise + metrics.onlineCollectedPaise + metrics.unclassifiedCollectedPaise
    );
    expect(metrics.totalCollectedPaise).toBe(
      metrics.customerCollectedPaise + metrics.adminCreditSettledTodayPaise
    );
    expect(metrics.grossSalesPaise).toBeGreaterThanOrEqual(metrics.netSalesPaise);
    expect(metrics.customerRefundsPaise).toBeGreaterThanOrEqual(0);
    expect(metrics.historicalRefundClassifiedPaise).toBe(metrics.customerRefundsPaise);
  });

  // ===========================================================================
  // 7. API Route Safety: Explicit Rejection of Unsupported Operations
  // ===========================================================================
  describe('7. API Route Safety: Explicit Rejection of Unsupported Operations', () => {
    it('7.1 POST /api/staff/bills/[billId]/payment rejects explicit refund operations', async () => {
      const { POST: paymentPost } = await import('../src/app/api/staff/bills/[billId]/payment/route');
      const testUuid = crypto.randomUUID();

      // Test with action: "refund"
      const req1 = new Request(`http://localhost:3000/api/staff/bills/${testUuid}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refund',
          payment_method: 'cash',
          amount_paise: 5000,
        }),
      });
      const res1 = await paymentPost(req1 as any, { params: Promise.resolve({ billId: testUuid }) });
      expect(res1.status).toBe(400);
      const data1 = await res1.json();
      expect(data1.error).toContain('Refunds and partial refunds are not supported');

      // Test with refund: true
      const req2 = new Request(`http://localhost:3000/api/staff/bills/${testUuid}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refund: true,
          payment_method: 'cash',
          amount_paise: 5000,
        }),
      });
      const res2 = await paymentPost(req2 as any, { params: Promise.resolve({ billId: testUuid }) });
      expect(res2.status).toBe(400);
      const data2 = await res2.json();
      expect(data2.error).toContain('Refunds and partial refunds are not supported');
    });

    it('7.2 POST /api/staff/bills/[billId]/payment rejects negative and zero amounts', async () => {
      const { POST: paymentPost } = await import('../src/app/api/staff/bills/[billId]/payment/route');
      const testUuid = crypto.randomUUID();

      const req = new Request(`http://localhost:3000/api/staff/bills/${testUuid}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method: 'cash',
          amount_paise: -5000,
        }),
      });
      const res = await paymentPost(req as any, { params: Promise.resolve({ billId: testUuid }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Negative amounts and refunds are not supported');
    });

    it('7.3 POST /api/admin/bills/[billId]/cancel rejects refund flags', async () => {
      const { POST: cancelPost } = await import('../src/app/api/admin/bills/[billId]/cancel/route');
      const testUuid = crypto.randomUUID();

      const req = new Request(`http://localhost:3000/api/admin/bills/${testUuid}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Customer cancelled',
          refund: true,
        }),
      });
      const res = await cancelPost(req as any, { params: Promise.resolve({ billId: testUuid }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Financial refunds are not supported during bill cancellation');
    });

    it('7.4 POST /api/admin/credit-orders/settle rejects refund / reversal actions', async () => {
      const { POST: settlePost } = await import('../src/app/api/admin/credit-orders/settle/route');

      const req = new Request('http://localhost:3000/api/admin/credit-orders/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: crypto.randomUUID(),
          amountPaise: 5000,
          paymentMethod: 'cash',
          action: 'refund',
        }),
      });
      const res = await settlePost(req as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Refunds and settlement reversals are not supported');
    });
  });
});
