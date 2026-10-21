import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authDb } from '@/lib/supabase/auth-server';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';

const schema = z.object({
  status: z.enum(['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const { orderId } = await ctx.params;
  if (!z.string().uuid().safeParse(orderId).success) {
    return NextResponse.json({ error: 'Invalid order ID format' }, { status: 400 });
  }

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid status request body' }, { status: 400 });
  }

  const db = await authDb();
  const {
    data: { user },
    error: userError,
  } = await db.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized: staff login required' }, { status: 401 });
  }

  // 1. Fetch current order state to validate transition and ensure idempotency
  const { data: currentOrder, error: fetchError } = await db
    .from('orders')
    .select('id, status, order_number')
    .eq('id', orderId)
    .maybeSingle();

  if (fetchError || !currentOrder) {
    console.error(`Order lookup error for ${orderId}:`, fetchError?.message || 'Order not found');
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const targetStatus = body.data.status;

  // Idempotency: if already in the target status, return success immediately
  if (currentOrder.status === targetStatus) {
    return NextResponse.json({
      ok: true,
      status: targetStatus,
      message: `Order is already ${targetStatus.toLowerCase()}`,
    });
  }

  // Transitioning to COMPLETED:
  if (targetStatus === 'COMPLETED') {
    if (currentOrder.status === 'NEW') {
      return NextResponse.json(
        { error: `Order #${currentOrder.order_number} must be accepted before it can be marked completed.` },
        { status: 400 }
      );
    }
    if (currentOrder.status === 'CANCELLED') {
      return NextResponse.json(
        { error: `Cannot complete Order #${currentOrder.order_number} because it has been cancelled.` },
        { status: 400 }
      );
    }

    // Attempt direct transition first (supported by Migration 0011)
    const directRes = await db.rpc('update_staff_order_status', {
      p_order_id: orderId,
      p_next: 'COMPLETED',
    });

    if (!directRes.error) {
      return NextResponse.json({ ok: true, status: 'COMPLETED' });
    }

    // If direct transition failed due to legacy database transition restriction,
    // bridge through intermediate legacy states (ACCEPTED -> PREPARING -> READY -> COMPLETED)
    const directErrMsg = directRes.error.message || '';
    const isTransitionError =
      directErrMsg.toLowerCase().includes('invalid transition') ||
      directErrMsg.toLowerCase().includes('invalid order status transition');

    if (isTransitionError) {
      console.warn(
        `Direct transition to COMPLETED not supported by current DB schema; bridging legacy states for order ${orderId}`
      );

      if (currentOrder.status === 'ACCEPTED') {
        const step1 = await db.rpc('update_staff_order_status', { p_order_id: orderId, p_next: 'PREPARING' });
        if (step1.error) {
          console.error(`Bridge step PREPARING failed for order ${orderId}:`, step1.error.message);
          return NextResponse.json({ error: `Failed to transition order to Preparing: ${step1.error.message}` }, { status: 400 });
        }

        const step2 = await db.rpc('update_staff_order_status', { p_order_id: orderId, p_next: 'READY' });
        if (step2.error) {
          console.error(`Bridge step READY failed for order ${orderId}:`, step2.error.message);
          return NextResponse.json({ error: `Failed to transition order to Ready: ${step2.error.message}` }, { status: 400 });
        }

        const step3 = await db.rpc('update_staff_order_status', { p_order_id: orderId, p_next: 'COMPLETED' });
        if (step3.error) {
          console.error(`Bridge step COMPLETED failed for order ${orderId}:`, step3.error.message);
          return NextResponse.json({ error: `Failed to complete order: ${step3.error.message}` }, { status: 400 });
        }

        return NextResponse.json({ ok: true, status: 'COMPLETED' });
      }

      if (currentOrder.status === 'PREPARING') {
        const step2 = await db.rpc('update_staff_order_status', { p_order_id: orderId, p_next: 'READY' });
        if (step2.error) {
          console.error(`Bridge step READY failed for order ${orderId}:`, step2.error.message);
          return NextResponse.json({ error: `Failed to transition order to Ready: ${step2.error.message}` }, { status: 400 });
        }

        const step3 = await db.rpc('update_staff_order_status', { p_order_id: orderId, p_next: 'COMPLETED' });
        if (step3.error) {
          console.error(`Bridge step COMPLETED failed for order ${orderId}:`, step3.error.message);
          return NextResponse.json({ error: `Failed to complete order: ${step3.error.message}` }, { status: 400 });
        }

        return NextResponse.json({ ok: true, status: 'COMPLETED' });
      }

      if (currentOrder.status === 'READY') {
        const step3 = await db.rpc('update_staff_order_status', { p_order_id: orderId, p_next: 'COMPLETED' });
        if (step3.error) {
          console.error(`Step COMPLETED failed for order ${orderId}:`, step3.error.message);
          return NextResponse.json({ error: `Failed to complete order: ${step3.error.message}` }, { status: 400 });
        }
        return NextResponse.json({ ok: true, status: 'COMPLETED' });
      }
    }

    // Direct transition failed with non-transition error (e.g., unauthorized)
    console.error(`Failed to update order ${orderId} to COMPLETED:`, directErrMsg);
    return NextResponse.json({ error: directErrMsg || 'Unable to complete order' }, { status: 400 });
  }

  // Standard status transition (e.g. ACCEPTED, CANCELLED)
  const { error } = await db.rpc('update_staff_order_status', {
    p_order_id: orderId,
    p_next: targetStatus,
    p_cancel_reason: targetStatus === 'CANCELLED' ? 'Rejected by staff' : null,
  });

  if (error) {
    console.error(`Failed to update order ${orderId} status to ${targetStatus}:`, error.message);
    return NextResponse.json({ error: error.message || 'Unable to update order' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, status: targetStatus });
}
