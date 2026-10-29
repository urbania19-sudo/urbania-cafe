import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import AdminNav from '@/components/admin/AdminNav';
import { getDailyServiceMetrics, getTimezoneDateBounds } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export default async function Admin() {
  let db;
  try {
    db = await authDb();
  } catch {
    return (
      <main className="shell">
        <h1>Admin unavailable</h1>
        <p>Configure Supabase to enable the owner dashboard.</p>
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

  // Unified business-day reporting using cafe timezone
  const dailyMetrics = await getDailyServiceMetrics(db);
  const { startUtcIso, endUtcIso } = getTimezoneDateBounds(dailyMetrics.date, dailyMetrics.timezone);

  const { data: orders } = await db
    .from('orders')
    .select(
      'id,order_number,status,total_paise,created_at,customer_name,guest_count,order_source,payment_status,external_platform_name,external_platform_ref,cafe_tables(label),order_items(item_name_snapshot,quantity)'
    )
    .gte('created_at', startUtcIso)
    .lte('created_at', endUtcIso)
    .order('created_at', { ascending: false });

  const rows = orders ?? [];

  const metrics: [string, string | number, string][] = [
    ["Today's orders", dailyMetrics.orderCount, `${dailyMetrics.completedOrderCount} completed · ${dailyMetrics.activeOrderCount} in service`],
    ['Active in kitchen', dailyMetrics.activeOrderCount, 'NEW, ACCEPTED, PREPARING, READY'],
    ['Customer sales (Net)', `₹${(dailyMetrics.netSalesPaise / 100).toFixed(2)}`, `Gross: ₹${(dailyMetrics.grossSalesPaise / 100).toFixed(2)} · Disc: ₹${(dailyMetrics.discountsPaise / 100).toFixed(2)}`],
    ['Actual collections', `₹${(dailyMetrics.collectedPaise / 100).toFixed(2)}`, `Cash: ₹${(dailyMetrics.cashCollectedPaise / 100).toFixed(2)} · Online/UPI: ₹${(dailyMetrics.onlineCollectedPaise / 100).toFixed(2)} · Unclassified: ₹${(dailyMetrics.unclassifiedCollectedPaise / 100).toFixed(2)}`],
  ];

  if (dailyMetrics.customerOutstandingPaise > 0) {
    metrics.push([
      'Customer balance due',
      `₹${(dailyMetrics.customerOutstandingPaise / 100).toFixed(2)}`,
      'Uncollected balance on today’s customer bills',
    ]);
  }

  if (dailyMetrics.externalPlatformCount > 0) {
    metrics.push([
      'Delivery platforms',
      dailyMetrics.externalPlatformCount,
      `₹${(dailyMetrics.externalPlatformValuePaise / 100).toFixed(2)} · Swiggy / Zomato (Paid externally)`
    ]);
  }

  if (dailyMetrics.adminCreditCount > 0 || dailyMetrics.adminCreditOutstandingPaise > 0) {
    metrics.push([
      'Admin credit',
      `₹${(dailyMetrics.adminCreditTotalPaise / 100).toFixed(2)}`,
      `Outstanding: ₹${(dailyMetrics.adminCreditOutstandingPaise / 100).toFixed(2)}`
    ]);
  }
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
            Owner portal · {profile.role}
          </p>
          <h1
            style={{
              fontFamily: 'Georgia,serif',
              fontSize: 'clamp(2.1rem,5vw,3.4rem)',
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Today’s service
          </h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Live overview of café orders and operations.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link className="btn" href="/admin/menu">
            Manage menu
          </Link>
          <LogoutButton />
        </div>
      </header>
      <AdminNav activeTab="today" />
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))',
          gap: 12,
        }}
        className="metric-grid"
      >
        {metrics.map(([label, value, note], index) => (
          <article
            key={label}
            className="card metric-card"
            style={{ padding: 18, borderTop: index === 0 ? '3px solid var(--accent)' : undefined }}
          >
            <div className="muted">{label}</div>
            <strong
              style={{
                display: 'block',
                fontSize: 'clamp(1.65rem,4vw,2.25rem)',
                fontFamily: 'Georgia,serif',
                margin: '8px 0 4px',
              }}
            >
              {value}
            </strong>
            <small className="muted">{note}</small>
          </article>
        ))}
      </section>
      <section className="section-block" style={{ marginTop: 30 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ fontFamily: 'Georgia,serif', fontSize: '1.8rem', margin: '0 0 12px' }}>
            Recent orders
          </h2>
          <Link className="muted" href="/staff">
            View staff queue →
          </Link>
        </div>
        {rows.length ? (
          rows.map((o) => {
            const t = o.cafe_tables as unknown as { label: string } | null;
            const sourceBadge =
              o.order_source === 'admin_credit'
                ? `Admin Credit · ${o.payment_status === 'paid' ? 'Paid' : o.payment_status === 'partially_paid' ? 'Partially Paid' : 'Unpaid'}`
                : o.external_platform_name
                  ? `${o.external_platform_name} ${o.external_platform_ref || ''} (Paid Externally)`
                  : t?.label ?? 'Counter / Takeaway';

            return (
              <details className="card order-summary" style={{ padding: 14, margin: '8px 0' }} key={o.id}>
                <summary style={{ cursor: 'pointer' }}>
                  <b>
                    #{o.order_number} · {o.status}
                  </b>{' '}
                  · {sourceBadge} · ₹{(o.total_paise / 100).toFixed(2)}{' '}
                  <span className="muted">
                    {new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </span>
                </summary>
                <p className="muted" style={{ margin: '10px 0 4px' }}>
                  {o.customer_name || 'Guest'} · {o.guest_count ?? 1}{' '}
                  {o.guest_count === 1 ? 'person' : 'people'}
                </p>
                <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>
                  {(
                    o.order_items as unknown as {
                      item_name_snapshot: string;
                      quantity: number;
                    }[]
                  ).map((i, n) => (
                    <li key={n}>
                      {i.quantity}× {i.item_name_snapshot}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })
        ) : (
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <p style={{ fontFamily: 'Georgia,serif', fontSize: '1.45rem', margin: '0 0 8px' }}>
              No orders yet
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Orders from table QR codes will appear here and in the staff queue.
            </p>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Order value is orders placed, not verified payments or accounting revenue.
        </p>
      </section>
    </main>
  );
}
