'use client';

import { useState } from 'react';
import Image from 'next/image';
import { browserDb } from '@/lib/supabase/browser';
import { clearLegacyAuthCookies } from '@/lib/supabase/cookie-config';

export default function LoginForm({ portal }: { portal: 'owner' | 'staff' }) {
  const staff = portal === 'staff';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      const db = browserDb();
      const { data, error: authError } = await db.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError('Email or password is incorrect.');
        return;
      }

      if (!data.user) {
        setError('Sign in failed. Please try again.');
        return;
      }

      // Check role assignment in admin_profiles
      const { data: profile, error: profileErr } = await db
        .from('admin_profiles')
        .select('role')
        .eq('user_id', data.user.id)
        .maybeSingle();

      if (profileErr) {
        console.error('Error fetching admin profile:', profileErr);
      }

      if (!profile) {
        await db.auth.signOut();
        clearLegacyAuthCookies();
        setError('This account does not have café access permissions. Please ask an administrator.');
        return;
      }

      if (portal === 'owner' && profile.role === 'staff') {
        await db.auth.signOut();
        clearLegacyAuthCookies();
        setError('This is a staff account. Please sign in via the Staff Portal.');
        return;
      }

      // Clear any legacy auth cookies so only canonical cookies remain
      clearLegacyAuthCookies();

      // Perform a full window navigation so server components receive newly established session cookies
      const target = staff ? '/staff' : '/admin';
      window.location.assign(target);
    } catch (err) {
      console.error('Sign-in error:', err);
      setError('Could not connect to the sign-in service. Please ensure the server is reachable.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <div style={{ width: 'min(100%,960px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24, alignItems: 'stretch' }}>
        <section style={{ padding: 'clamp(16px,4vw,48px)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Image src="/urbania-logo.png" alt="Urbania Café" width={64} height={64} priority style={{ width: 64, height: 64, objectFit: 'contain' }} />
          <p style={{ color: 'var(--accent)', fontSize: 12, letterSpacing: '.18em', textTransform: 'uppercase', margin: '26px 0 8px' }}>
            Café operations
          </p>
          <h1 style={{ fontFamily: 'Georgia,serif', fontSize: 'clamp(2.5rem,6vw,4.5rem)', lineHeight: 0.95, margin: 0 }}>
            {staff ? 'Staff' : 'Owner'}
            <br />
            <em style={{ color: 'var(--accent)' }}>portal.</em>
          </h1>
          <p className="muted" style={{ maxWidth: 330, lineHeight: 1.6, marginTop: 20 }}>
            {staff
              ? 'See incoming table orders and move them from new to completed.'
              : 'Manage today’s menu, prices, QR table cards, and staff access from one secure place.'}
          </p>
        </section>

        <section className="card" style={{ padding: 'clamp(22px,4vw,40px)', alignSelf: 'center' }}>
          <p style={{ color: 'var(--accent)', fontSize: 12, letterSpacing: '.15em', textTransform: 'uppercase', margin: '0 0 8px' }}>
            Secure access
          </p>
          <h2 style={{ fontFamily: 'Georgia,serif', fontSize: '2rem', margin: '0 0 8px' }}>Sign in</h2>
          <p className="muted" style={{ margin: '0 0 26px' }}>
            {staff ? 'Staff accounts only.' : 'Owner and administrator accounts only.'}
          </p>
          <form onSubmit={submit} style={{ display: 'grid', gap: 18 }}>
            <label style={{ display: 'grid', gap: 7, fontWeight: 700, fontSize: 14 }}>
              Email address
              <input
                required
                autoComplete="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@cafe.com"
                style={{
                  padding: '13px 14px',
                  minHeight: 48,
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: '#0002',
                  color: 'var(--ink)',
                  width: '100%',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 7, fontWeight: 700, fontSize: 14 }}>
              Password
              <input
                required
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                style={{
                  padding: '13px 14px',
                  minHeight: 48,
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: '#0002',
                  color: 'var(--ink)',
                  width: '100%',
                }}
              />
            </label>
            {error && (
              <p role="alert" style={{ margin: 0, padding: 12, borderLeft: '3px solid #df6d5d', background: '#df6d5d20' }}>
                {error}
              </p>
            )}
            <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 4 }}>
              {busy ? 'Signing in…' : 'Sign in securely'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
