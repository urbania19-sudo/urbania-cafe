'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Bill } from '@/lib/billing';
import ThermalBillModal from '@/components/staff/ThermalBillModal';
import ManualOrderModal from '@/components/staff/ManualOrderModal';

type Order = {
  id: string;
  order_number: number;
  status: string;
  customer_name: string | null;
  guest_count: number | null;
  total_paise: number;
  created_at: string;
  billed_at?: string | null;
  service_mode?: string | null;
  order_source?: string | null;
  cafe_tables: { label: string } | null;
  order_items: { menu_item_id: string | null; item_name_snapshot: string; quantity: number }[];
};

type MenuItem = {
  id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
};

type TableOption = {
  id: string;
  table_number: number;
  label: string;
};

const next: Record<string, string | undefined> = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'COMPLETED',
  // Backward compatibility in case existing orders in database have PREPARING or READY status
  PREPARING: 'COMPLETED',
  READY: 'COMPLETED',
};

const action: Record<string, string> = {
  NEW: 'Accept Order',
  ACCEPTED: 'Completed',
  PREPARING: 'Completed',
  READY: 'Completed',
};

export default function OrderBoard({
  initial,
  menu,
  tables = [],
}: {
  initial: Order[];
  menu: MenuItem[];
  tables?: TableOption[];
}) {
  const router = useRouter();
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string; qty: Record<string, number> } | null>(null);
  const [adding, setAdding] = useState('');
  const [activeBill, setActiveBill] = useState<{ bill: Bill; isReprint: boolean } | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'completed'>('all');

  const nameOf = (id: string, o?: Order) =>
    menu.find((m) => m.id === id)?.name ??
    o?.order_items.find((i) => i.menu_item_id === id)?.item_name_snapshot ??
    'Item';

  const orders = initial.map((order) => ({
    ...order,
    status: statusById[order.id] ?? order.status,
  }));

  const activeOrders = orders.filter((o) => ['NEW', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status));
  const completedOrders = orders.filter((o) => o.status === 'COMPLETED');

  const visibleOrders =
    filterTab === 'active'
      ? activeOrders
      : filterTab === 'completed'
      ? completedOrders
      : [...activeOrders, ...completedOrders];

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [router]);

  async function reject(o: Order) {
    if (!confirm(`Reject order #${o.order_number}? The customer will see it as cancelled.`)) return;
    setBusy(o.id);
    setError('');
    try {
      const r = await fetch(`/api/staff/orders/${o.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      const data = await r.json().catch(() => null);
      if (r.ok && data?.ok) {
        setStatusById((v) => ({ ...v, [o.id]: 'CANCELLED' }));
        router.refresh();
      } else {
        setError(data?.error || 'Could not reject this order. Staff can only reject orders that are still new.');
      }
    } catch (err) {
      console.error(`Network error rejecting order #${o.order_number}:`, err);
      setError('Network connection error. Please check your internet connection and try again.');
    } finally {
      setBusy(undefined);
    }
  }

  function startEdit(o: Order) {
    setAdding('');
    setEditing({
      id: o.id,
      qty: Object.fromEntries(
        o.order_items.filter((i) => i.menu_item_id).map((i) => [i.menu_item_id as string, i.quantity])
      ),
    });
  }

  function setQty(id: string, delta: number) {
    setEditing((e) => {
      if (!e) return e;
      const n = (e.qty[id] ?? 0) + delta;
      const qty = { ...e.qty };
      if (n < 1) delete qty[id];
      else qty[id] = Math.min(n, 20);
      return { ...e, qty };
    });
  }

  async function saveEdit() {
    if (!editing) return;
    const items = Object.entries(editing.qty).map(([menuItemId, quantity]) => ({
      menuItemId,
      quantity,
    }));
    if (!items.length) {
      return setError('An order needs at least one item. Use Reject to cancel it instead.');
    }
    setBusy(editing.id);
    setError('');
    try {
      const r = await fetch(`/api/staff/orders/${editing.id}/items`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await r.json().catch(() => null);
      if (r.ok && data?.ok) {
        setEditing(null);
        router.refresh();
      } else {
        setError(data?.error ?? 'Could not save the changes.');
      }
    } catch (err) {
      console.error('Network error saving order edits:', err);
      setError('Network connection error. Please check your internet connection and try again.');
    } finally {
      setBusy(undefined);
    }
  }

  async function advance(o: Order) {
    const status = next[o.status];
    if (!status) return;
    setBusy(o.id);
    setError('');
    try {
      const r = await fetch(`/api/staff/orders/${o.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await r.json().catch(() => null);
      if (r.ok && data?.ok) {
        const confirmedStatus = data.status || status;
        setStatusById((v) => ({ ...v, [o.id]: confirmedStatus }));
        router.refresh();
      } else {
        const errorMsg = data?.error || `Could not update order #${o.order_number}. Refresh and try again.`;
        setError(errorMsg);
      }
    } catch (err) {
      console.error(`Network or unexpected error advancing order #${o.order_number}:`, err);
      setError('Network connection error. Please check your internet connection and try again.');
    } finally {
      setBusy(undefined);
    }
  }

  async function openBill(o: Order) {
    if (o.status === 'NEW') {
      setError(`Please accept Order #${o.order_number} before viewing receipt.`);
      return;
    }
    setBusy(o.id);
    setError('');
    try {
      if (o.billed_at) {
        const res = await fetch(`/api/staff/orders/${o.id}/bill`);
        const data = await res.json();
        if (!res.ok || !data.bill) {
          throw new Error(data.error || 'Failed to load existing bill');
        }
        setActiveBill({
          bill: data.bill,
          isReprint: true,
        });
        return;
      }

      const res = await fetch(`/api/staff/orders/${o.id}/bill`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === 'PREVIEW_READ_ONLY') {
          throw new Error('Preview mode is read-only to protect live café data.');
        }
        throw new Error(data.error || 'Failed to load receipt');
      }
      setActiveBill({
        bill: data.bill,
        isReprint: Boolean(data.already_issued || o.billed_at),
      });
    } catch (err) {
      console.error('Receipt view error:', err);
      setError(err instanceof Error ? err.message : 'Could not open receipt.');
    } finally {
      setBusy(undefined);
    }
  }

  async function billOrderDirectly(orderId: string) {
    setBusy(orderId);
    setError('');
    try {
      const res = await fetch(`/api/staff/orders/${orderId}/bill`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to generate bill');
      }
      setActiveBill({
        bill: data.bill,
        isReprint: Boolean(data.already_issued),
      });
    } catch (err) {
      console.error('Billing error:', err);
      setError(err instanceof Error ? err.message : 'Could not generate bill.');
    } finally {
      setBusy(undefined);
    }
  }

  if (!orders.length) {
    return (
      <>
        <section className="card" style={{ padding: 'clamp(28px,6vw,52px)', textAlign: 'center' }}>
          <div aria-hidden style={{ fontSize: 34, marginBottom: 8 }}>
            ☕
          </div>
          <h2 style={{ fontFamily: 'Georgia, serif', margin: '0 0 8px' }}>Waiting for orders</h2>
          <p className="muted" style={{ maxWidth: 420, margin: 'auto' }}>
            This queue checks for new table and takeaway orders every 15 seconds.
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={() => setShowManualModal(true)}
              style={{ padding: '10px 20px', fontSize: 14 }}
            >
              + Create Counter / Takeaway Order
            </button>
          </div>
        </section>

        {showManualModal && (
          <ManualOrderModal
            tables={tables}
            menuItems={menu}
            onClose={() => setShowManualModal(false)}
            onSuccess={async (newOrder) => {
              setShowManualModal(false);
              router.refresh();
              await billOrderDirectly(newOrder.order_id);
            }}
          />
        )}

        {activeBill && (
          <ThermalBillModal
            bill={activeBill.bill}
            isReprint={activeBill.isReprint}
            onClose={() => {
              setActiveBill(null);
              router.refresh();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="chip"
            onClick={() => setFilterTab('all')}
            style={
              filterTab === 'all'
                ? { background: 'var(--accent)', color: '#2b1b16', fontWeight: 700 }
                : { fontSize: 13 }
            }
          >
            All ({orders.length})
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setFilterTab('active')}
            style={
              filterTab === 'active'
                ? { background: 'var(--accent)', color: '#2b1b16', fontWeight: 700 }
                : { fontSize: 13 }
            }
          >
            Active ({activeOrders.length})
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setFilterTab('completed')}
            style={
              filterTab === 'completed'
                ? { background: 'var(--accent)', color: '#2b1b16', fontWeight: 700 }
                : { fontSize: 13 }
            }
          >
            Completed ({completedOrders.length})
          </button>
        </div>

        <button
          className="btn"
          onClick={() => setShowManualModal(true)}
          style={{ fontSize: 13, padding: '8px 16px' }}
        >
          + Counter / Takeaway Order
        </button>
      </div>

      <section style={{ display: 'grid', gap: 12 }}>
        {error && (
          <p role="alert" style={{ padding: 12, borderLeft: '3px solid #df6d5d', margin: 0 }}>
            {error}
          </p>
        )}
        {visibleOrders.map((o) => {
          const following = next[o.status];
          const isCompleted = o.status === 'COMPLETED';
          const canViewReceipt = isCompleted || Boolean(o.billed_at);

          return (
            <article className="card" key={o.id} style={{ padding: 18, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'start',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      color: 'var(--accent)',
                      fontSize: 12,
                      letterSpacing: '.12em',
                      fontWeight: 600,
                      display: 'block',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {o.cafe_tables?.label
                      ? `TABLE · ${o.cafe_tables.label}`
                      : o.service_mode
                      ? o.service_mode.toUpperCase().replace('_', ' ')
                      : 'COUNTER / TAKEAWAY'}
                  </span>
                  <h2
                    style={{
                      fontFamily: 'Georgia, serif',
                      margin: '5px 0',
                      fontSize: 'clamp(1.2rem, 4vw, 1.5rem)',
                      overflowWrap: 'break-word',
                    }}
                  >
                    Order #{o.order_number}
                  </h2>
                  <p className="muted" style={{ margin: '0 0 4px', overflowWrap: 'break-word' }}>
                    {o.customer_name || 'Guest'} · {o.guest_count ?? 1}{' '}
                    {o.guest_count === 1 ? 'person' : 'people'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {o.billed_at && (
                    <span className="chip" style={{ fontSize: 11, borderColor: '#d5a84b66', color: 'var(--accent)' }}>
                      ✓ Billed
                    </span>
                  )}
                  <span
                    className="chip"
                    style={{
                      color: isCompleted ? '#10b981' : o.status === 'ACCEPTED' ? '#3b82f6' : 'var(--accent)',
                      borderColor: isCompleted ? '#10b98144' : o.status === 'ACCEPTED' ? '#3b82f644' : 'var(--line)',
                      fontWeight: 600,
                    }}
                  >
                    {o.status === 'NEW'
                      ? 'Order Placed'
                      : o.status === 'ACCEPTED'
                      ? 'Accepted'
                      : o.status === 'COMPLETED'
                      ? 'Completed'
                      : o.status}
                  </span>
                </div>
              </div>

              {editing?.id === o.id ? (
                <div style={{ display: 'grid', gap: 8, margin: '12px 0' }}>
                  {Object.entries(editing.qty).map(([id, q]) => (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ minWidth: 0, flex: 1, overflowWrap: 'break-word' }}>{nameOf(id, o)}</span>
                      <span style={{ display: 'flex', alignItems: 'center' }}>
                        <button className="chip" aria-label="Less" onClick={() => setQty(id, -1)}>
                          −
                        </button>
                        <span style={{ padding: '0 10px', fontWeight: 700 }}>{q}</span>
                        <button className="chip" aria-label="More" onClick={() => setQty(id, 1)}>
                          +
                        </button>
                      </span>
                    </div>
                  ))}
                  <select
                    aria-label="Add an item to order"
                    value={adding}
                    onChange={(e) => {
                      if (e.target.value) {
                        setQty(e.target.value, 1);
                      }
                      setAdding('');
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--line, #ffffff24)',
                      background: 'var(--card, #37241d)',
                      color: 'var(--ink, #f5ead9)',
                      width: '100%',
                      fontSize: 14,
                      fontWeight: 500,
                      outline: 'none',
                      cursor: 'pointer',
                      colorScheme: 'light',
                    }}
                  >
                    <option
                      value=""
                      style={{
                        color: '#6d5445',
                        backgroundColor: '#fbf8f2',
                        fontWeight: 600,
                      }}
                    >
                      + Add an item…
                    </option>
                    {menu
                      .filter((m) => m.is_available && !(m.id in editing.qty))
                      .map((m) => (
                        <option
                          key={m.id}
                          value={m.id}
                          style={{
                            color: '#2b1b16',
                            backgroundColor: '#ffffff',
                            fontWeight: 500,
                            padding: '8px 12px',
                          }}
                        >
                          {m.name} · ₹{(m.price_paise / 100).toFixed(2)}
                        </option>
                      ))}
                  </select>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" disabled={busy === o.id} onClick={saveEdit}>
                      {busy === o.id ? 'Saving…' : 'Save changes'}
                    </button>
                    <button className="chip" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="muted" style={{ paddingLeft: 20, margin: '10px 0', lineHeight: 1.6, overflowWrap: 'break-word' }}>
                  {o.order_items.map((i, n) => (
                    <li key={n} style={{ overflowWrap: 'break-word' }}>
                      {i.quantity}× {i.item_name_snapshot}
                    </li>
                  ))}
                </ul>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  borderTop: '1px solid var(--line)',
                  paddingTop: 14,
                  flexWrap: 'wrap',
                }}
              >
                <b style={{ fontSize: '1.15rem' }}>₹{(o.total_paise / 100).toFixed(2)}</b>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                  {o.status === 'NEW' && (
                    <button className="chip" disabled={busy === o.id} onClick={() => reject(o)}>
                      Reject
                    </button>
                  )}
                  {['NEW', 'ACCEPTED'].includes(o.status) && editing?.id !== o.id && (
                    <button className="chip" onClick={() => startEdit(o)}>
                      Edit items
                    </button>
                  )}
                  {following && (
                    <button
                      className="btn"
                      disabled={busy === o.id}
                      onClick={() => advance(o)}
                    >
                      {busy === o.id ? 'Updating…' : action[o.status]}
                    </button>
                  )}
                  {canViewReceipt && (
                    <button
                      className="btn"
                      disabled={busy === o.id}
                      onClick={() => openBill(o)}
                      style={{ fontWeight: 700 }}
                      title="View clean receipt image"
                    >
                      {busy === o.id ? 'Loading…' : 'View Image'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {showManualModal && (
        <ManualOrderModal
          tables={tables}
          menuItems={menu}
          onClose={() => setShowManualModal(false)}
          onSuccess={async (newOrder) => {
            setShowManualModal(false);
            router.refresh();
            await billOrderDirectly(newOrder.order_id);
          }}
        />
      )}

      {activeBill && (
        <ThermalBillModal
          bill={activeBill.bill}
          isReprint={activeBill.isReprint}
          onClose={() => {
            setActiveBill(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
