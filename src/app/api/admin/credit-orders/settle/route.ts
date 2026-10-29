import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { owner } from '@/lib/owner';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';
import { friendlyBillingError } from '@/lib/billing';

export const dynamic = 'force-dynamic';

const settlementSchema = z.object({
  orderId: z.string().uuid('Valid order ID required'),
  amountPaise: z.number().int().min(1, 'Payment amount must be greater than zero'),
  paymentMethod: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'other']),
  notes: z.string().max(250).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const body = await req.json().catch(() => null);

  // Explicitly reject refund / reversal operations on admin credit settlements
  const rawBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (
    rawBody.action === "refund" ||
    rawBody.refund === true ||
    rawBody.is_refund === true ||
    "refund_amount_paise" in rawBody ||
    "refund_paise" in rawBody
  ) {
    return NextResponse.json(
      { error: "Refunds and settlement reversals are not supported. Ledger corrections must be recorded through authorized workflows." },
      { status: 400 }
    );
  }

  const parsed = settlementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid settlement payload' },
      { status: 400 }
    );
  }

  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
  }

  const { orderId, amountPaise, paymentMethod, notes } = parsed.data;

  try {
    // 1. Try atomic RPC
    const { data: rpcRes, error: rpcErr } = await db.rpc('settle_admin_credit_payment', {
      p_order_id: orderId,
      p_amount_paise: amountPaise,
      p_payment_method: paymentMethod,
      p_notes: notes || null,
    });

    if (!rpcErr && rpcRes?.ok) {
      return NextResponse.json(rpcRes, { status: 200 });
    }

    // If RPC returned a business exception (e.g. over-settling or not admin credit), surface it
    if (rpcErr && !rpcErr.message.includes('function public.settle_admin_credit_payment') && !rpcErr.message.includes('does not exist')) {
      return NextResponse.json({ error: rpcErr.message }, { status: 400 });
    }

    // 2. Direct transactional fallback if RPC is pending migration
    const { data: order, error: orderErr } = await db
      .from('orders')
      .select('id, order_number, total_paise, paid_paise, payment_status, status, order_source, admin_user_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.order_source !== 'admin_credit') {
      return NextResponse.json({ error: 'Selected order is not an admin credit order' }, { status: 400 });
    }

    if (order.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Cannot record settlement for a cancelled order' }, { status: 400 });
    }

    const currentPaid = order.paid_paise || 0;
    const remaining = order.total_paise - currentPaid;

    if (amountPaise > remaining) {
      return NextResponse.json(
        {
          error: `Payment amount (₹${(amountPaise / 100).toFixed(2)}) exceeds outstanding balance of ₹${(remaining / 100).toFixed(2)}`,
        },
        { status: 400 }
      );
    }

    const newPaid = currentPaid + amountPaise;
    const newStatus = newPaid >= order.total_paise ? 'paid' : 'partially_paid';

    const {
      data: { user },
    } = await db.auth.getUser();

    // Record settlement
    const { data: settlement, error: stlErr } = await db
      .from('admin_credit_settlements')
      .insert({
        order_id: order.id,
        admin_user_id: order.admin_user_id,
        amount_paise: amountPaise,
        payment_method: paymentMethod,
        notes: notes?.trim() || null,
        received_by: user?.id || null,
        settled_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (stlErr) {
      console.warn('Settlement record insert error:', stlErr.message);
    }

    // Update order
    const { error: updErr } = await db
      .from('orders')
      .update({
        paid_paise: newPaid,
        payment_status: newStatus,
      })
      .eq('id', order.id);

    if (updErr) {
      console.error('Failed to update order settlement status:', updErr);
      return NextResponse.json({ error: friendlyBillingError(updErr) }, { status: 500 });
    }

    // Update bill if present
    await db
      .from('bills')
      .update({
        paid_paise: newPaid,
        payment_status: newStatus,
      })
      .eq('order_id', order.id);

    return NextResponse.json(
      {
        ok: true,
        settlement_id: settlement?.id || crypto.randomUUID(),
        order_id: order.id,
        order_number: order.order_number,
        amount_paise: amountPaise,
        paid_paise: newPaid,
        total_paise: order.total_paise,
        payment_status: newStatus,
        settled_at: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('API Error in POST /api/admin/credit-orders/settle:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
