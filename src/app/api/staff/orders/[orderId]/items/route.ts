import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authDb } from '@/lib/supabase/auth-server';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';

const schema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
      })
    )
    .min(1)
    .max(25),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const { orderId } = await ctx.params;
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success || !z.string().uuid().safeParse(orderId).success)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
