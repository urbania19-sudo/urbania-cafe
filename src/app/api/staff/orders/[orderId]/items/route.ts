import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authDb } from '@/lib/supabase/auth-server';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';
import { friendlyBillingError } from '@/lib/billing';

const catalogueItemSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  note: z.string().max(250).optional().nullable(),
  isCustom: z.literal(false).optional(),
});

const customItemSchema = z
  .object({
    isCustom: z.literal(true),
    name: z.string().trim().min(1).max(100),
    unitPricePaise: z.number().int().nonnegative().optional(),
    unitPriceRupees: z.number().nonnegative().optional(),
    quantity: z.number().int().min(1).max(20),
    note: z.string().trim().max(250).optional().nullable(),
  })
  .refine((data) => data.unitPricePaise != null || data.unitPriceRupees != null, {
    message: 'Custom price required',
  })
  .transform((data) => ({
    isCustom: true,
    name: data.name,
    unitPricePaise: data.unitPricePaise ?? Math.round((data.unitPriceRupees ?? 0) * 100),
    quantity: data.quantity,
    note: data.note ?? undefined,
  }));

const itemSchema = z.union([catalogueItemSchema, customItemSchema]);

const schema = z.object({
  items: z.array(itemSchema).min(1).max(25),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const { orderId } = await ctx.params;
  const rawBody = await req.json().catch(() => null);
  const body = schema.safeParse(rawBody);

  if (!body.success || !z.string().uuid().safeParse(orderId).success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await db.rpc('edit_order_items', {
    p_order_id: orderId,
    p_items: body.data.items,
  });

  if (error) {
    console.error(`Error editing order items for order ${orderId}:`, error.message);
    if (
      error.message?.includes('function public.edit_order_items') ||
      error.message?.includes('does not exist')
    ) {
      return NextResponse.json(
        { error: 'Order item editing is temporarily unavailable (database function pending migration).' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: friendlyBillingError(error) }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
