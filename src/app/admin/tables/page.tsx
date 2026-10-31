import { redirect } from 'next/navigation';
import AdminNav from '@/components/admin/AdminNav';
import Link from 'next/link';
import { authDb } from '@/lib/supabase/auth-server';
import { tableUrl } from '@/lib/qr';
import LogoutButton from '@/components/auth/LogoutButton';
import { isPreviewDemoMode } from '@/lib/preview-demo';
import PreviewDemoBanner from '@/components/demo/PreviewDemoBanner';
import { DEMO_TABLES } from '@/lib/demo-fixtures';

export const dynamic = 'force-dynamic';

export default async function Tables() {
  const isDemo = isPreviewDemoMode();

  let tables: { id: string; label: string; qr_token: string; is_active: boolean }[] = [];

  if (isDemo) {
    tables = DEMO_TABLES;
  } else {
    const db = await authDb();
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

    const { data: dbTables } = await db
      .from('cafe_tables')
      .select('id,label,qr_token,is_active')
      .order('table_number');

    tables = dbTables ?? [];
  }

  return (
    <>
      {isDemo && <PreviewDemoBanner />}
      <main className="shell" style={{ maxWidth: 960, paddingTop: 32 }}>
        <header
          className="page-header"
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
              Owner portal · Tables & QR Codes
            </p>
            <h1
              style={{
                fontFamily: 'Georgia,serif',
                fontSize: 'clamp(2.1rem,5vw,3.4rem)',
                margin: 0,
                lineHeight: 0.95,
              }}
            >
              Table QR codes
            </h1>
            <p className="muted" style={{ marginBottom: 0 }}>
              Test every link after deployment and before printing. Token rotation must be implemented through a confirmed, authenticated update.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link className="chip" href="/admin">
              ← Dashboard
            </Link>
            {!isDemo && <LogoutButton />}
          </div>
        </header>

        <AdminNav activeTab="tables" />

        <section style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {tables.map((t) => (
            <article className="card table-qr-card" style={{ padding: 16 }} key={t.id}>
              <b>{t.label}</b>
              <p className="muted" style={{ margin: '4px 0 12px' }}>
                {t.is_active ? 'Active' : 'Disabled'}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a className="btn" href={tableUrl(t.qr_token)}>
                  Preview menu
                </a>
                <a className="chip" href={`/api/admin/qr/${t.qr_token}`}>
                  Download SVG
                </a>
              </div>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
