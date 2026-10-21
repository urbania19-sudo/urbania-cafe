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
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const db = await authDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await db.rpc('update_staff_order_status', {
    p_order_id: orderId,
    p_next: body.data.status,
    p_cancel_reason: body.data.status === 'CANCELLED' ? 'Rejected by staff' : null,
  });
  return error ? NextResponse.json({ error: 'Unable to update order' }, { status: 403 }) : NextResponse.json({ ok: true });
}
