import { redirect } from 'next/navigation';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import OrderBoard from '@/components/staff/OrderBoard';
import { isPreviewDemoMode } from '@/lib/preview-demo';
import PreviewDemoBanner from '@/components/demo/PreviewDemoBanner';
import {
  DEMO_STAFF_ORDERS,
  DEMO_STAFF_MENU,
  DEMO_TABLE_OPTIONS,
  DEMO_INITIAL_KOTS,
} from '@/lib/demo-fixtures';

export const dynamic = 'force-dynamic';

export default async function Staff() {
  const isDemo = isPreviewDemoMode();

  let orders: any[] = [];
  let menu: any[] = [];
  let tables: any[] = [];
  let initialKots: Record<string, any> = {};
  let error: unknown = null;

  if (isDemo) {
    orders = DEMO_STAFF_ORDERS;
    menu = DEMO_STAFF_MENU;
    tables = DEMO_TABLE_OPTIONS;
    initialKots = DEMO_INITIAL_KOTS;
  } else {
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

    // Attempt query with billed_at and full order items; if columns not yet applied via migration, fall back gracefully
    const [activeRes, completedRes] = await Promise.all([
      db
        .from('orders')
        .select(
          'id,order_number,status,customer_name,customer_note,guest_count,total_paise,created_at,billed_at,service_mode,order_source,payment_status,payment_method,paid_paise,external_platform_name,external_platform_ref,cafe_tables(label),order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)'
        )
        .in('status', ['NEW', 'ACCEPTED', 'PREPARING', 'READY'])
        .order('created_at'),
      db
        .from('orders')
        .select(
          'id,order_number,status,customer_name,customer_note,guest_count,total_paise,created_at,billed_at,service_mode,order_source,payment_status,payment_method,paid_paise,external_platform_name,external_platform_ref,cafe_tables(label),order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)'
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
            'id,order_number,status,customer_name,customer_note,guest_count,total_paise,created_at,billed_at,service_mode,order_source,cafe_tables(label),order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)'
          )
          .in('status', ['NEW', 'ACCEPTED', 'PREPARING', 'READY'])
          .order('created_at'),
        db
          .from('orders')
          .select(
            'id,order_number,status,customer_name,customer_note,guest_count,total_paise,created_at,billed_at,service_mode,order_source,cafe_tables(label),order_items(id,menu_item_id,item_name_snapshot,quantity,unit_price_paise,item_note,is_custom,selected_options_snapshot)'
          )
          .eq('status', 'COMPLETED')
          .order('created_at', { ascending: false })
          .limit(15),
      ]);

      const activeList = fallbackActive.data ?? [];
      const completedList = fallbackCompleted.data ?? [];
      const combined = [...activeList, ...completedList];
      const seen = new Set<string>();
      orders = combined
        .filter((o: any) => {
          if (seen.has(o.id)) return false;
          seen.add(o.id);
          return true;
        })
        .map((o: any) => ({
          ...o,
          order_source: o.order_source || 'qr',
          service_mode: o.service_mode || 'dine_in',
          payment_status: o.payment_status ?? (o.billed_at ? 'paid' : 'unpaid'),
          payment_method: o.payment_method ?? null,
          paid_paise: typeof o.paid_paise === 'number' ? o.paid_paise : (o.billed_at ? o.total_paise : 0),
          external_platform_name: o.external_platform_name ?? null,
          external_platform_ref: o.external_platform_ref ?? null,
        }));
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

    const [{ data: menuData }, { data: dbTables }, { data: kotData }] = await Promise.all([
      db
        .from('menu_items')
        .select('id,name,price_paise,is_available,category_id,menu_categories(id,name,is_active,sort_order)')
        .order('name'),
      db
        .from('cafe_tables')
        .select('id,table_number,label')
        .eq('is_active', true)
        .order('table_number'),
      db
        .from('order_kitchen_tickets')
        .select('id,order_id,ticket_number,ticket_type,full_order_snapshot,created_at')
        .order('ticket_number', { ascending: false }),
    ]);

    tables = dbTables ?? [];

    menu = (menuData ?? [])
      .filter((m: any) => m.is_available && (m.menu_categories ? m.menu_categories.is_active : true))
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        price_paise: m.price_paise,
        is_available: m.is_available,
        category_id: m.category_id ?? null,
        category_name: m.menu_categories?.name ?? 'Other',
        category_sort_order: m.menu_categories?.sort_order ?? 999,
      }));

    for (const kot of (kotData ?? [])) {
      if (!initialKots[kot.order_id]) {
        initialKots[kot.order_id] = kot;
      }
    }
  }

  const activeCount = orders.filter((o) => o.status !== 'COMPLETED').length;

  return (
    <>
      {isDemo && <PreviewDemoBanner />}
      <main className="shell" style={{ maxWidth: 1060, paddingTop: 32 }}>
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
            {!isDemo && <LogoutButton to="/staff/login" />}
          </div>
        </header>

        <section
          className="workflow-strip"
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
            <div className="card workflow-step" style={{ padding: 14 }} key={n}>
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
            className="card alert-card"
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
          <OrderBoard initial={orders} menu={menu} tables={tables} initialKots={initialKots} />
        )}
      </main>
    </>
  );
}
