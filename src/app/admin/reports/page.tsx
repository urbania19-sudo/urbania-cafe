import { redirect } from 'next/navigation';
import AdminNav from '@/components/admin/AdminNav';
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

  const { data: rawMenuItems } = await db
    .from('menu_items')
    .select('id, name, price_paise, is_available, category_id, menu_categories(name)')
    .order('name');

  const menuItems = (rawMenuItems ?? []).map((m: any) => ({
    id: m.id,
    name: m.name,
    price_paise: m.price_paise,
    is_available: m.is_available,
    category_name: m.menu_categories?.name ?? 'Other',
  }));

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

      <AdminNav activeTab="reports" />

      <ReportsManager tables={tables || []} menuItems={menuItems || []} />
    </main>
  );
}
