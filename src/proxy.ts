import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthCookieOptions, normalizeAuthCookies } from './lib/supabase/cookie-config';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const db = createServerClient(url, key, {
    cookieOptions: getAuthCookieOptions(),
    cookies: {
      getAll: () => normalizeAuthCookies(request.cookies.getAll()),
      setAll(cookies) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  await db.auth.getUser();
  return response;
}

export const config = { matcher: ['/admin/:path*', '/staff/:path*'] };
