import { NextRequest, NextResponse } from 'next/server';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';

/**
 * Checks whether an incoming path is a legitimate session authentication operation
 * (sign in, token refresh, token verification, logout) that must remain available for staff login.
 * Directory mutations (user creation, profile modification, admin user manipulation) are not
 * treated as session operations and remain subject to the Preview write guard.
 */
function isAuthSessionOperation(subpath: string): boolean {
  const normalized = subpath.toLowerCase().split('?')[0].replace(/^\/+|\/+$/g, '');
  return (
    normalized === 'auth/v1/token' ||
    normalized === 'auth/v1/logout' ||
    normalized === 'auth/v1/verify'
  );
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params;
  const subpath = path.join('/');

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    // Only permit non-mutating session authentication operations (login, refresh, logout)
    // to bypass the write guard. All other mutations (database writes, RPC, and Auth directory
    // mutations such as signup, user update, admin operations) must enforce the Preview write guard.
    if (!isAuthSessionOperation(subpath)) {
      const previewGuard = enforcePreviewWriteGuard();
      if (previewGuard) return previewGuard;
    }
  }
  const search = req.nextUrl.search;
  const internalSupabaseUrl =
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'http://127.0.0.1:54321';
  const targetUrl = `${internalSupabaseUrl}/${subpath}${search}`;

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
