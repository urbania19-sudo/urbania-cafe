'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Bill } from '@/lib/billing';
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
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
};

const action: Record<string, string> = {
  NEW: 'Accept order',
  ACCEPTED: 'Start preparing',
  PREPARING: 'Mark ready',
  READY: 'Mark completed',
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

  const nameOf = (id: string, o?: Order) =>
    menu.find((m) => m.id === id)?.name ??
    o?.order_items.find((i) => i.menu_item_id === id)?.item_name_snapshot ??
    'Item';

  const orders = initial.map((order) => ({
    ...order,
    status: statusById[order.id] ?? order.status,
  }));

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [router]);

  async function reject(o: Order) {
    if (!confirm(`Reject order #${o.order_number}? The customer will see it as cancelled.`)) return;
    setBusy(o.id);
    setError('');
    const r = await fetch(`/api/staff/orders/${o.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    });
    if (r.ok) {
      setStatusById((v) => ({ ...v, [o.id]: 'CANCELLED' }));
      router.refresh();
    } else {
      setError('Could not reject this order. Staff can only reject orders that are still new.');
    }
    setBusy(undefined);
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
    const r = await fetch(`/api/staff/orders/${editing.id}/items`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (r.ok) {
      setEditing(null);
      router.refresh();
    } else {
      setError((await r.json().catch(() => null))?.error ?? 'Could not save the changes.');
    }
    setBusy(undefined);
  }

  async function advance(o: Order) {
    const status = next[o.status];
    if (!status) return;
    setBusy(o.id);
    setError('');
    const r = await fetch(`/api/staff/orders/${o.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (r.ok) {
      setStatusById((v) => ({ ...v, [o.id]: status }));
      router.refresh();
    } else {
      setError('Could not update this order. Refresh and try again.');
    }
    setBusy(undefined);
  }

  async function openBill(o: Order) {
    if (o.status === 'NEW') {
      setError(`Please accept Order #${o.order_number} before generating its bill.`);
      return;
    }
    setBusy(o.id);
    setError('');
    try {
      const res = await fetch(`/api/staff/orders/${o.id}/bill`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to generate bill');
      }
      setActiveBill({
        bill: data.bill,
        isReprint: Boolean(data.already_issued || o.billed_at),
      });
    } catch (err) {
      console.error('Billing error:', err);
      setError(err instanceof Error ? err.message : 'Could not generate bill.');
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
            This queue checks for new table and counter orders every 15 seconds.
          </p>
          <div style={{ marginTop: 20 }}>
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
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <span className="muted" style={{ fontSize: 13 }}>
          {orders.length} active {orders.length === 1 ? 'ticket' : 'tickets'} in queue
        </span>
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
        {orders.map((o) => {
          const following = next[o.status];
          const isEligibleForBill = o.status !== 'NEW' && o.status !== 'CANCELLED';

          return (
            <article className="card" key={o.id} style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
                <div>
                  <span style={{ color: 'var(--accent)', fontSize: 12, letterSpacing: '.12em', fontWeight: 600 }}>
                    {o.cafe_tables?.label
                      ? `TABLE · ${o.cafe_tables.label}`
                      : (o.service_mode ? o.service_mode.toUpperCase().replace('_', ' ') : 'COUNTER / TAKEAWAY')}
                  </span>
                  <h2 style={{ fontFamily: 'Georgia, serif', margin: '5px 0' }}>Order #{o.order_number}</h2>
                  <p className="muted" style={{ margin: '0 0 4px' }}>
                    {o.customer_name || 'Guest'} · {o.guest_count ?? 1}{' '}
                    {o.guest_count === 1 ? 'person' : 'people'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {o.billed_at && (
                    <span className="chip" style={{ fontSize: 11, borderColor: '#d5a84b66', color: 'var(--accent)' }}>
                      ✓ Billed
                    </span>
                  )}
                  <span className="chip" style={{ color: 'var(--accent)' }}>
                    {o.status}
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
                      }}
                    >
                      <span>{nameOf(id, o)}</span>
                      <span>
                        <button className="chip" aria-label="Less" onClick={() => setQty(id, -1)}>
                          −
                        </button>
                        <span style={{ padding: '0 10px' }}>{q}</span>
                        <button className="chip" aria-label="More" onClick={() => setQty(id, 1)}>
                          +
                        </button>
                      </span>
                    </div>
                  ))}
                  <select
                    value={adding}
                    onChange={(e) => {
                      if (e.target.value) {
                        setQty(e.target.value, 1);
                      }
                      setAdding('');
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                      background: '#ffffff10',
                      color: 'var(--ink)',
                    }}
                  >
                    <option value="">+ Add an item…</option>
                    {menu
                      .filter((m) => m.is_available && !(m.id in editing.qty))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · ₹{(m.price_paise / 100).toFixed(2)}
                        </option>
                      ))}
                  </select>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" disabled={busy === o.id} onClick={saveEdit}>
                      {busy === o.id ? 'Saving…' : 'Save changes'}
                    </button>
                    <button className="chip" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="muted" style={{ paddingLeft: 20, lineHeight: 1.7 }}>
                  {o.order_items.map((i, n) => (
                    <li key={n}>
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
                <b>₹{(o.total_paise / 100).toFixed(2)}</b>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {o.status === 'NEW' && (
                    <button className="chip" disabled={busy === o.id} onClick={() => reject(o)}>
                      Reject
                    </button>
                  )}
                  {['NEW', 'ACCEPTED', 'PREPARING'].includes(o.status) && editing?.id !== o.id && (
                    <button className="chip" onClick={() => startEdit(o)}>
                      Edit items
                    </button>
                  )}
                  {isEligibleForBill && (
                    <button
                      className="chip"
                      disabled={busy === o.id}
                      onClick={() => openBill(o)}
                      style={{ fontWeight: 600, borderColor: '#d5a84b88' }}
                      title="Generate and print 58mm thermal receipt"
                    >
                      {busy === o.id ? 'Loading…' : o.billed_at ? '🧾 Reprint Bill' : '🧾 Print Bill'}
                    </button>
                  )}
                  {following && (
                    <button className="btn" disabled={busy === o.id} onClick={() => advance(o)}>
                      {busy === o.id ? 'Updating…' : action[o.status]}
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
