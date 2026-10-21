import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { owner } from '@/lib/owner';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';

const schema = z.object({ name: z.string().trim().min(2).max(60) });

export async function POST(req: NextRequest) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const data = schema.safeParse(await req.json().catch(() => null));
  const db = await owner();
  if (!db || !data.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { data: last } = await db
    .from('menu_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const slug =
    data.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'category';
  const { error } = await db
    .from('menu_categories')
    .insert({ name: data.data.name, slug, sort_order: (last?.sort_order ?? 0) + 1 });
  return error
    ? NextResponse.json({ error: 'Could not add category (name may already exist)' }, { status: 400 })
    : NextResponse.json({ ok: true }, { status: 201 });
}
