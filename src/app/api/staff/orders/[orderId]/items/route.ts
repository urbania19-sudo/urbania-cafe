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
  return error
    ? NextResponse.json({ error: error.message }, { status: 400 })
    : NextResponse.json({ ok: true });
}
