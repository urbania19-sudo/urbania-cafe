import { redirect } from 'next/navigation';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import OrderBoard from '@/components/staff/OrderBoard';

export const dynamic = 'force-dynamic';

export default async function Staff() {
  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/staff/login');
  const { data: profile } = await db
    .from('admin_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile) redirect('/staff/login');

  let orders: any[] = [];
  let error: unknown = null;

  // Attempt query with billed_at; if column not yet applied via migration, fall back gracefully
  const [activeRes, completedRes] = await Promise.all([
    db
      .from('orders')
      .select(
        'id,order_number,status,customer_name,guest_count,total_paise,created_at,billed_at,cafe_tables(label),order_items(menu_item_id,item_name_snapshot,quantity)'
      )
      .in('status', ['NEW', 'ACCEPTED', 'PREPARING', 'READY'])
      .order('created_at'),
    db
      .from('orders')
      .select(
        'id,order_number,status,customer_name,guest_count,total_paise,created_at,billed_at,cafe_tables(label),order_items(menu_item_id,item_name_snapshot,quantity)'
      )
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false })
      .limit(15),
  ]);

  if (activeRes.error || completedRes.error) {
    const [fallbackActive, fallbackCompleted] = await Promise.all([
      db
        .from('orders')
        .select(
          'id,order_number,status,customer_name,guest_count,total_paise,created_at,cafe_tables(label),order_items(menu_item_id,item_name_snapshot,quantity)'
        )
        .in('status', ['NEW', 'ACCEPTED', 'PREPARING', 'READY'])
        .order('created_at'),
      db
        .from('orders')
        .select(
          'id,order_number,status,customer_name,guest_count,total_paise,created_at,cafe_tables(label),order_items(menu_item_id,item_name_snapshot,quantity)'
        )
        .eq('status', 'COMPLETED')
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    const activeList = fallbackActive.data ?? [];
    const completedList = fallbackCompleted.data ?? [];
    const combined = [...activeList, ...completedList];
    const seen = new Set<string>();
    orders = combined.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
    error = fallbackActive.error;
  } else {
    const activeList = activeRes.data ?? [];
    const completedList = completedRes.data ?? [];
    const combined = [...activeList, ...completedList];
    const seen = new Set<string>();
    orders = combined.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
  }

  const { data: menu } = await db
    .from('menu_items')
    .select('id,name,price_paise,is_available')
    .order('name');

  const { data: tables } = await db
    .from('cafe_tables')
    .select('id,table_number,label')
    .eq('is_active', true)
    .order('table_number');

  const activeCount = orders.filter((o) => o.status !== 'COMPLETED').length;

  return (
    <main className="shell" style={{ maxWidth: 1060, paddingTop: 32 }}>
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
            Staff portal · live queue
          </p>
          <h1
            style={{
              fontFamily: 'Georgia,serif',
              fontSize: 'clamp(2.1rem,5vw,3.4rem)',
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Live Order Queue
          </h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            New table and takeaway orders arrive here automatically.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="chip" style={{ color: 'var(--accent)' }}>
            {activeCount} active
          </span>
          <LogoutButton to="/staff/login" />
        </div>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))',
          gap: 10,
          padding: '18px 0',
        }}
      >
        {[
          ['1', 'Order Placed', 'Accept incoming order'],
          ['2', 'Accepted', 'Prepare & fulfill order'],
          ['3', 'Completed', 'Mark done & View Image'],
        ].map(([n, label, info]) => (
          <div className="card" style={{ padding: 14 }} key={n}>
            <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 800 }}>
              STEP {n}
            </span>
            <b style={{ display: 'block', margin: '7px 0 4px' }}>{label}</b>
            <small className="muted">{info}</small>
          </div>
        ))}
      </section>

      {error ? (
        <section
          className="card"
          role="alert"
          style={{ padding: 18, borderLeft: '3px solid #df6d5d' }}
        >
          <b>Orders could not be loaded.</b>
          <p className="muted" style={{ marginBottom: 0 }}>
            Refresh once. If this continues after deployment, run the pending Supabase database
            migration.
          </p>
        </section>
      ) : (
        <OrderBoard initial={orders} menu={menu ?? []} tables={tables ?? []} />
      )}
    </main>
  );
}
