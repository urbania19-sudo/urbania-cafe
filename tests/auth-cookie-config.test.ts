// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBrowserClient, createServerClient } from '@supabase/ssr';
import {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  normalizeAuthCookies,
  clearLegacyAuthCookies,
} from '@/lib/supabase/cookie-config';

describe('Auth Cookie Configuration & Normalization', () => {
  const FAKE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake';

  it('defines a consistent cookie name across environments', () => {
    expect(AUTH_COOKIE_NAME).toBe('sb-urbania-auth-token');
  });

  it('provides uniform cookie options for browser and server runtimes', () => {
    const opts = getAuthCookieOptions();
    expect(opts.name).toBe('sb-urbania-auth-token');
    expect(opts.path).toBe('/');
    expect(opts.sameSite).toBe('lax');
  });

  it('guarantees identical storageKey for browser and server across different host URLs', () => {
    const browserClientLan = createBrowserClient('http://192.168.1.8:54321', FAKE_KEY, {
      cookieOptions: getAuthCookieOptions(),
    });
    const browserClientLocalhost = createBrowserClient('http://localhost:54321', FAKE_KEY, {
      cookieOptions: getAuthCookieOptions(),
    });
    const serverClientLoopback = createServerClient('http://127.0.0.1:54321', FAKE_KEY, {
      cookieOptions: getAuthCookieOptions(),
      cookies: { getAll: () => [], setAll: () => {} },
    });

    const getKey = (client: { auth: unknown }) =>
      (client.auth as { storageKey: string }).storageKey;

    expect(getKey(browserClientLan)).toBe('sb-urbania-auth-token');
    expect(getKey(browserClientLocalhost)).toBe('sb-urbania-auth-token');
    expect(getKey(serverClientLoopback)).toBe('sb-urbania-auth-token');
    expect(getKey(browserClientLan)).toBe(getKey(serverClientLoopback));
  });

  it('preserves cookie list when canonical sb-urbania-auth-token already exists', () => {
    const input = [
      { name: 'sb-urbania-auth-token', value: 'session-payload' },
      { name: 'sb-192-auth-token', value: 'stale-payload' },
    ];
    const result = normalizeAuthCookies(input);
    expect(result).toEqual(input);
  });

  it('aliases legacy sb-192-auth-token when canonical cookie is absent', () => {
    const input = [
      { name: 'sb-192-auth-token', value: 'session-payload' },
      { name: 'cafe-theme', value: 'dark' },
    ];
    const result = normalizeAuthCookies(input);
    expect(result).toEqual([
      { name: 'sb-192-auth-token', value: 'session-payload' },
      { name: 'cafe-theme', value: 'dark' },
      { name: 'sb-urbania-auth-token', value: 'session-payload' },
    ]);
  });

  it('aliases chunked legacy cookies (e.g. sb-192-auth-token.0, sb-192-auth-token.1)', () => {
    const input = [
      { name: 'sb-192-auth-token.0', value: 'chunk0' },
      { name: 'sb-192-auth-token.1', value: 'chunk1' },
      { name: 'other', value: '123' },
    ];
    const result = normalizeAuthCookies(input);
    expect(result).toContainEqual({ name: 'sb-urbania-auth-token.0', value: 'chunk0' });
    expect(result).toContainEqual({ name: 'sb-urbania-auth-token.1', value: 'chunk1' });
    expect(result).toHaveLength(5);
  });

  it('aliases legacy localhost and loopback cookie names', () => {
    const inputLocalhost = [{ name: 'sb-localhost-auth-token', value: 'token-localhost' }];
    const resultLocalhost = normalizeAuthCookies(inputLocalhost);
    expect(resultLocalhost).toContainEqual({
      name: 'sb-urbania-auth-token',
      value: 'token-localhost',
    });

    const input127 = [{ name: 'sb-127-auth-token', value: 'token-127' }];
    const result127 = normalizeAuthCookies(input127);
    expect(result127).toContainEqual({
      name: 'sb-urbania-auth-token',
      value: 'token-127',
    });
  });

  it('leaves cookies untouched when no auth tokens are present', () => {
    const input = [{ name: 'session_id', value: 'xyz' }];
    expect(normalizeAuthCookies(input)).toEqual(input);
  });

  it('clearLegacyAuthCookies removes legacy auth cookies but preserves canonical cookie and other cookies', () => {
    document.cookie = 'sb-192-auth-token=legacy123; path=/';
    document.cookie = 'sb-localhost-auth-token=legacyLocal; path=/';
    document.cookie = 'sb-urbania-auth-token=canonicalToken; path=/';
    document.cookie = 'user-pref=blue; path=/';

    clearLegacyAuthCookies();

    // In jsdom document.cookie retains whatever wasn't expired
    expect(document.cookie).toContain('sb-urbania-auth-token=canonicalToken');
    expect(document.cookie).toContain('user-pref=blue');
    expect(document.cookie).not.toContain('sb-192-auth-token');
    expect(document.cookie).not.toContain('sb-localhost-auth-token');
  });
});
