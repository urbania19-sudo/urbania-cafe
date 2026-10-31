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

const hasCredentials = Boolean(ANON_KEY && SERVICE_KEY);
const describeSuite = hasCredentials ? describe : describe.skip;

describeSuite('Migrations 0019 & 0020: PostgreSQL RLS Authorization & Order Integrity Test Suite', () => {
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
  let secondMenuItemId: string | null = null;
  let menuItemPricePaise: number = 0;
  let validOptionId: string | null = null;
  let unavailableOptionId: string | null = null;
  let crossMenuOptionId: string | null = null;
  const createdOrderIds: string[] = [];
  const createdOptionIds: string[] = [];

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
      const testPassword = process.env[envPasswordKey] || env[envPasswordKey] || `${crypto.randomUUID()}!Aa1`;

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

    const { data: items } = await adminClient
      .from('menu_items')
      .select('id, name, price_paise')
      .eq('is_available', true)
      .limit(2);
    menuItemId = items?.[0]?.id || null;
    menuItemPricePaise = items?.[0]?.price_paise || 18000;
    secondMenuItemId = items?.[1]?.id || null;

    if (menuItemId && secondMenuItemId) {
      const { data: opt1, error: opt1Err } = await adminClient
        .from('menu_item_options')
        .insert({
          menu_item_id: menuItemId,
          name: 'Extra Test Shot',
          option_type: 'addon',
          price_delta_paise: 4000,
          is_available: true,
        })
        .select('id')
        .single();
      if (opt1Err) throw new Error(`Failed to create opt1: ${opt1Err.message}`);
      validOptionId = opt1?.id || null;
      if (opt1?.id) createdOptionIds.push(opt1.id);

      const { data: opt2, error: opt2Err } = await adminClient
        .from('menu_item_options')
        .insert({
          menu_item_id: menuItemId,
          name: 'Unavailable Oat Milk',
          option_type: 'addon',
          price_delta_paise: 5000,
          is_available: false,
        })
        .select('id')
        .single();
      if (opt2Err) throw new Error(`Failed to create opt2: ${opt2Err.message}`);
      unavailableOptionId = opt2?.id || null;
      if (opt2?.id) createdOptionIds.push(opt2.id);

      const { data: opt3, error: opt3Err } = await adminClient
        .from('menu_item_options')
        .insert({
          menu_item_id: secondMenuItemId,
          name: 'Cross Menu Extra Cheese',
          option_type: 'addon',
          price_delta_paise: 3000,
          is_available: true,
        })
        .select('id')
        .single();
      if (opt3Err) throw new Error(`Failed to create opt3: ${opt3Err.message}`);
      crossMenuOptionId = opt3?.id || null;
      if (opt3?.id) createdOptionIds.push(opt3.id);
    }
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await adminClient.from('orders').delete().in('id', createdOrderIds);
    }
    if (createdOptionIds.length > 0) {
      await adminClient.from('menu_item_options').delete().in('id', createdOptionIds);
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

  // ---------------------------------------------------------------------------
  // 16. Migration 0024: Option snapshot and price consistency hardening
  // ---------------------------------------------------------------------------
  it('16. Option snapshot & price consistency: cross-menu and unavailable options fail closed, valid options guarantee mathematical parity', async () => {
    expect(menuItemId).toBeDefined();
    expect(secondMenuItemId).toBeDefined();
    expect(validOptionId).toBeDefined();
    expect(unavailableOptionId).toBeDefined();
    expect(crossMenuOptionId).toBeDefined();

    // 16.1 External Platform Order: Cross-menu option is rejected and creates no order or items
    const crossMenuKeyPlatform = crypto.randomUUID();
    const { data: crossPlatData, error: crossPlatErr } = await staffClient.rpc(
      'create_external_platform_order',
      {
        p_payload: {
          orderSource: 'zomato',
          idempotencyKey: crossMenuKeyPlatform,
          items: [
            {
              menuItemId,
              quantity: 2,
              optionIds: [crossMenuOptionId],
            },
          ],
        },
      }
    );
    expect(crossPlatData).toBeNull();
    expect(crossPlatErr).not.toBeNull();
    expect(crossPlatErr?.message).toMatch(/invalid option|does not belong/i);

    const { data: orphanCrossPlatOrder } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', crossMenuKeyPlatform)
      .maybeSingle();
    expect(orphanCrossPlatOrder).toBeNull();

    // 16.2 External Platform Order: Unavailable option is rejected and creates no order or items
    const unavailKeyPlatform = crypto.randomUUID();
    const { data: unavailPlatData, error: unavailPlatErr } = await staffClient.rpc(
      'create_external_platform_order',
      {
        p_payload: {
          orderSource: 'swiggy',
          idempotencyKey: unavailKeyPlatform,
          items: [
            {
              menuItemId,
              quantity: 1,
              optionIds: [unavailableOptionId],
            },
          ],
        },
      }
    );
    expect(unavailPlatData).toBeNull();
    expect(unavailPlatErr).not.toBeNull();
    expect(unavailPlatErr?.message).toMatch(/unavailable option|not available/i);

    const { data: orphanUnavailPlatOrder } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', unavailKeyPlatform)
      .maybeSingle();
    expect(orphanUnavailPlatOrder).toBeNull();

    // 16.3 External Platform Order: Valid option produces exact order & line item total parity
    const validKeyPlatform = crypto.randomUUID();
    const platQty = 2;
    const expectedPlatLineTotal = (menuItemPricePaise + 4000) * platQty;

    const { data: validPlatData, error: validPlatErr } = await staffClient.rpc(
      'create_external_platform_order',
      {
        p_payload: {
          orderSource: 'swiggy',
          idempotencyKey: validKeyPlatform,
          items: [
            {
              menuItemId,
              quantity: platQty,
              optionIds: [validOptionId],
              note: 'Extra Hot',
            },
          ],
        },
      }
    );
    expect(validPlatErr).toBeNull();
    expect(validPlatData?.ok).toBe(true);
    expect(validPlatData?.order_id).toBeDefined();
    expect(validPlatData?.total_paise).toBe(expectedPlatLineTotal);
    if (validPlatData?.order_id) createdOrderIds.push(validPlatData.order_id);

    const { data: platItemsInDb } = await adminClient
      .from('order_items')
      .select('*')
      .eq('order_id', validPlatData.order_id);
    expect(platItemsInDb).toHaveLength(1);
    expect(platItemsInDb![0].line_total_paise).toBe(expectedPlatLineTotal);
    expect(platItemsInDb![0].unit_price_paise).toBe(menuItemPricePaise);
    expect(platItemsInDb![0].quantity).toBe(platQty);
    expect(platItemsInDb![0].selected_options_snapshot).toHaveLength(1);
    expect(platItemsInDb![0].selected_options_snapshot[0].name).toBe('Extra Test Shot');
    expect(platItemsInDb![0].selected_options_snapshot[0].price_delta_paise).toBe(4000);

    // Verify mathematical parity: order.total_paise === order_items.line_total_paise
    const { data: platOrderInDb } = await adminClient
      .from('orders')
      .select('total_paise, subtotal_paise')
      .eq('id', validPlatData.order_id)
      .single();
    expect(platOrderInDb?.total_paise).toBe(platItemsInDb![0].line_total_paise);
    expect(platOrderInDb?.subtotal_paise).toBe(platItemsInDb![0].line_total_paise);

    // 16.4 Admin Credit Order: Cross-menu option is rejected and creates no order or items
    const crossMenuKeyAdmin = crypto.randomUUID();
    const { data: crossAdminData, error: crossAdminErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          adminUserId: ownerUserId,
          idempotencyKey: crossMenuKeyAdmin,
          items: [
            {
              menuItemId,
              quantity: 1,
              optionIds: [crossMenuOptionId],
            },
          ],
        },
      }
    );
    expect(crossAdminData).toBeNull();
    expect(crossAdminErr).not.toBeNull();
    expect(crossAdminErr?.message).toMatch(/invalid option|does not belong/i);

    const { data: orphanCrossAdminOrder } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', crossMenuKeyAdmin)
      .maybeSingle();
    expect(orphanCrossAdminOrder).toBeNull();

    // 16.5 Admin Credit Order: Unavailable option is rejected and creates no order or items
    const unavailKeyAdmin = crypto.randomUUID();
    const { data: unavailAdminData, error: unavailAdminErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          adminUserId: ownerUserId,
          idempotencyKey: unavailKeyAdmin,
          items: [
            {
              menuItemId,
              quantity: 1,
              optionIds: [unavailableOptionId],
            },
          ],
        },
      }
    );
    expect(unavailAdminData).toBeNull();
    expect(unavailAdminErr).not.toBeNull();
    expect(unavailAdminErr?.message).toMatch(/unavailable option|not available/i);

    const { data: orphanUnavailAdminOrder } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', unavailKeyAdmin)
      .maybeSingle();
    expect(orphanUnavailAdminOrder).toBeNull();

    // 16.6 Admin Credit Order: Valid option produces exact order & line item total parity
    const validKeyAdmin = crypto.randomUUID();
    const adminQty = 3;
    const expectedAdminLineTotal = (menuItemPricePaise + 4000) * adminQty;

    const { data: validAdminData, error: validAdminErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          adminUserId: ownerUserId,
          customerNote: 'VIP Executive Meeting',
          idempotencyKey: validKeyAdmin,
          items: [
            {
              menuItemId,
              quantity: adminQty,
              optionIds: [validOptionId],
              note: 'High priority',
            },
          ],
        },
      }
    );
    expect(validAdminErr).toBeNull();
    expect(validAdminData?.ok).toBe(true);
    expect(validAdminData?.order_id).toBeDefined();
    expect(validAdminData?.total_paise).toBe(expectedAdminLineTotal);
    if (validAdminData?.order_id) createdOrderIds.push(validAdminData.order_id);

    const { data: adminItemsInDb } = await adminClient
      .from('order_items')
      .select('*')
      .eq('order_id', validAdminData.order_id);
    expect(adminItemsInDb).toHaveLength(1);
    expect(adminItemsInDb![0].line_total_paise).toBe(expectedAdminLineTotal);
    expect(adminItemsInDb![0].unit_price_paise).toBe(menuItemPricePaise);
    expect(adminItemsInDb![0].quantity).toBe(adminQty);
    expect(adminItemsInDb![0].selected_options_snapshot).toHaveLength(1);
    expect(adminItemsInDb![0].selected_options_snapshot[0].name).toBe('Extra Test Shot');
    expect(adminItemsInDb![0].selected_options_snapshot[0].price_delta_paise).toBe(4000);

    // Verify mathematical parity: order.total_paise === order_items.line_total_paise
    const { data: adminOrderInDb } = await adminClient
      .from('orders')
      .select('total_paise, subtotal_paise, payment_status')
      .eq('id', validAdminData.order_id)
      .single();
    expect(adminOrderInDb?.total_paise).toBe(adminItemsInDb![0].line_total_paise);
    expect(adminOrderInDb?.subtotal_paise).toBe(adminItemsInDb![0].line_total_paise);
    expect(adminOrderInDb?.payment_status).toBe('unpaid');
  });

  // ---------------------------------------------------------------------------
  // 17. Migration 0025: Admin credit order idempotency enforcement & concurrency
  // ---------------------------------------------------------------------------
  it('17. Admin credit order idempotency: rejects missing/malformed keys, safely reuses existing orders on retry, handles concurrency without duplicate orders', async () => {
    // 17.1 Missing idempotency key is rejected
    const { data: missingRpcData, error: missingRpcErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          adminUserId: ownerUserId,
          items: [{ menuItemId, quantity: 1 }],
        },
      }
    );
    expect(missingRpcData).toBeNull();
    expect(missingRpcErr).not.toBeNull();
    expect(missingRpcErr?.message).toMatch(/valid idempotency key required/i);

    const missingApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        adminUserId: ownerUserId,
        items: [{ menuItemId, quantity: 1 }],
      }),
    });
    expect(missingApiRes.status).toBe(400);
    const missingApiBody = await missingApiRes.json();
    expect(missingApiBody.error).toMatch(/valid idempotency key required/i);

    // 17.2 Malformed idempotency key is rejected
    const { data: malformedRpcData, error: malformedRpcErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          adminUserId: ownerUserId,
          idempotencyKey: 'not-a-valid-uuid',
          items: [{ menuItemId, quantity: 1 }],
        },
      }
    );
    expect(malformedRpcData).toBeNull();
    expect(malformedRpcErr).not.toBeNull();
    expect(malformedRpcErr?.message).toMatch(/valid idempotency key required/i);

    const malformedApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        adminUserId: ownerUserId,
        idempotencyKey: 'invalid-uuid-format',
        items: [{ menuItemId, quantity: 1 }],
      }),
    });
    expect(malformedApiRes.status).toBe(400);
    const malformedApiBody = await malformedApiRes.json();
    expect(malformedApiBody.error).toMatch(/valid idempotency key required/i);

    // 17.3 Successful admin-credit request followed by retry with same key returns same order
    const retryKey = crypto.randomUUID();
    const orderPayload = {
      adminUserId: ownerUserId,
      customerNote: 'Board Meeting Snacks',
      idempotencyKey: retryKey,
      items: [{ menuItemId, quantity: 2 }],
    };

    // First call: creates order
    const { data: firstOrderData, error: firstOrderErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      { p_payload: orderPayload }
    );
    expect(firstOrderErr).toBeNull();
    expect(firstOrderData?.ok).toBe(true);
    expect(firstOrderData?.order_id).toBeDefined();
    if (firstOrderData?.order_id) createdOrderIds.push(firstOrderData.order_id);

    // Second call with same key: returns identical order
    const { data: retryOrderData, error: retryOrderErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      { p_payload: orderPayload }
    );
    expect(retryOrderErr).toBeNull();
    expect(retryOrderData?.ok).toBe(true);
    expect(retryOrderData?.order_id).toBe(firstOrderData.order_id);
    expect(retryOrderData?.order_number).toBe(firstOrderData.order_number);
    expect(retryOrderData?.total_paise).toBe(firstOrderData.total_paise);

    // Verify DB count: strictly 1 order exists for retryKey
    const { data: ordersWithKey } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', retryKey);
    expect(ordersWithKey).toHaveLength(1);

    // Verify DB items count: items were not duplicated
    const { data: orderItemsInDb } = await adminClient
      .from('order_items')
      .select('id')
      .eq('order_id', firstOrderData.order_id);
    expect(orderItemsInDb).toHaveLength(1);

    // 17.4 Concurrent calls with the same key do not create duplicate orders
    const concurrentKey = crypto.randomUUID();
    const concurrentPayload = {
      adminUserId: ownerUserId,
      customerNote: 'Concurrent Test Order',
      idempotencyKey: concurrentKey,
      items: [{ menuItemId, quantity: 1 }],
    };

    const [call1, call2] = await Promise.all([
      ownerClient.rpc('create_admin_credit_order', { p_payload: concurrentPayload }),
      ownerClient.rpc('create_admin_credit_order', { p_payload: concurrentPayload }),
    ]);

    expect(call1.error).toBeNull();
    expect(call2.error).toBeNull();
    expect(call1.data?.ok).toBe(true);
    expect(call2.data?.ok).toBe(true);
    expect(call1.data?.order_id).toBe(call2.data?.order_id);
    expect(call1.data?.order_number).toBe(call2.data?.order_number);
    if (call1.data?.order_id) createdOrderIds.push(call1.data.order_id);

    // Verify exactly 1 order exists in database for concurrentKey
    const { data: concurrentOrdersInDb } = await adminClient
      .from('orders')
      .select('id')
      .eq('idempotency_key', concurrentKey);
    expect(concurrentOrdersInDb).toHaveLength(1);

    const { data: concurrentItemsInDb } = await adminClient
      .from('order_items')
      .select('id')
      .eq('order_id', call1.data.order_id);
    expect(concurrentItemsInDb).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 18. Migration 0026: Admin credit order payload fingerprinting, conflict detection & fail-closed behavior
  // ---------------------------------------------------------------------------
  it('18. Admin credit order payload fingerprinting: rejects payload tampering with HTTP 409/conflict, returns original on identical replay, and fails closed on unhashed legacy rows', async () => {
    // Obtain second admin/owner for target admin mismatch testing
    const { data: secondAdminProfile } = await adminClient
      .from('admin_profiles')
      .select('user_id')
      .in('role', ['owner', 'admin'])
      .neq('user_id', ownerUserId)
      .limit(1)
      .single();
    const secondAdminUserId = secondAdminProfile?.user_id;
    expect(secondAdminUserId).toBeDefined();

    // 18.1 Identical payload with same key returns original order (including whitespace normalization and option ordering)
    const baseKey = crypto.randomUUID();
    const basePayload = {
      adminUserId: ownerUserId,
      customerNote: 'Tasting Note Alpha',
      idempotencyKey: baseKey,
      items: [
        {
          menuItemId,
          quantity: 2,
          optionIds: [validOptionId],
        },
      ],
    };

    const { data: baseOrder, error: baseErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      { p_payload: basePayload }
    );
    expect(baseErr).toBeNull();
    expect(baseOrder?.ok).toBe(true);
    if (baseOrder?.order_id) createdOrderIds.push(baseOrder.order_id);

    // Verify idempotency_hash was populated in database
    const { data: storedBaseOrder } = await adminClient
      .from('orders')
      .select('id, idempotency_key, idempotency_hash')
      .eq('id', baseOrder.order_id)
      .single();
    expect(storedBaseOrder?.idempotency_hash).toBeDefined();
    expect(storedBaseOrder?.idempotency_hash?.length).toBe(64); // SHA-256 hex string

    // Replay with identical payload: returns original order
    const { data: replayOrder, error: replayErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      { p_payload: basePayload }
    );
    expect(replayErr).toBeNull();
    expect(replayOrder?.order_id).toBe(baseOrder.order_id);

    // Replay with normalized whitespace note: returns original order
    const { data: whitespaceReplayOrder, error: whitespaceReplayErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      { p_payload: { ...basePayload, customerNote: '  Tasting Note Alpha  ' } }
    );
    expect(whitespaceReplayErr).toBeNull();
    expect(whitespaceReplayOrder?.order_id).toBe(baseOrder.order_id);

    // 18.2 Different dish or quantity with same key -> conflict (RPC and HTTP 409 API)
    // Modified quantity:
    const { data: diffQtyData, error: diffQtyErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          ...basePayload,
          items: [{ menuItemId, quantity: 3, optionIds: [validOptionId] }],
        },
      }
    );
    expect(diffQtyData).toBeNull();
    expect(diffQtyErr?.message).toMatch(/URB:idempotency_conflict/);

    const diffQtyApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        ...basePayload,
        items: [{ menuItemId, quantity: 3, optionIds: [validOptionId] }],
      }),
    });
    expect(diffQtyApiRes.status).toBe(409);
    const diffQtyApiBody = await diffQtyApiRes.json();
    expect(diffQtyApiBody.error).toMatch(/already used for different order details/i);

    // Modified dish (secondMenuItemId instead of menuItemId):
    const { data: diffDishData, error: diffDishErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          ...basePayload,
          items: [{ menuItemId: secondMenuItemId, quantity: 2 }],
        },
      }
    );
    expect(diffDishData).toBeNull();
    expect(diffDishErr?.message).toMatch(/URB:idempotency_conflict/);

    const diffDishApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        ...basePayload,
        items: [{ menuItemId: secondMenuItemId, quantity: 2 }],
      }),
    });
    expect(diffDishApiRes.status).toBe(409);

    // 18.3 Different custom-item name or price with same key -> conflict
    const customKey = crypto.randomUUID();
    const customPayload = {
      adminUserId: ownerUserId,
      customerNote: 'Custom Blend Order',
      idempotencyKey: customKey,
      items: [
        {
          name: 'Special Pour Over',
          quantity: 1,
          unitPricePaise: 25000,
          isCustom: true,
        },
      ],
    };

    const { data: customOrder, error: customErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      { p_payload: customPayload }
    );
    expect(customErr).toBeNull();
    expect(customOrder?.ok).toBe(true);
    if (customOrder?.order_id) createdOrderIds.push(customOrder.order_id);

    // Replay customKey with different name
    const { data: diffCustomNameData, error: diffCustomNameErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          ...customPayload,
          items: [
            {
              name: 'Different Custom Name',
              quantity: 1,
              unitPricePaise: 25000,
              isCustom: true,
            },
          ],
        },
      }
    );
    expect(diffCustomNameData).toBeNull();
    expect(diffCustomNameErr?.message).toMatch(/URB:idempotency_conflict/);

    // Replay customKey with different price
    const { data: diffCustomPriceData, error: diffCustomPriceErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          ...customPayload,
          items: [
            {
              name: 'Special Pour Over',
              quantity: 1,
              unitPricePaise: 30000,
              isCustom: true,
            },
          ],
        },
      }
    );
    expect(diffCustomPriceData).toBeNull();
    expect(diffCustomPriceErr?.message).toMatch(/URB:idempotency_conflict/);

    const diffCustomPriceApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        ...customPayload,
        items: [
          {
            name: 'Special Pour Over',
            quantity: 1,
            unitPricePaise: 30000,
            isCustom: true,
          },
        ],
      }),
    });
    expect(diffCustomPriceApiRes.status).toBe(409);

    // 18.4 Different customer note with same key -> conflict
    const { data: diffNoteData, error: diffNoteErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          ...basePayload,
          customerNote: 'Tampered Note Beta',
        },
      }
    );
    expect(diffNoteData).toBeNull();
    expect(diffNoteErr?.message).toMatch(/URB:idempotency_conflict/);

    const diffNoteApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        ...basePayload,
        customerNote: 'Tampered Note Beta',
      }),
    });
    expect(diffNoteApiRes.status).toBe(409);

    // 18.5 Different target administrator with same key -> conflict
    const { data: diffAdminData, error: diffAdminErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          ...basePayload,
          adminUserId: secondAdminUserId,
        },
      }
    );
    expect(diffAdminData).toBeNull();
    expect(diffAdminErr?.message).toMatch(/URB:idempotency_conflict/);

    const diffAdminApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        ...basePayload,
        adminUserId: secondAdminUserId,
      }),
    });
    expect(diffAdminApiRes.status).toBe(409);

    // 18.6 Same key reused across different order sources -> conflict
    const swiggyKey = crypto.randomUUID();
    const { data: swiggyOrder, error: swiggyErr } = await staffClient
      .from('orders')
      .insert({
        order_source: 'swiggy',
        service_mode: 'delivery',
        status: 'ACCEPTED',
        customer_name: 'Swiggy Idempotency Test',
        guest_count: 1,
        subtotal_paise: 20000,
        total_paise: 20000,
        payment_status: 'external',
        paid_paise: 0,
        idempotency_key: swiggyKey,
        external_platform_name: 'Swiggy',
      })
      .select('id')
      .single();
    expect(swiggyErr).toBeNull();
    if (swiggyOrder?.id) createdOrderIds.push(swiggyOrder.id);

    const { data: crossSourceData, error: crossSourceErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          adminUserId: ownerUserId,
          idempotencyKey: swiggyKey,
          items: [{ menuItemId, quantity: 1 }],
        },
      }
    );
    expect(crossSourceData).toBeNull();
    expect(crossSourceErr?.message).toMatch(/URB:idempotency_conflict/);

    const crossSourceApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        adminUserId: ownerUserId,
        idempotencyKey: swiggyKey,
        items: [{ menuItemId, quantity: 1 }],
      }),
    });
    expect(crossSourceApiRes.status).toBe(409);

    // 18.7 Legacy row with no fingerprint: safe, documented fail-closed behavior
    const legacyKey = crypto.randomUUID();
    const { data: legacyOrder, error: legacyErr } = await adminClient
      .from('orders')
      .insert({
        order_source: 'admin_credit',
        service_mode: 'dine_in',
        status: 'ACCEPTED',
        customer_name: 'Admin: Legacy User',
        admin_user_id: ownerUserId,
        guest_count: 1,
        subtotal_paise: 15000,
        total_paise: 15000,
        payment_status: 'unpaid',
        paid_paise: 0,
        idempotency_key: legacyKey,
        idempotency_hash: null, // Legacy unhashed order
      })
      .select('id')
      .single();
    expect(legacyErr).toBeNull();
    if (legacyOrder?.id) createdOrderIds.push(legacyOrder.id);

    const { data: legacyReplayData, error: legacyReplayErr } = await ownerClient.rpc(
      'create_admin_credit_order',
      {
        p_payload: {
          adminUserId: ownerUserId,
          idempotencyKey: legacyKey,
          items: [{ menuItemId, quantity: 1 }],
        },
      }
    );
    expect(legacyReplayData).toBeNull();
    expect(legacyReplayErr?.message).toMatch(/URB:idempotency_conflict/);

    const legacyReplayApiRes = await fetch(`${APP_URL}/api/admin/credit-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader,
      },
      body: JSON.stringify({
        adminUserId: ownerUserId,
        idempotencyKey: legacyKey,
        items: [{ menuItemId, quantity: 1 }],
      }),
    });
    expect(legacyReplayApiRes.status).toBe(409);
  });
  // ---------------------------------------------------------------------------
  // 19. Identity-bound role helper hardening (Migration 0027)
  // ---------------------------------------------------------------------------
  it('19. Role helpers allow self-checks, reject cross-user checks, and deny anon execution', async () => {
    const { data: ownerAdmin, error: ownerAdminErr } = await ownerClient.rpc('has_role', {
      _user_id: ownerUserId,
      _role: 'admin',
    });
    expect(ownerAdminErr).toBeNull();
    expect(ownerAdmin).toBe(true);
    const { data: ownerIsAdmin, error: ownerIsAdminErr } = await ownerClient.rpc('is_admin');
    expect(ownerIsAdminErr).toBeNull();
    expect(ownerIsAdmin).toBe(true);

    const { data: staffIsStaff, error: staffIsStaffErr } = await staffClient.rpc('is_staff');
    expect(staffIsStaffErr).toBeNull();
    expect(staffIsStaff).toBe(true);

    const { data: staffAdmin, error: staffAdminErr } = await staffClient.rpc('has_role', {
      _user_id: ownerUserId,
      _role: 'admin',
    });
    expect(staffAdminErr).toBeNull();
    expect(staffAdmin).toBe(false);

    const { data: staffKitchen, error: staffKitchenErr } = await staffClient.rpc('has_role', {
      _user_id: staffUserId,
      _role: 'kitchen',
    });
    expect(staffKitchenErr).toBeNull();
    expect(staffKitchen).toBe(true);

    const { data: staffSelf, error: staffSelfErr } = await staffClient.rpc('is_staff', {
      _user_id: staffUserId,
    });
    expect(staffSelfErr).toBeNull();
    expect(staffSelf).toBe(true);

    const { data: crossUserStaff, error: crossUserStaffErr } = await ownerClient.rpc('is_staff', {
      _user_id: staffUserId,
    });
    expect(crossUserStaffErr).toBeNull();
    expect(crossUserStaff).toBe(false);

    const { error: anonRoleErr } = await anonClient.rpc('has_role', {
      _user_id: ownerUserId,
      _role: 'admin',
    });
    expect(anonRoleErr).not.toBeNull();
    expect(anonRoleErr?.message).toMatch(/permission denied/i);

    const { error: anonStaffErr } = await anonClient.rpc('is_staff', {
      _user_id: staffUserId,
    });
    expect(anonStaffErr).not.toBeNull();
    expect(anonStaffErr?.message).toMatch(/permission denied/i);
    const { error: anonIsAdminErr } = await anonClient.rpc('is_admin');
    expect(anonIsAdminErr).not.toBeNull();
    expect(anonIsAdminErr?.message).toMatch(/permission denied/i);

    const { error: anonIsStaffErr } = await anonClient.rpc('is_staff');
    expect(anonIsStaffErr).not.toBeNull();
    expect(anonIsStaffErr?.message).toMatch(/permission denied/i);

    const { error: publicCategoryErr } = await anonClient
      .from('categories')
      .select('id')
      .limit(1);
    expect(publicCategoryErr).toBeNull();

    const { error: publicStatusErr } = await anonClient.rpc('get_order_status', {
      _order_id: crypto.randomUUID(),
      _public_token: 'nonexistent-public-token-00000000',
    });
    expect(publicStatusErr).toBeNull();
  });

});
