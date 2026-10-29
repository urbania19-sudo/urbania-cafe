import { redirect } from 'next/navigation';
import AdminNav from '@/components/admin/AdminNav';
import Link from 'next/link';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import SettingsForm from '@/components/admin/SettingsForm';
import { isPreviewDemoMode } from '@/lib/preview-demo';
import PreviewDemoBanner from '@/components/demo/PreviewDemoBanner';
import { DEMO_CAFE_SETTINGS } from '@/lib/demo-fixtures';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const isDemo = isPreviewDemoMode();

  let settings: any = null;

  if (isDemo) {
    settings = DEMO_CAFE_SETTINGS;
  } else {
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

    const { data: dbSettings } = await db.from('cafe_settings').select('*').limit(1).maybeSingle();
    settings = dbSettings;
  }

  return (
    <>
      {isDemo && <PreviewDemoBanner />}
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
            {!isDemo && <LogoutButton />}
          </div>
        </header>

        <AdminNav activeTab="settings" />

        <SettingsForm initial={settings || null} />
      </main>
    </>
  );
}
