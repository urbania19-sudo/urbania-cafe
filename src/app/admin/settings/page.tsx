import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import SettingsForm from '@/components/admin/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  let db;
  try {
    db = await authDb();
  } catch {
    return (
      <main className="shell">
        <h1>Admin unavailable</h1>
        <p>Configure Supabase to access settings.</p>
      </main>
    );
  }

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/admin/login');

  const { data: profile } = await db
    .from('admin_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || profile.role === 'staff') redirect('/admin/login');

  const { data: settings } = await db.from('cafe_settings').select('*').limit(1).maybeSingle();

  return (
    <main className="shell" style={{ maxWidth: 860, paddingTop: 32 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 20,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          paddingBottom: 24,
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div>
          <p
            style={{
              color: 'var(--accent)',
              fontSize: 12,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              margin: '0 0 8px',
            }}
          >
            Owner portal · Compliance & Identity
          </p>
          <h1
            style={{
              fontFamily: 'Georgia,serif',
              fontSize: 'clamp(2.1rem,5vw,3.4rem)',
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Business & FSSAI Settings
          </h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Configure legal entity details, FSSAI licence compliance, and thermal receipt headers.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link className="chip" href="/admin">
            ← Dashboard
          </Link>
          <LogoutButton />
        </div>
      </header>

      <nav className="admin-nav" aria-label="Owner navigation">
        <Link className="chip" href="/admin">
          Today’s service
        </Link>
        <Link className="chip" href="/admin/menu">
          Menu & prices
        </Link>
        <Link className="chip" href="/admin/tables">
          Table QR codes
        </Link>
        <Link className="chip" href="/admin/settings" style={{ background: 'var(--accent)', color: '#2b1b16', fontWeight: 700 }}>
          Settings & FSSAI
        </Link>
        <Link className="chip" href="/admin/reports">
          Audit & reports
        </Link>
      </nav>

      <SettingsForm initial={settings || null} />
    </main>
  );
}
