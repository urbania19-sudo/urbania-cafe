import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getAuthCookieOptions, normalizeAuthCookies } from './cookie-config';

export async function authDb() {
  const jar = await cookies();
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  return createServerClient(url, key, {
    cookieOptions: getAuthCookieOptions(),
    cookies: {
      getAll: () => normalizeAuthCookies(jar.getAll()),
      setAll: () => {},
    },
  });
}
