import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authDb } from '@/lib/supabase/auth-server';
import { computeKitchenTicketDelta } from '@/lib/kitchen-tickets';
import type { KitchenTicketOrderItem } from '@/lib/thermal-canvas';
import { isPreviewDemoMode } from '@/lib/preview-demo';
import { DEMO_STAFF_ORDERS, DEMO_INITIAL_KOTS } from '@/lib/demo-fixtures';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await ctx.params;
  if (!z.string().uuid().safeParse(orderId).success) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  if (isPreviewDemoMode()) {
    const order = DEMO_STAFF_ORDERS.find((o) => o.id === orderId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const currentItems = (order.order_items || []) as unknown as KitchenTicketOrderItem[];
    const latestKot = DEMO_INITIAL_KOTS[orderId] || null;
    const acknowledgedSnapshot = (latestKot?.full_order_snapshot || null) as unknown as KitchenTicketOrderItem[] | null;
    const delta = computeKitchenTicketDelta(currentItems, acknowledgedSnapshot);
    const rawTable = order.cafe_tables as { label: string } | null | undefined;
    const tableLabel = rawTable?.label ?? null;

    return NextResponse.json({
      ok: true,
      order: {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        customer_name: order.customer_name,
        customer_note: order.customer_note,
        guest_count: order.guest_count,
        service_mode: order.service_mode,
        table_label: tableLabel,
        created_at: order.created_at,
      },
      latestAcknowledgedTicket: latestKot,
      delta: {
        ticketType: delta.ticketType,
        hasAdditions: delta.hasAdditions,
        deltaItems: delta.deltaItems,
        totalCurrentItemsCount: delta.totalCurrentItemsCount,
        addedItemsCount: delta.addedItemsCount,
      },
      currentItems,
    });
  }

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await db
    .from('admin_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch order items and latest acknowledged ticket
  const [orderRes, kotRes] = await Promise.all([
    db
      .from('orders')
      .select(
        'id,order_number,status,customer_name,customer_note,guest_count,total_paise,created_at,billed_at,service_mode,order_source,cafe_tables(label),order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)'
      )
      .eq('id', orderId)
      .maybeSingle(),
    db
      .from('order_kitchen_tickets')
      .select('id,ticket_number,ticket_type,items_snapshot,full_order_snapshot,created_at')
      .eq('order_id', orderId)
      .order('ticket_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (orderRes.error || !orderRes.data) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const order = orderRes.data;
  const currentItems = (order.order_items || []) as unknown as KitchenTicketOrderItem[];
  const latestKot = kotRes.data || null;

  const acknowledgedSnapshot = (latestKot?.full_order_snapshot || null) as unknown as KitchenTicketOrderItem[] | null;
  const delta = computeKitchenTicketDelta(currentItems, acknowledgedSnapshot);

  const rawTable = order.cafe_tables as { label: string } | { label: string }[] | null | undefined;
  const tableLabel = Array.isArray(rawTable) ? rawTable[0]?.label ?? null : rawTable?.label ?? null;

  return NextResponse.json({
    ok: true,
    order: {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      customer_name: order.customer_name,
      customer_note: order.customer_note,
      guest_count: order.guest_count,
      service_mode: order.service_mode,
      table_label: tableLabel,
      created_at: order.created_at,
    },
    latestAcknowledgedTicket: latestKot,
    delta: {
      ticketType: delta.ticketType,
      hasAdditions: delta.hasAdditions,
      deltaItems: delta.deltaItems,
      totalCurrentItemsCount: delta.totalCurrentItemsCount,
      addedItemsCount: delta.addedItemsCount,
    },
    currentItems,
  });
}
