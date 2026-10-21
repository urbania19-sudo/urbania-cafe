export const AUTH_COOKIE_NAME = 'sb-urbania-auth-token';

/**
 * Returns consistent cookie configuration for @supabase/ssr across browser and server runtimes.
 * Enforces the same cookie name ('sb-urbania-auth-token') regardless of whether the incoming
 * URL hostname is '127.0.0.1', 'localhost', or a LAN IP like '192.168.1.8'.
 */
export function getAuthCookieOptions() {
  const isSecure = () => {
    if (typeof window !== 'undefined') {
      return window.location.protocol === 'https:';
    }
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
    if (siteUrl.startsWith('http://')) return false;
    return process.env.NODE_ENV === 'production';
  };

  return {
    name: AUTH_COOKIE_NAME,
    path: '/',
    sameSite: 'lax' as const,
    secure: isSecure(),
  };
}

/**
 * Ensures that if a user has legacy session cookies saved under an old dynamic name
 * (such as 'sb-192-auth-token' or 'sb-localhost-auth-token'), they are transparently aliased
 * to 'sb-urbania-auth-token' so server components and middleware can read them seamlessly.
 */
export function normalizeAuthCookies<T extends { name: string; value: string }>(cookies: T[]): T[] {
  const hasUrbania = cookies.some((c) => c.name.startsWith(AUTH_COOKIE_NAME));
  if (hasUrbania) return cookies;

  const legacy = cookies.find(
    (c) => c.name.startsWith('sb-') && c.name.includes('-auth-token')
  );
  if (!legacy) return cookies;

  const match = legacy.name.match(/^(sb-[^.]+-auth-token)/);
  if (!match) return cookies;

  const legacyPrefix = match[1];
  const aliased = cookies
    .filter((c) => c.name.startsWith(legacyPrefix))
    .map((c) => ({
      ...c,
      name: c.name.replace(legacyPrefix, AUTH_COOKIE_NAME),
    }));

  return [...cookies, ...aliased];
}

/**
 * Purges obsolete legacy cookies in browser environments to avoid cookie jar pollution.
 */
export function clearLegacyAuthCookies() {
  if (typeof document === 'undefined') return;
  const raw = document.cookie;
  if (!raw) return;

  const parts = raw.split(';');
  for (const part of parts) {
    const name = part.split('=')[0]?.trim();
    if (
      name &&
      name.startsWith('sb-') &&
      name.includes('-auth-token') &&
      !name.startsWith(AUTH_COOKIE_NAME)
    ) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; sameSite=lax`;
    }
  }
}
