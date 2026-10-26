import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authDb } from '@/lib/supabase/auth-server';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';
import { friendlyBillingError } from '@/lib/billing';
import { computeKitchenTicketDelta, kitchenTicketItemsMatch } from '@/lib/kitchen-tickets';
import type { KitchenTicketOrderItem } from '@/lib/thermal-canvas';

export const dynamic = 'force-dynamic';

const ackSchema = z.object({
  ticketType: z.enum(['new', 'addon', 'reprint']),
  itemsSnapshot: z.array(z.any()).default([]),
  fullOrderSnapshot: z.array(z.any()).default([]),
  expectedPreviousTicketId: z.string().uuid().nullable().default(null),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const { orderId } = await ctx.params;
  if (!z.string().uuid().safeParse(orderId).success) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = ackSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid acknowledgment payload' }, { status: 400 });
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

  const { ticketType, itemsSnapshot, fullOrderSnapshot, expectedPreviousTicketId } = parsed.data;

  // Never trust a browser snapshot to decide what has been sent. Rebuild the
  // current delta from the database, and reject a card that became stale while
  // staff were viewing or printing it.
  const [orderResult, latestTicketResult] = await Promise.all([
    db
      .from('orders')
      .select('id,order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)')
      .eq('id', orderId)
      .maybeSingle(),
    db
      .from('order_kitchen_tickets')
      .select('id,full_order_snapshot')
      .eq('order_id', orderId)
      .order('ticket_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (orderResult.error || !orderResult.data) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const currentItems = (orderResult.data.order_items || []) as unknown as KitchenTicketOrderItem[];
  const latestTicket = latestTicketResult.data ?? null;
  const delta = computeKitchenTicketDelta(
    currentItems,
    latestTicket?.full_order_snapshot as unknown as KitchenTicketOrderItem[] | null
  );

  const acknowledgementIsStale =
    expectedPreviousTicketId !== (latestTicket?.id ?? null) ||
    delta.ticketType === 'none' ||
    ticketType !== delta.ticketType ||
    !kitchenTicketItemsMatch(itemsSnapshot as KitchenTicketOrderItem[], delta.deltaItems) ||
    !kitchenTicketItemsMatch(fullOrderSnapshot as KitchenTicketOrderItem[], currentItems);

  if (acknowledgementIsStale) {
    return NextResponse.json(
      { error: 'This kitchen ticket changed. Refresh the order, print the current ticket, then mark it sent.' },
      { status: 409 }
    );
  }

  // The migration's RPC rechecks the expected previous ticket while holding the
  // order lock, so simultaneous staff actions cannot both acknowledge a ticket.
  const { data: rpcTicket, error: rpcError } = await db.rpc('acknowledge_kitchen_ticket', {
    p_order_id: orderId,
    p_ticket_type: delta.ticketType,
    p_items_snapshot: delta.deltaItems,
    p_full_order_snapshot: currentItems,
    p_expected_previous_ticket_id: expectedPreviousTicketId,
  });

  if (!rpcError && rpcTicket) {
    return NextResponse.json({
      ok: true,
      ticket: rpcTicket,
      message: 'Kitchen ticket marked as sent successfully.',
    });
  }

  console.error('Error acknowledging kitchen ticket:', rpcError?.message);
  return NextResponse.json(
    { error: rpcError ? friendlyBillingError(rpcError) : 'Failed to record ticket acknowledgment' },
    { status: rpcError?.message?.includes('changed') ? 409 : 400 }
  );
}
