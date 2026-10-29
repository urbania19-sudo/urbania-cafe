import { redirect } from 'next/navigation';
import AdminNav from '@/components/admin/AdminNav';
import Link from 'next/link';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import AdminCreditLedger from '@/components/admin/AdminCreditLedger';

export const dynamic = 'force-dynamic';

export default async function AdminCreditOrdersPage() {
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

  // Pre-load active menu items for dish selection
  const { data: menuItems } = await db
    .from('menu_items')
    .select('id, name, price_paise, is_available')
    .eq('is_available', true)
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
            Owner portal · Internal Accounting
          </p>
          <h1
            style={{
              fontFamily: 'Georgia,serif',
              fontSize: 'clamp(2.1rem,5vw,3.2rem)',
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Admin Credit &amp; Settlements
          </h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Manage internal administrator consumption, outstanding tabs, and payment settlements.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link className="chip" href="/admin">
            ← Dashboard
          </Link>
          <LogoutButton />
        </div>
      </header>

      <AdminNav activeTab="credit-orders" />

      <AdminCreditLedger menuItems={menuItems || []} />
    </main>
  );
}
