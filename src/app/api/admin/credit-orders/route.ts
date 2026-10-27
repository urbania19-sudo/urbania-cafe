import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { owner } from '@/lib/owner';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';
import { friendlyBillingError } from '@/lib/billing';

export const dynamic = 'force-dynamic';

const creditOrderCreateSchema = z.object({
  adminUserId: z.string().uuid('Valid admin user ID required'),
  customerNote: z.string().max(300).optional().nullable(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid().optional().nullable(),
        name: z.string().max(100).optional().nullable(),
        quantity: z.number().int().min(1).max(20),
        unitPricePaise: z.number().int().min(0).optional(),
        optionIds: z.array(z.string().uuid()).optional(),
        note: z.string().max(180).optional().nullable(),
        isCustom: z.boolean().optional(),
      })
    )
    .min(1, 'Order must contain at least 1 item')
    .max(25),
});

export async function GET(req: NextRequest) {
  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const adminUserId = searchParams.get('adminUserId')?.trim() || '';
  const paymentStatus = searchParams.get('paymentStatus') || 'all';
  const startDate = searchParams.get('startDate')?.trim() || '';
  const endDate = searchParams.get('endDate')?.trim() || '';
  const search = searchParams.get('search')?.trim() || '';

  try {
    let query = db
      .from('orders')
      .select(
        'id, order_number, status, total_paise, subtotal_paise, created_at, customer_name, customer_note, order_source, admin_user_id, payment_status, paid_paise, order_items(id, item_name_snapshot, quantity, unit_price_paise, line_total_paise, item_note, is_custom)'
      )
      .eq('order_source', 'admin_credit')
      .order('created_at', { ascending: false });

    if (adminUserId && adminUserId !== 'all') {
      query = query.eq('admin_user_id', adminUserId);
    }
    if (paymentStatus && paymentStatus !== 'all') {
      query = query.eq('payment_status', paymentStatus);
    }
    if (startDate) {
      query = query.gte('created_at', `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query = query.lte('created_at', `${endDate}T23:59:59.999Z`);
    }
    if (search) {
      const isNum = /^[0-9]+$/.test(search);
      if (isNum) {
        query = query.or(`order_number.eq.${search},customer_name.ilike.%${search}%`);
      } else {
        query = query.ilike('customer_name', `%${search}%`);
      }
    }

    const { data: rawOrders, error } = await query;
    if (error) {
      console.error('Error fetching admin credit orders:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const orders = rawOrders || [];

    // Calculate aggregated balances per admin
    const summaryByAdmin: Record<string, { adminName: string; totalPaise: number; paidPaise: number; outstandingPaise: number; orderCount: number }> = {};
    let overallTotal = 0;
    let overallPaid = 0;
    let overallOutstanding = 0;

    for (const ord of orders) {
      const aId = ord.admin_user_id || 'unknown';
      const aName = ord.customer_name || 'Admin';
      const total = ord.total_paise || 0;
      const paid = ord.paid_paise || 0;
      const outstanding = Math.max(0, total - paid);

      if (!summaryByAdmin[aId]) {
        summaryByAdmin[aId] = {
          adminName: aName,
          totalPaise: 0,
          paidPaise: 0,
          outstandingPaise: 0,
          orderCount: 0,
        };
      }

      summaryByAdmin[aId].totalPaise += total;
      summaryByAdmin[aId].paidPaise += paid;
      summaryByAdmin[aId].outstandingPaise += outstanding;
      summaryByAdmin[aId].orderCount += 1;

      overallTotal += total;
      overallPaid += paid;
      overallOutstanding += outstanding;
    }

    return NextResponse.json({
      ok: true,
      orders,
      summary: {
        totalOrders: orders.length,
        overallTotalPaise: overallTotal,
        overallPaidPaise: overallPaid,
        overallOutstandingPaise: overallOutstanding,
        byAdmin: summaryByAdmin,
      },
    });
  } catch (err) {
    console.error('API Error in GET /api/admin/credit-orders:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = creditOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid admin credit order payload' },
      { status: 400 }
    );
  }

  const { adminUserId, customerNote, items } = parsed.data;

  try {
    // 1. Verify that target adminUserId is an authorized admin/owner
    const { data: targetProfile, error: profErr } = await db
      .from('admin_profiles')
      .select('user_id, role')
      .eq('user_id', adminUserId)
      .in('role', ['owner', 'admin'])
      .maybeSingle();

    if (profErr || !targetProfile) {
      return NextResponse.json(
        { error: 'Selected user is not an authorized administrator or owner.' },
        { status: 400 }
      );
    }

    // Attempt to load display name or email from get_authorized_admins
    let adminDisplayName = `Admin (${adminUserId.slice(0, 8)})`;
    try {
      const { data: admins } = await db.rpc('get_authorized_admins');
      const found = (admins || []).find((a: { user_id: string }) => a.user_id === adminUserId);
      if (found?.display_name) {
        adminDisplayName = found.display_name;
      }
    } catch {
      // Fallback display name
    }

    // 2. Validate dishes and calculate item totals
    let totalPaise = 0;
    const processedItems: {
      menuItemId: string | null;
      name: string;
      unitPricePaise: number;
      quantity: number;
      lineTotalPaise: number;
      note: string | null;
      options: { name: string; price_delta_paise: number }[];
      isCustom: boolean;
    }[] = [];

    for (const item of items) {
      if (item.isCustom) {
        const customName = item.name?.trim();
        if (!customName) {
          return NextResponse.json(
            { error: 'Custom item name cannot be empty.' },
            { status: 400 }
          );
        }
        const unitPrice = item.unitPricePaise ?? 0;
        const lineTotal = unitPrice * item.quantity;
        totalPaise += lineTotal;
        processedItems.push({
          menuItemId: null,
          name: customName,
          unitPricePaise: unitPrice,
          quantity: item.quantity,
          lineTotalPaise: lineTotal,
          note: item.note?.trim() || null,
          options: [],
          isCustom: true,
        });
      } else {
        if (!item.menuItemId) {
          return NextResponse.json(
            { error: 'Catalogue dish must provide a valid menuItemId.' },
            { status: 400 }
          );
        }
        const { data: menuItem } = await db
          .from('menu_items')
          .select('id, name, price_paise, is_available')
          .eq('id', item.menuItemId)
          .maybeSingle();

        if (!menuItem) {
          return NextResponse.json(
            { error: 'Selected menu item does not exist.' },
            { status: 400 }
          );
        }

        let optionsDelta = 0;
        const selectedOptions: { name: string; price_delta_paise: number }[] = [];

        if (item.optionIds && item.optionIds.length > 0) {
          const { data: optionsData } = await db
            .from('menu_item_options')
            .select('id, name, price_delta_paise, is_available')
            .in('id', item.optionIds)
            .eq('menu_item_id', menuItem.id);

          for (const opt of optionsData || []) {
            selectedOptions.push({
              name: opt.name,
              price_delta_paise: opt.price_delta_paise,
            });
            optionsDelta += opt.price_delta_paise;
          }
        }

        const unitPrice = menuItem.price_paise + optionsDelta;
        const lineTotal = unitPrice * item.quantity;
        totalPaise += lineTotal;

        processedItems.push({
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPricePaise: unitPrice,
          quantity: item.quantity,
          lineTotalPaise: lineTotal,
          note: item.note?.trim() || null,
          options: selectedOptions,
          isCustom: false,
        });
      }
    }

    const idempotencyKey = crypto.randomUUID();

    // 3. Insert order
    const { data: newOrder, error: orderErr } = await db
      .from('orders')
      .insert({
        order_source: 'admin_credit',
        service_mode: 'dine_in',
        status: 'ACCEPTED',
        customer_name: `Admin: ${adminDisplayName}`,
        admin_user_id: adminUserId,
        payment_status: 'unpaid',
        paid_paise: 0,
        guest_count: 1,
        customer_note: customerNote?.trim() ? `[Admin Credit] ${customerNote.trim()}` : '[Admin Credit Consumption]',
        subtotal_paise: totalPaise,
        total_paise: totalPaise,
        idempotency_key: idempotencyKey,
        accepted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (orderErr || !newOrder) {
      console.error('Admin credit order insert failed:', orderErr);
      return NextResponse.json(
        { error: friendlyBillingError(orderErr) },
        { status: 500 }
      );
    }

    // 4. Insert items
    const itemInserts = processedItems.map((pi) => ({
      order_id: newOrder.id,
      menu_item_id: pi.menuItemId,
      item_name_snapshot: pi.name,
      unit_price_paise: pi.unitPricePaise,
      quantity: pi.quantity,
      selected_options_snapshot: pi.options,
      line_total_paise: pi.lineTotalPaise,
      item_note: pi.note,
      is_custom: pi.isCustom,
    }));

    const { error: itemsErr } = await db.from('order_items').insert(itemInserts);
    if (itemsErr) {
      console.error('Order items insert failed:', itemsErr);
    }

    return NextResponse.json(
      {
        ok: true,
        order_id: newOrder.id,
        order_number: newOrder.order_number,
        admin_user_id: newOrder.admin_user_id,
        payment_status: newOrder.payment_status,
        total_paise: newOrder.total_paise,
        paid_paise: newOrder.paid_paise,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('API Error in POST /api/admin/credit-orders:', err);
    return NextResponse.json(
      { error: friendlyBillingError(err) },
      { status: 500 }
    );
  }
}
