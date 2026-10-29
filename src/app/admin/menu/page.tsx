import { redirect } from 'next/navigation';
import AdminNav from '@/components/admin/AdminNav';
import Link from 'next/link';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import MenuManager from '@/components/admin/MenuManager';

export const dynamic = 'force-dynamic';

export default async function AdminMenu() {
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

  const [{ data: categories }, { data: items }] = await Promise.all([
    db.from('menu_categories').select('id,name').order('sort_order'),
    db
      .from('menu_items')
      .select('id,name,price_paise,is_available,category_id,description,is_veg,image_url')
      .order('sort_order'),
  ]);

  return (
    <main className="shell" style={{ maxWidth: 960, paddingTop: 32 }}>
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
            Owner portal · Catalog & Inventory
          </p>
          <h1
            style={{
              fontFamily: 'Georgia,serif',
              fontSize: 'clamp(2.1rem,5vw,3.4rem)',
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Menu management
          </h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Add dishes, upload photos, toggle sold-out status, and manage prices.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link className="chip" href="/admin">
            ← Dashboard
          </Link>
          <LogoutButton />
        </div>
      </header>

      <AdminNav activeTab="menu" />

      <MenuManager categories={categories ?? []} items={items ?? []} />
    </main>
  );
}
