import { NextRequest, NextResponse } from 'next/server';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';

const INTERNAL_SUPABASE_URL =
  process.env.SUPABASE_INTERNAL_URL || 'http://127.0.0.1:54321';

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params;
  const subpath = path.join('/');

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    if (!subpath.startsWith('auth/v1')) {
      const previewGuard = enforcePreviewWriteGuard();
      if (previewGuard) return previewGuard;
    }
  }
  const search = req.nextUrl.search;
  const targetUrl = `${INTERNAL_SUPABASE_URL}/${subpath}${search}`;

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('connection');

  const body =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.arrayBuffer()
      : undefined;

  try {
    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`Error forwarding request to ${targetUrl}:`, err);
    return NextResponse.json(
      { error: 'Supabase backend service unreachable.' },
      { status: 502 }
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
