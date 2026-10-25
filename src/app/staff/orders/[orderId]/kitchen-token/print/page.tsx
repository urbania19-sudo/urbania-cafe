import { redirect, notFound } from 'next/navigation';
import { authDb } from '@/lib/supabase/auth-server';
import KitchenTokenPrintView from '@/components/kitchen/KitchenTokenPrintView';
import { SAMPLE_KITCHEN_ORDER, type KitchenTicketOrder } from '@/lib/thermal-canvas';

export const dynamic = 'force-dynamic';

export default async function KitchenTokenPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ reprint?: string }>;
}) {
  const { orderId } = await params;
  const { reprint } = await searchParams;
  const isReprint = reprint === 'true';

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

  const { data: order, error } = await db
    .from('orders')
    .select(
      'id,order_number,status,customer_name,customer_note,guest_count,total_paise,created_at,billed_at,service_mode,order_source,cafe_tables(label),order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)'
    )
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    notFound();
  }

  return <KitchenTokenPrintView order={order as unknown as KitchenTicketOrder} isReprint={isReprint} />;
}
