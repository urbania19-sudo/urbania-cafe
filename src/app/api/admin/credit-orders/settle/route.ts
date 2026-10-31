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
      { error: "Refunds and settlement reversals are not supported or implemented." },
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
    // 1. Atomic RPC: sole write path
    const { data: rpcRes, error: rpcErr } = await db.rpc('settle_admin_credit_payment', {
      p_order_id: orderId,
      p_amount_paise: amountPaise,
      p_payment_method: paymentMethod,
      p_notes: notes || null,
    });

    if (!rpcErr && rpcRes?.ok) {
      return NextResponse.json(rpcRes, { status: 200 });
    }

    if (rpcErr) {
      const msg = rpcErr.message || '';
      const code = (rpcErr as { code?: string }).code || '';

      // 1. Fail closed with 503 if RPC is missing / unavailable (e.g. pending migration)
      const isMissingRpc =
        code === 'PGRST202' ||
        code === '42883' ||
        msg.includes('function public.settle_admin_credit_payment') ||
        (msg.includes('settle_admin_credit_payment') &&
          (msg.includes('does not exist') || msg.includes('schema cache')));

      if (isMissingRpc) {
        return NextResponse.json(
          {
            error:
              'Service Unavailable: Atomic settlement procedure is unavailable. Please ensure database migrations are applied.',
          },
          { status: 503 }
        );
      }

      // 2. Authorization failure inside RPC
      if (msg.includes('forbidden') || msg.includes('admin privileges')) {
        return NextResponse.json({ error: msg }, { status: 403 });
      }

      // 3. Order not found
      if (msg.includes('order not found') || msg.includes('URB:not_found')) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      }

      // 4. Business rule validation failures (e.g. over-settlement, non-credit, cancelled, zero amount)
      if (
        msg.includes('greater than zero') ||
        msg.includes('is not an admin credit order') ||
        msg.includes('cannot settle payment for cancelled order') ||
        msg.includes('exceeds outstanding balance')
      ) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }

      // 5. Genuine database errors
      return NextResponse.json(
        { error: friendlyBillingError(rpcErr) || msg },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: 'Unexpected settlement response' }, { status: 500 });
  } catch (err) {
    console.error('API Error in POST /api/admin/credit-orders/settle:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
