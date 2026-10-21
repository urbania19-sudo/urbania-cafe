import { NextRequest, NextResponse } from 'next/server';
import { orderSchema } from '@/lib/validation/order';
import { adminDb } from '@/lib/supabase/server';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';

export async function POST(request: NextRequest) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const body = await request.json().catch(() => null);
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid order request' }, { status: 400 });
  try {
    const { data, error } = await adminDb().rpc('place_public_order', { p_payload: parsed.data });
    if (error) return NextResponse.json({ error: 'Unable to place order' }, { status: 400 });
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Order service is unavailable. Please ask staff for help.' }, { status: 503 });
  }
}
