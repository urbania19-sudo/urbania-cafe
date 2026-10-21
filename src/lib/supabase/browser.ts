'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getAuthCookieOptions } from './cookie-config';

export function browserDb() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');

  // In the browser, if accessing a local development instance (loopback, LAN IP, or non-https),
  // route through same-origin Next.js reverse proxy (/api/supabase) so mobile devices on LAN
  // do not fail due to Windows Defender Firewall blocking port 54321, router isolation,
  // or mobile browser cross-origin private network restrictions.
  if (typeof window !== 'undefined') {
    const isLocal =
      url.includes('127.0.0.1') ||
      url.includes('localhost') ||
      url.includes('192.168.') ||
      url.startsWith('/');
    if (isLocal) {
      url = `${window.location.origin}/api/supabase`;
    }
  }

  return createBrowserClient(url, key, {
    cookieOptions: getAuthCookieOptions(),
  });
}
