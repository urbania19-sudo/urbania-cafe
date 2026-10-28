// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';
import fs from 'fs';
import path from 'path';

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
const APP_URL = 'http://127.0.0.1:3000';

describe('Migrations 0019 & 0020: PostgreSQL RLS Authorization & Order Integrity Test Suite', () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let staffClient: SupabaseClient;
  let unauthClient: SupabaseClient;
  let anonClient: SupabaseClient;

  let ownerUserId: string;
  let staffUserId: string;
  let staffCookieHeader: string = '';
  let ownerCookieHeader: string = '';

  let tableId: string | null = null;
  let qrToken: string | null = null;
  let menuItemId: string | null = null;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    // -------------------------------------------------------------------------
    // Safety Guard: Fail closed if SUPABASE_URL is not strictly local
    // -------------------------------------------------------------------------
    const urlObj = new URL(SUPABASE_URL);
    const isLocal =
      urlObj.hostname === 'localhost' ||
      urlObj.hostname === '127.0.0.1' ||
      urlObj.hostname === '[::1]' ||
      urlObj.hostname === '0.0.0.0';

    if (!isLocal) {
      throw new Error(
        `SECURITY CHECK FAILED: RLS integration test suite is strictly prohibited from running against non-local environments (${SUPABASE_URL}). Tests aborted.`
      );
    }

    adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

    // -------------------------------------------------------------------------
    // Safe Test Account Setup: Avoid hardcoded passwords in tracked test code
    // Use environment variables or generate ephemeral session passwords via admin API
    // -------------------------------------------------------------------------
    async function setupTestUserSession(email: string, envPasswordKey: string) {
      const { data: usersData, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) throw new Error(`Failed to list users: ${listErr.message}`);

      let user = usersData.users.find((u) => u.email === email);
      const testPassword = process.env[envPasswordKey] || `${crypto.randomUUID()}!Aa1`;

      if (!user) {
        // Create user if not present
        const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password: testPassword,
          email_confirm: true,
        });
        if (createErr) throw new Error(`Failed to create test user ${email}: ${createErr.message}`);
        user = newUser.user;
      } else {
        // Set dynamic password for this test execution
        await adminClient.auth.admin.updateUserById(user.id, { password: testPassword });
      }

      // Authenticate via client using password
      const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { data: authData, error: authErr } = await client.auth.signInWithPassword({
        email,
        password: testPassword,
      });

      if (authErr || !authData.session) {
        throw new Error(`Failed to authenticate ${email}: ${authErr?.message}`);
      }

      const authedClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } },
      });

      return { user, client: authedClient, password: testPassword };
    }

    const ownerAuth = await setupTestUserSession('owner@urbaniacafe.com', 'TEST_OWNER_PASSWORD');
    ownerClient = ownerAuth.client;
    ownerUserId = ownerAuth.user.id;

    const staffAuth = await setupTestUserSession('staff@urbaniacafe.com', 'TEST_STAFF_PASSWORD');
    staffClient = staffAuth.client;
    staffUserId = staffAuth.user.id;

    const unauthAuth = await setupTestUserSession('unauth_user@urbaniacafe.com', 'TEST_UNAUTH_PASSWORD');
    unauthClient = unauthAuth.client;

    // Setup staff cookie for Next.js API endpoint tests
    const cookieStore: Record<string, string> = {};
    const ssrClient = createBrowserClient(SUPABASE_URL, ANON_KEY, {
      cookieOptions: { name: 'sb-urbania-auth-token' },
      cookies: {
        getAll: () => Object.entries(cookieStore).map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          cookies.forEach((c) => {
            cookieStore[c.name] = c.value;
          });
        },
      },
    });
    await ssrClient.auth.signInWithPassword({
      email: 'staff@urbaniacafe.com',
      password: staffAuth.password,
    });
    staffCookieHeader = Object.entries(cookieStore).map(([k, v]) => `${k}=${v}`).join('; ');

    const ownerCookieStore: Record<string, string> = {};
    const ownerSsrClient = createBrowserClient(SUPABASE_URL, ANON_KEY, {
      cookieOptions: { name: 'sb-urbania-auth-token' },
      cookies: {
        getAll: () => Object.entries(ownerCookieStore).map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          cookies.forEach((c) => {
            ownerCookieStore[c.name] = c.value;
          });
        },
      },
    });
    await ownerSsrClient.auth.signInWithPassword({
      email: 'owner@urbaniacafe.com',
      password: ownerAuth.password,
    });
    ownerCookieHeader = Object.entries(ownerCookieStore).map(([k, v]) => `${k}=${v}`).join('; ');

    // Fixtures
    const { data: tables } = await adminClient.from('cafe_tables').select('id, qr_token').eq('is_active', true).limit(1);
    tableId = tables?.[0]?.id || null;
    qrToken = tables?.[0]?.qr_token || null;

    const { data: items } = await adminClient.from('menu_items').select('id').limit(1);
    menuItemId = items?.[0]?.id || null;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await adminClient.from('orders').delete().in('id', createdOrderIds);
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Staff can create a valid external delivery-platform order and its items
  // ---------------------------------------------------------------------------
  it('1. Staff can create a valid external delivery-platform order and its initial items', async () => {
    const key = crypto.randomUUID();
    const { data: order, error: orderErr } = await staffClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        customer_name: 'Swiggy #1234',
        guest_count: 1,
        subtotal_paise: 25000,
        total_paise: 25000,
        payment_status: 'external',
        paid_paise: 0,
        payment_method: null,
        external_platform_name: 'Swiggy',
        external_platform_ref: '#1234',
        idempotency_key: key,
      })
      .select()
      .single();

    expect(orderErr).toBeNull();
    expect(order).toBeDefined();
    expect(order?.payment_status).toBe('external');
    if (order?.id) createdOrderIds.push(order.id);

    const { data: item, error: itemErr } = await staffClient
      .from('order_items')
      .insert({
        order_id: order!.id,
        menu_item_id: menuItemId,
        item_name_snapshot: 'Swiggy Cappuccino',
        unit_price_paise: 25000,
        quantity: 1,
        line_total_paise: 25000,
      })
      .select()
      .single();

    expect(itemErr).toBeNull();
    expect(item?.order_id).toBe(order!.id);
  });

  // ---------------------------------------------------------------------------
  // 2. Staff cannot directly create admin-credit orders
  // ---------------------------------------------------------------------------
  it('2. Staff cannot directly create admin-credit orders', async () => {
    const key = crypto.randomUUID();
    const { data, error } = await staffClient
      .from('orders')
      .insert({
        order_source: 'admin_credit',
        service_mode: 'dine_in',
        status: 'ACCEPTED',
        customer_name: 'Staff Forged Credit Order',
        admin_user_id: staffUserId,
        guest_count: 1,
        subtotal_paise: 50000,
        total_paise: 50000,
        payment_status: 'unpaid',
        paid_paise: 0,
        idempotency_key: key,
      })
      .select();

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security policy/i);
    expect(data).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 3. Staff cannot create fake paid customer orders or forge paid_paise
  // ---------------------------------------------------------------------------
  it('3. Staff cannot create fake paid customer orders or forge paid_paise', async () => {
    // Direct manual insert by staff is blocked
    const key1 = crypto.randomUUID();
    const res1 = await staffClient
      .from('orders')
      .insert({
        order_source: 'manual',
        service_mode: 'dine_in',
        status: 'ACCEPTED',
        customer_name: 'Direct Manual Order',
        guest_count: 1,
        subtotal_paise: 10000,
        total_paise: 10000,
        payment_status: 'paid',
        paid_paise: 10000,
        idempotency_key: key1,
      })
      .select();

    expect(res1.error).not.toBeNull();
    expect(res1.error?.message).toMatch(/violates row-level security policy/i);

    // Delivery order with forged payment_status = 'paid' is blocked
    const key2 = crypto.randomUUID();
    const res2 = await staffClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        customer_name: 'Swiggy Forged Paid',
        guest_count: 1,
        subtotal_paise: 10000,
        total_paise: 10000,
        payment_status: 'paid',
        paid_paise: 0,
        idempotency_key: key2,
      })
      .select();

    expect(res2.error).not.toBeNull();
    expect(res2.error?.message).toMatch(/violates row-level security policy/i);

    // Delivery order with paid_paise > 0 is blocked
    const key3 = crypto.randomUUID();
    const res3 = await staffClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        customer_name: 'Swiggy Forged Balance',
        guest_count: 1,
        subtotal_paise: 10000,
        total_paise: 10000,
        payment_status: 'external',
        paid_paise: 5000,
        idempotency_key: key3,
      })
      .select();

    expect(res3.error).not.toBeNull();
    expect(res3.error?.message).toMatch(/violates row-level security policy/i);
  });

  // ---------------------------------------------------------------------------
  // 4. Staff cannot insert items into an admin-credit order
  // ---------------------------------------------------------------------------
  it('4. Staff cannot insert items into an admin-credit order', async () => {
    const key = crypto.randomUUID();
    const { data: adminOrder } = await ownerClient
      .from('orders')
      .insert({
        order_source: 'admin_credit',
        service_mode: 'dine_in',
        status: 'ACCEPTED',
        customer_name: 'Owner Credit Order',
        admin_user_id: ownerUserId,
        guest_count: 1,
        subtotal_paise: 30000,
        total_paise: 30000,
        payment_status: 'unpaid',
        paid_paise: 0,
        payment_method: null,
        idempotency_key: key,
      })
      .select()
      .single();

    expect(adminOrder).toBeDefined();
    if (adminOrder?.id) createdOrderIds.push(adminOrder.id);

    const { data: staffItem, error: staffItemErr } = await staffClient
      .from('order_items')
      .insert({
        order_id: adminOrder!.id,
        menu_item_id: menuItemId,
        item_name_snapshot: 'Staff Poison Item',
        unit_price_paise: 1000,
        quantity: 1,
        line_total_paise: 1000,
      })
      .select();

    expect(staffItemErr).not.toBeNull();
    expect(staffItemErr?.message).toMatch(/violates row-level security policy/i);
    expect(staffItem).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 5. Staff cannot insert items directly into ordinary existing customer orders
  // ---------------------------------------------------------------------------
  it('5. Staff cannot insert items directly into ordinary existing customer orders', async () => {
    const rpcKey = crypto.randomUUID();
    const { data: rpcData } = await staffClient.rpc('create_manual_order', {
      p_payload: {
        serviceMode: 'takeaway',
        customerName: 'Takeaway Customer',
        guestCount: 1,
        idempotencyKey: rpcKey,
        items: [{ menuItemId, quantity: 1 }],
      },
    });

    expect(rpcData?.ok).toBe(true);
    if (rpcData?.order_id) createdOrderIds.push(rpcData.order_id);

    const { data: directItem, error: directItemErr } = await staffClient
      .from('order_items')
      .insert({
        order_id: rpcData.order_id,
        menu_item_id: menuItemId,
        item_name_snapshot: 'Direct Injected Line Item',
        unit_price_paise: 5000,
        quantity: 1,
        line_total_paise: 5000,
      })
      .select();

    expect(directItemErr).not.toBeNull();
    expect(directItemErr?.message).toMatch(/violates row-level security policy/i);
    expect(directItem).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 6. Direct item insertion is strictly limited to initial creation:
  //    Repeat/subsequent direct item inserts on an existing order are REJECTED
  // ---------------------------------------------------------------------------
  it('6. Repeat direct item inserts on an existing order are rejected by RLS', async () => {
    // A) External delivery platform order
    const key1 = crypto.randomUUID();
    const { data: swiggyOrder } = await staffClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        customer_name: 'Swiggy Repeat Test',
        guest_count: 1,
        subtotal_paise: 20000,
        total_paise: 20000,
        payment_status: 'external',
        paid_paise: 0,
        payment_method: null,
        idempotency_key: key1,
      })
      .select()
      .single();

    if (swiggyOrder?.id) createdOrderIds.push(swiggyOrder.id);

    // Initial item insertion succeeds
    const { error: initialItemErr } = await staffClient
      .from('order_items')
      .insert({
        order_id: swiggyOrder!.id,
        menu_item_id: menuItemId,
        item_name_snapshot: 'Initial Item',
        unit_price_paise: 20000,
        quantity: 1,
        line_total_paise: 20000,
      });
    expect(initialItemErr).toBeNull();

    // Repeat item insertion on the same order must be REJECTED by RLS
    const { data: repeatItem, error: repeatItemErr } = await staffClient
      .from('order_items')
      .insert({
        order_id: swiggyOrder!.id,
        menu_item_id: menuItemId,
        item_name_snapshot: 'Repeat Injected Item',
        unit_price_paise: 5000,
        quantity: 1,
        line_total_paise: 5000,
      })
      .select();

    expect(repeatItemErr).not.toBeNull();
    expect(repeatItemErr?.message).toMatch(/violates row-level security policy/i);
    expect(repeatItem).toBeNull();

    // B) Admin credit order: admin cannot append repeat items directly via REST
    const key2 = crypto.randomUUID();
    const { data: adminOrder } = await ownerClient
      .from('orders')
      .insert({
        order_source: 'admin_credit',
        service_mode: 'dine_in',
        status: 'ACCEPTED',
        customer_name: 'Admin Credit Repeat Test',
        admin_user_id: ownerUserId,
        guest_count: 1,
        subtotal_paise: 25000,
        total_paise: 25000,
        payment_status: 'unpaid',
        paid_paise: 0,
        payment_method: null,
        idempotency_key: key2,
      })
      .select()
      .single();

    if (adminOrder?.id) createdOrderIds.push(adminOrder.id);

    // Initial item succeeds
    const { error: adminInitialErr } = await ownerClient
      .from('order_items')
      .insert({
        order_id: adminOrder!.id,
        menu_item_id: menuItemId,
        item_name_snapshot: 'Initial Admin Item',
        unit_price_paise: 25000,
        quantity: 1,
        line_total_paise: 25000,
      });
    expect(adminInitialErr).toBeNull();

    // Repeat item insert by admin is REJECTED by RLS
    const { data: adminRepeat, error: adminRepeatErr } = await ownerClient
      .from('order_items')
      .insert({
        order_id: adminOrder!.id,
        menu_item_id: menuItemId,
        item_name_snapshot: 'Sneaked Extra Admin Item',
        unit_price_paise: 5000,
        quantity: 1,
        line_total_paise: 5000,
      })
      .select();

    expect(adminRepeatErr).not.toBeNull();
    expect(adminRepeatErr?.message).toMatch(/violates row-level security policy/i);
    expect(adminRepeat).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 7. Staff cannot insert items into completed or cancelled orders
  // ---------------------------------------------------------------------------
  it('7. Staff cannot insert items into completed or cancelled orders', async () => {
    const key = crypto.randomUUID();
    const { data: order } = await staffClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        customer_name: 'Swiggy Cancelled Test',
        guest_count: 1,
        subtotal_paise: 20000,
        total_paise: 20000,
        payment_status: 'external',
        paid_paise: 0,
        payment_method: null,
        idempotency_key: key,
      })
      .select()
      .single();

    if (order?.id) createdOrderIds.push(order.id);

    await ownerClient.rpc('update_staff_order_status', {
      p_order_id: order!.id,
      p_next: 'CANCELLED',
      p_cancel_reason: 'Testing cancellation restriction',
    });

    const { data: item1, error: err1 } = await staffClient
      .from('order_items')
      .insert({
        order_id: order!.id,
        menu_item_id: menuItemId,
        item_name_snapshot: 'Cancelled Order Item',
        unit_price_paise: 5000,
        quantity: 1,
        line_total_paise: 5000,
      })
      .select();

    expect(err1).not.toBeNull();
    expect(err1?.message).toMatch(/violates row-level security policy/i);
    expect(item1).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 8. Transactional RPC: create_external_platform_order creates order & items atomically
  // ---------------------------------------------------------------------------
  it('8. create_external_platform_order RPC creates order and items atomically', async () => {
    const key = crypto.randomUUID();
    const { data, error } = await staffClient.rpc('create_external_platform_order', {
      p_payload: {
        orderSource: 'zomato',
        externalPlatformName: 'Zomato',
        externalPlatformRef: '#Z-9988',
        customerName: 'Zomato Guest',
        customerNote: 'Leave at front desk',
        guestCount: 1,
        idempotencyKey: key,
        items: [
          { menuItemId, quantity: 2 },
          { isCustom: true, name: 'Special Delivery Pack', unitPricePaise: 1500, quantity: 1 },
        ],
      },
    });

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.order_id).toBeDefined();
    if (data?.order_id) createdOrderIds.push(data.order_id);

    // Verify items exist in database
    const { data: itemsInDb } = await adminClient
      .from('order_items')
      .select('*')
      .eq('order_id', data.order_id);

    expect(itemsInDb).toHaveLength(2);

    // Idempotent retry returns existing order cleanly
    const { data: retryData } = await staffClient.rpc('create_external_platform_order', {
      p_payload: {
        orderSource: 'zomato',
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 2 }],
      },
    });

    expect(retryData?.order_id).toBe(data.order_id);
    expect(retryData?.order_number).toBe(data.order_number);
  });

  // ---------------------------------------------------------------------------
  // 9. Transactional RPC: create_admin_credit_order creates order & items atomically
  // ---------------------------------------------------------------------------
  it('9. create_admin_credit_order RPC creates order and items atomically', async () => {
    const key = crypto.randomUUID();
    const { data, error } = await ownerClient.rpc('create_admin_credit_order', {
      p_payload: {
        adminUserId: ownerUserId,
        customerNote: 'Executive Meeting',
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 3 }],
      },
    });

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.order_id).toBeDefined();
    if (data?.order_id) createdOrderIds.push(data.order_id);

    // Verify items exist
    const { data: itemsInDb } = await adminClient
      .from('order_items')
      .select('*')
      .eq('order_id', data.order_id);

    expect(itemsInDb).toHaveLength(1);
    expect(itemsInDb?.[0].quantity).toBe(3);

    // Staff cannot call create_admin_credit_order
    const { error: staffForbiddenErr } = await staffClient.rpc('create_admin_credit_order', {
      p_payload: {
        adminUserId: ownerUserId,
        items: [{ menuItemId, quantity: 1 }],
      },
    });

    expect(staffForbiddenErr).not.toBeNull();
    expect(staffForbiddenErr?.message).toMatch(/admin access required/i);
  });

  // ---------------------------------------------------------------------------
  // 10. Item insertion failure simulation & retry behavior: No permanently incomplete orders
  // ---------------------------------------------------------------------------
  it('10. Atomic order creation fails closed on invalid items without creating orphaned orders', async () => {
    const invalidKey = crypto.randomUUID();
    const fakeMenuItemId = crypto.randomUUID();

    // Calling RPC with an unavailable/non-existent item
    const { error: rpcErr } = await staffClient.rpc('create_external_platform_order', {
      p_payload: {
        orderSource: 'swiggy',
        idempotencyKey: invalidKey,
        items: [{ menuItemId: fakeMenuItemId, quantity: 1 }],
      },
    });

    expect(rpcErr).not.toBeNull();
    expect(rpcErr?.message).toMatch(/unavailable item/i);

    // Verify NO orphaned order exists in the database
    const { data: orphanedOrder } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', invalidKey)
      .maybeSingle();

    expect(orphanedOrder).toBeNull();

    // Now retry with the exact same idempotency key using valid items
    const { data: validData, error: validErr } = await staffClient.rpc('create_external_platform_order', {
      p_payload: {
        orderSource: 'swiggy',
        idempotencyKey: invalidKey,
        items: [{ menuItemId, quantity: 1 }],
      },
    });

    expect(validErr).toBeNull();
    expect(validData?.ok).toBe(true);
    expect(validData?.order_id).toBeDefined();
    if (validData?.order_id) createdOrderIds.push(validData.order_id);

    // Verify order and item both exist completely
    const { data: verifiedItems } = await adminClient
      .from('order_items')
      .select('id')
      .eq('order_id', validData.order_id);

    expect(verifiedItems).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 11. Unprivileged and anonymous users remain blocked
  // ---------------------------------------------------------------------------
  it('11. Unprivileged and anonymous users remain blocked from inserting orders or items', async () => {
    const key1 = crypto.randomUUID();
    const { error: unauthErr } = await unauthClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        subtotal_paise: 10000,
        total_paise: 10000,
        payment_status: 'external',
        paid_paise: 0,
        idempotency_key: key1,
      })
      .select();

    expect(unauthErr).not.toBeNull();
    expect(unauthErr?.message).toMatch(/violates row-level security policy/i);

    const key2 = crypto.randomUUID();
    const { error: anonErr } = await anonClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        subtotal_paise: 10000,
        total_paise: 10000,
        payment_status: 'external',
        paid_paise: 0,
        idempotency_key: key2,
      })
      .select();

    expect(anonErr).not.toBeNull();
    expect(anonErr?.message).toMatch(/violates row-level security policy/i);
  });

  // ---------------------------------------------------------------------------
  // 12. Public customer ordering, billing, and cancellation permissions work
  // ---------------------------------------------------------------------------
  it('12. Public customer ordering and existing billing/payment authorization continue to work', async () => {
    const publicOrderKey = crypto.randomUUID();
    const { data: pubOrder, error: pubErr } = await adminClient.rpc('place_public_order', {
      p_payload: {
        tableToken: qrToken,
        customerName: 'Public Customer',
        guestCount: 1,
        idempotencyKey: publicOrderKey,
        items: [{ menuItemId, quantity: 1, optionIds: [] }],
      },
    });

    expect(pubErr).toBeNull();
    expect(pubOrder?.order_number).toBeDefined();

    const { data: orderRow } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', publicOrderKey)
      .single();

    if (orderRow?.id) createdOrderIds.push(orderRow.id);

    await staffClient.rpc('update_staff_order_status', {
      p_order_id: orderRow!.id,
      p_next: 'ACCEPTED',
    });

    const { data: billRes, error: billErr } = await staffClient.rpc('generate_bill', {
      p_order_id: orderRow!.id,
    });
    expect(billErr).toBeNull();
    expect(billRes?.ok).toBe(true);

    const { error: cancelStaffErr } = await staffClient.rpc('cancel_bill', {
      p_bill_id: billRes.bill.id,
      p_reason: 'Staff attempted cancel',
    });
    expect(cancelStaffErr).not.toBeNull();

    const { error: cancelAdminErr } = await ownerClient.rpc('cancel_bill', {
      p_bill_id: billRes.bill.id,
      p_reason: 'Admin valid cancellation',
    });
    expect(cancelAdminErr).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 13. RLS append protection via security definer helper: order_has_items
  // ---------------------------------------------------------------------------
  it('13. order_has_items evaluates table reality and rejects bypass even across visibility boundaries', async () => {
    // 13.1 Helper behavior: non-existent order returns false
    const dummyOrderId = crypto.randomUUID();
    const { data: noItems, error: noItemsErr } = await staffClient.rpc('order_has_items', {
      p_order_id: dummyOrderId,
    });
    expect(noItemsErr).toBeNull();
    expect(noItems).toBe(false);

    // 13.2 Helper behavior: unauthorized authenticated caller fails closed (returns true)
    const { data: unauthCheck, error: unauthErr } = await unauthClient.rpc('order_has_items', {
      p_order_id: dummyOrderId,
    });
    expect(unauthErr).toBeNull();
    expect(unauthCheck).toBe(true);

    // 13.2b Migration 0022: Anonymous / PUBLIC execution revoked
    const { error: anonExecErr } = await anonClient.rpc('order_has_items', {
      p_order_id: dummyOrderId,
    });
    expect(anonExecErr).not.toBeNull();
    expect(anonExecErr?.message).toMatch(/permission denied/i);

    // 13.3 Create an external platform order with an initial item
    const key = crypto.randomUUID();
    const { data: order, error: orderErr } = await staffClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        customer_name: 'Append Test Guest',
        guest_count: 1,
        subtotal_paise: 20000,
        total_paise: 20000,
        payment_status: 'external',
        paid_paise: 0,
        payment_method: null,
        external_platform_name: 'Swiggy',
        idempotency_key: key,
      })
      .select()
      .single();

    expect(orderErr).toBeNull();
    expect(order?.id).toBeDefined();
    if (order?.id) createdOrderIds.push(order.id);

    const { error: item1Err } = await staffClient.from('order_items').insert({
      order_id: order!.id,
      menu_item_id: menuItemId,
      item_name_snapshot: 'Initial Item',
      unit_price_paise: 20000,
      quantity: 1,
      line_total_paise: 20000,
    });
    expect(item1Err).toBeNull();

    // 13.4 order_has_items reports true for the order with items
    const { data: hasItems, error: hasItemsErr } = await staffClient.rpc('order_has_items', {
      p_order_id: order!.id,
    });
    expect(hasItemsErr).toBeNull();
    expect(hasItems).toBe(true);

    // 13.5 Attempting to append an item directly via REST is rejected by RLS
    const { error: appendErr } = await staffClient.from('order_items').insert({
      order_id: order!.id,
      menu_item_id: menuItemId,
      item_name_snapshot: 'Unauthorized Append Item',
      unit_price_paise: 5000,
      quantity: 1,
      line_total_paise: 5000,
    });
    expect(appendErr).not.toBeNull();
    expect(appendErr?.message).toMatch(/violates row-level security policy/i);
  });

  // ---------------------------------------------------------------------------
  // 14. API routes fail closed on RPC errors and never bypass via direct insert fallback
  // ---------------------------------------------------------------------------
  it('14. API routes fail closed on RPC errors without falling back to direct table bypass', async () => {
    // 14.1 Staff orders route: invalid item quantity fails with 400, no order left behind
    const badStaffKey = crypto.randomUUID();
    const staffRes = await fetch(`${APP_URL}/api/staff/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: staffCookieHeader,
      },
      body: JSON.stringify({
        orderSource: 'swiggy',
        externalPlatformName: 'Swiggy',
        idempotencyKey: badStaffKey,
        items: [{ menuItemId, quantity: 999 }], // Exceeds valid range (max 20)
      }),
    });

    expect(staffRes.status).toBe(400);
    const staffBody = await staffRes.json();
    expect(staffBody.error).toBeDefined();

    // Verify no orphaned order exists in the database
    const { data: orphanedStaffOrder } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', badStaffKey)
      .maybeSingle();
    expect(orphanedStaffOrder).toBeNull();

    // 14.2 Admin credit route: invalid item quantity fails with 400, no order left behind
    const badAdminKey = crypto.randomUUID();
    const adminRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        adminUserId: ownerUserId,
        idempotencyKey: badAdminKey,
        items: [{ menuItemId, quantity: -5 }], // Invalid negative quantity
      }),
    });

    expect(adminRes.status).toBe(400);
    const adminBody = await adminRes.json();
    expect(adminBody.error).toBeDefined();

    // Verify no orphaned admin credit order exists
    const { data: orphanedAdminOrder } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', badAdminKey)
      .maybeSingle();
    expect(orphanedAdminOrder).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 15. Migration 0023: Order creation RPC execution privileges
  // ---------------------------------------------------------------------------
  it('15. Order creation RPC execution privileges: anon rejected at SQL layer, unauthorized authenticated rejected by function checks', async () => {
    // 15.1 Anonymous / unauthenticated callers: rejected by PostgreSQL EXECUTE permission
    const anonPayloadPlatform = {
      p_payload: {
        orderSource: 'swiggy',
        items: [{ menuItemId, quantity: 1 }],
      },
    };
    const { error: anonPlatformErr } = await anonClient.rpc(
      'create_external_platform_order',
      anonPayloadPlatform
    );
    expect(anonPlatformErr).not.toBeNull();
    expect(anonPlatformErr?.message).toMatch(/permission denied/i);

    const anonPayloadAdmin = {
      p_payload: {
        adminUserId: ownerUserId,
        items: [{ menuItemId, quantity: 1 }],
      },
    };
    const { error: anonAdminErr } = await anonClient.rpc(
      'create_admin_credit_order',
      anonPayloadAdmin
    );
    expect(anonAdminErr).not.toBeNull();
    expect(anonAdminErr?.message).toMatch(/permission denied/i);

    // 15.2 Unauthorized authenticated callers: rejected by internal function authorization checks
    const { error: unauthPlatformErr } = await unauthClient.rpc(
      'create_external_platform_order',
      anonPayloadPlatform
    );
    expect(unauthPlatformErr).not.toBeNull();
    expect(unauthPlatformErr?.message).toMatch(/URB:forbidden/i);

    const { error: unauthAdminErr } = await unauthClient.rpc(
      'create_admin_credit_order',
      anonPayloadAdmin
    );
    expect(unauthAdminErr).not.toBeNull();
    expect(unauthAdminErr?.message).toMatch(/Admin access required/i);

    // 15.3 Staff caller: rejected by function authorization on create_admin_credit_order
    const { error: staffAdminErr } = await staffClient.rpc(
      'create_admin_credit_order',
      anonPayloadAdmin
    );
    expect(staffAdminErr).not.toBeNull();
    expect(staffAdminErr?.message).toMatch(/Admin access required/i);
  });
});
