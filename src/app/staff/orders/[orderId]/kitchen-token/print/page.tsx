import { redirect, notFound } from 'next/navigation';
import { authDb } from '@/lib/supabase/auth-server';
import KitchenTokenPrintView from '@/components/kitchen/KitchenTokenPrintView';
import {
  SAMPLE_KITCHEN_ORDER,
  type KitchenTicketOrder,
  type KitchenTicketOrderItem,
} from '@/lib/thermal-canvas';
import { computeKitchenTicketDelta, createFullReprintTicket } from '@/lib/kitchen-tickets';
import { isPreviewDemoMode } from '@/lib/preview-demo';
import PreviewDemoBanner from '@/components/demo/PreviewDemoBanner';
import { findDemoKitchenTicketOrder } from '@/lib/demo-fixtures';

export const dynamic = 'force-dynamic';

export default async function KitchenTokenPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ reprint?: string; mode?: string }>;
}) {
  const { orderId } = await params;
  const { reprint, mode } = await searchParams;
  const isReprint = reprint === 'true' || mode === 'full';
  const isDemo = isPreviewDemoMode();

  // Preview Demo Mode
  if (isDemo) {
    const demoOrder = findDemoKitchenTicketOrder(orderId) || SAMPLE_KITCHEN_ORDER;
    const orderToPrint = isReprint ? createFullReprintTicket(demoOrder) : demoOrder;
    return (
      <>
        <PreviewDemoBanner />
        <KitchenTokenPrintView
          order={orderToPrint}
          isReprint={isReprint}
          ticketType={isReprint ? 'reprint' : orderToPrint.ticket_type || 'new'}
        />
      </>
    );
  }

  // Sample token for thermal printer testing (e.g. Fun Print MX11) without requiring auth or DB
  if (orderId === 'sample' || orderId === '00000000-0000-0000-0000-000000000000') {
    return <KitchenTokenPrintView order={SAMPLE_KITCHEN_ORDER} isReprint={isReprint} />;
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
  if (!isUuid) {
    notFound();
  }

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    redirect(`/staff/login?next=/staff/orders/${orderId}/kitchen-token/print${isReprint ? '?reprint=true' : ''}`);
  }

  const { data: profile } = await db
    .from('admin_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    redirect('/staff/login');
  }

  let order: any = null;
  let error: any = null;

  const orderRes = await db
    .from('orders')
    .select(
      'id,order_number,status,customer_name,customer_note,guest_count,total_paise,created_at,billed_at,service_mode,order_source,payment_status,external_platform_name,external_platform_ref,cafe_tables(label),order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)'
    )
    .eq('id', orderId)
    .maybeSingle();

  if (orderRes.error) {
    // Fallback for pre-0016 schema where payment_status / external_platform_* columns do not exist
    const fallback = await db
      .from('orders')
      .select(
        'id,order_number,status,customer_name,customer_note,guest_count,total_paise,created_at,billed_at,service_mode,order_source,cafe_tables(label),order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)'
      )
      .eq('id', orderId)
      .maybeSingle();
    order = fallback.data;
    error = fallback.error;
  } else {
    order = orderRes.data;
    error = null;
  }

  if (error || !order) {
    notFound();
  }

  const normalizedOrder = {
    ...order,
    order_source: (order as any).order_source || 'qr',
    payment_status: (order as any).payment_status ?? null,
    external_platform_name: (order as any).external_platform_name ?? null,
    external_platform_ref: (order as any).external_platform_ref ?? null,
  };

  const currentItems = (order.order_items || []) as unknown as KitchenTicketOrderItem[];

  if (isReprint) {
    const reprintTicket = createFullReprintTicket(normalizedOrder as unknown as KitchenTicketOrder);
    return (
      <KitchenTokenPrintView
        order={reprintTicket}
        isReprint={true}
        ticketType="reprint"
      />
    );
  }

  let latestKot: any = null;
  try {
    const kotQuery = db.from?.('order_kitchen_tickets')?.select(
      'id,ticket_number,ticket_type,full_order_snapshot,created_at'
    );
    if (kotQuery) {
      const { data } = await kotQuery
        .eq('order_id', orderId)
        .order('ticket_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      latestKot = data;
    }
  } catch {
    latestKot = null;
  }

  const delta = computeKitchenTicketDelta(
    currentItems,
    latestKot?.full_order_snapshot as unknown as KitchenTicketOrderItem[] | null
  );

  // If there are no new delta items, render the full ticket as a reprint rather than throwing a 404
  if (delta.ticketType === 'none') {
    const reprintTicket = createFullReprintTicket(normalizedOrder as unknown as KitchenTicketOrder);
    return (
      <KitchenTokenPrintView
        order={reprintTicket}
        isReprint={true}
        ticketType="reprint"
      />
    );
  }

  const printOrder: KitchenTicketOrder = {
    ...(normalizedOrder as unknown as KitchenTicketOrder),
    ticket_type: delta.ticketType,
    order_items: delta.deltaItems,
  };

  return (
    <KitchenTokenPrintView
      order={printOrder}
      isReprint={false}
      ticketType={delta.ticketType}
    />
  );
}
