import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import ReportsManager from '@/components/admin/ReportsManager';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
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

  if (!profile || profile.role === 'staff') {
    redirect('/admin/login');
  }

  // Pre-load active tables & available menu items for manual custom orders
  const { data: tables } = await db
    .from('cafe_tables')
    .select('id, table_number, label')
    .eq('is_active', true)
    .order('table_number');

  const { data: menuItems } = await db
    .from('menu_items')
    .select('id, name, price_paise, is_available')
    .order('name');

  return (
    <main className="shell" style={{ maxWidth: 1060, paddingTop: 32 }}>
      <header
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 20,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          paddingBottom: 20,
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
            Owner portal · {profile.role}
          </p>
          <h1
            style={{
              fontFamily: 'Georgia,serif',
              fontSize: 'clamp(2.1rem,5vw,3.2rem)',
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Audit &amp; Reports
          </h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Comprehensive billing ledger, sales summaries, and CSV data exports.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link className="chip" href="/admin">
            ← Dashboard
          </Link>
          <LogoutButton />
        </div>
      </header>

      <nav
        className="admin-nav"
        aria-label="Owner navigation"
      >
        <Link className="chip" href="/admin">
          Today’s service
        </Link>
        <Link className="chip" href="/admin/menu">
          Menu &amp; prices
        </Link>
        <Link className="chip" href="/admin/tables">
          Table QR codes
        </Link>
        <Link className="chip" href="/admin/settings">
          Settings &amp; FSSAI
        </Link>
        <Link
          className="chip"
          href="/admin/reports"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 700 }}
        >
          Audit &amp; Reports
        </Link>
        <Link className="chip" href="/staff">
          Open staff queue
        </Link>
      </nav>

      <ReportsManager tables={tables || []} menuItems={menuItems || []} />
    </main>
  );
}
