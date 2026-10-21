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

  let orders: never[] = [];
  let error: unknown = null;

  // Attempt query with billed_at; if column not yet applied via migration, fall back gracefully
  const resWithBilled = await db
    .from('orders')
    .select(
      'id,order_number,status,customer_name,guest_count,total_paise,created_at,billed_at,cafe_tables(label),order_items(menu_item_id,item_name_snapshot,quantity)'
    )
    .in('status', ['NEW', 'ACCEPTED', 'PREPARING', 'READY'])
    .order('created_at');

  if (resWithBilled.error) {
    const fallbackRes = await db
      .from('orders')
      .select(
        'id,order_number,status,customer_name,guest_count,total_paise,created_at,cafe_tables(label),order_items(menu_item_id,item_name_snapshot,quantity)'
      )
      .in('status', ['NEW', 'ACCEPTED', 'PREPARING', 'READY'])
      .order('created_at');
    orders = (fallbackRes.data ?? []) as never[];
    error = fallbackRes.error;
  } else {
    orders = (resWithBilled.data ?? []) as never[];
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
            Orders to prepare
          </h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            New table orders arrive here automatically.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="chip" style={{ color: 'var(--accent)' }}>
            {orders.length} active
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
          ['1', 'New', 'Accept incoming order'],
          ['2', 'Preparing', 'Start making it'],
          ['3', 'Ready', 'Take it to the table'],
          ['4', 'Completed', 'Close the ticket & bill'],
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
