'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { formatINR } from '@/lib/pricing';

type Item = {
  id: string;
  name: string;
  description: string | null;
  price_paise: number;
  is_veg: boolean;
  is_available: boolean;
  category_id: string;
  image_url: string | null;
};

type Category = {
  id: string;
  name: string;
};

export default function MenuClient({
  table,
  categories,
  items,
  demo = false,
}: {
  table: { label: string; qr_token: string };
  categories: Category[];
  items: Item[];
  demo?: boolean;
}) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartReady, setCartReady] = useState(false);
  const cartTouched = useRef(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('all');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [guestCount, setGuestCount] = useState('1');
  const [open, setOpen] = useState(false);
  const [tracked, setTracked] = useState<{ key: string; number: number; status: string } | null>(null);

  useEffect(() => {
    if (!tracked || ['COMPLETED', 'CANCELLED'].includes(tracked.status)) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/orders/${tracked.key}`);
        if (r.ok) {
          const d = await r.json();
          setTracked((v) => v && { ...v, status: d.status });
        }
      } catch {}
    }, 8000);
    return () => clearInterval(t);
  }, [tracked]);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`cafe-cart-${table.qr_token}`) || '{}');
      startTransition(() => {
        if (!cartTouched.current) setCart(saved);
        setCartReady(true);
      });
    } catch {
      startTransition(() => setCartReady(true));
    }
  }, [table.qr_token]);

  useEffect(() => {
    if (cartReady) sessionStorage.setItem(`cafe-cart-${table.qr_token}`, JSON.stringify(cart));
  }, [cart, cartReady, table.qr_token]);

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (active === 'all' || i.category_id === active) &&
          i.name.toLowerCase().includes(query.toLowerCase())
      ),
    [items, query, active]
  );

  const total = items.reduce((sum, i) => sum + (cart[i.id] || 0) * i.price_paise, 0);
  const count = Object.values(cart).reduce((a, b) => a + b, 0);

  function change(id: string, delta: number) {
    cartTouched.current = true;
    setCart((c) => {
      const n = Math.max(0, (c[id] || 0) + delta);
      const next = { ...c };
      if (n) next[id] = n;
      else delete next[id];
      return next;
    });
  }

  async function place() {
    const parsedGuestCount = Number(guestCount);
    if (!customerName.trim() || !Number.isInteger(parsedGuestCount) || parsedGuestCount < 1 || parsedGuestCount > 20) {
      setMessage('Please enter your name and the number of people at your table.');
      return;
    }
    if (demo) {
      setMessage('Preview mode: this demo table cannot submit real orders. Scan an active table QR code to order.');
      return;
    }
    setSending(true);
    setMessage('');
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      tableToken: table.qr_token,
      idempotencyKey,
      customerName: customerName.trim(),
      guestCount: parsedGuestCount,
      items: Object.entries(cart).map(([menuItemId, quantity]) => ({
        menuItemId,
        quantity,
        optionIds: [],
      })),
    };
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setOpen(false);
      setTracked({ key: idempotencyKey, number: d.order_number, status: d.status || 'NEW' });
      setMessage('');
      setCart({});
      setCustomerName('');
      setGuestCount('1');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="shell">
      <header>
        <p style={{ color: 'var(--accent)', fontSize: 12, letterSpacing: '.16em', textTransform: 'uppercase' }}>
          Dine in · {table.label}
        </p>
        <h1
          style={{
            fontFamily: 'Georgia,serif',
            fontSize: 'clamp(2.2rem,8vw,3.4rem)',
            lineHeight: 1.05,
            margin: '6px 0',
            overflowWrap: 'break-word',
          }}
        >
          Good coffee,<br />
          <em style={{ color: 'var(--accent)' }}>made for your table.</em>
        </h1>
        <p className="muted">Choose your favourites. Pay at the counter when you’re ready.</p>
      </header>

      <input
        aria-label="Search menu"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the menu"
        style={{
          width: '100%',
          padding: 13,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: '#ffffff10',
          color: 'var(--ink)',
        }}
      />

      <div className="category-scroller" role="tablist" aria-label="Menu categories">
        <button
          className="chip"
          role="tab"
          aria-selected={active === 'all'}
          onClick={() => setActive('all')}
          style={active === 'all' ? { background: 'var(--accent)', color: '#2b1b16', fontWeight: 700 } : undefined}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            className="chip"
            role="tab"
            aria-selected={active === c.id}
            onClick={() => setActive(c.id)}
            style={active === c.id ? { background: 'var(--accent)', color: '#2b1b16', fontWeight: 700 } : undefined}
            key={c.id}
          >
            {c.name}
          </button>
        ))}
      </div>

      <section style={{ display: 'grid', gap: 12 }}>
        {visible.map((i) => (
          <article className="card" key={i.id} style={{ padding: 15, display: 'flex', gap: 12, minWidth: 0 }}>
            {i.image_url ? (
              <img
                src={i.image_url}
                alt={i.name}
                style={{ width: 76, height: 76, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div
                aria-hidden
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: 8,
                  background: i.is_veg
                    ? 'linear-gradient(135deg,#d5a84b,#6d3b23)'
                    : 'linear-gradient(135deg,#7c342b,#e3ad77)',
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 28,
                }}
              >
                {(
                  {
                    pizza: '🍕',
                    burger: '🍔',
                    fries: '🍟',
                    'hot-beverages': '☕',
                    'frappe-cold-coffee': '🥤',
                    'thick-shakes': '🥤',
                    mocktails: '🍹',
                    desserts: '🍰',
                    pasta: '🍝',
                    noodles: '🍜',
                    maggi: '🍜',
                    chinese: '🥡',
                    'garlic-bread': '🥖',
                  } as Record<string, string>
                )[i.category_id] ?? '🥪'}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <strong style={{ minWidth: 0, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                  {i.is_veg ? '● ' : '◆ '}
                  {i.name}
                </strong>
                <span className="price">{formatINR(i.price_paise)}</span>
              </div>
              <p className="muted" style={{ margin: '4px 0 8px', overflowWrap: 'break-word' }}>
                {i.description}
              </p>
              {!i.is_available ? (
                <b className="muted">Sold out</b>
              ) : cart[i.id] ? (
                <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <button className="chip" aria-label={`Remove ${i.name}`} onClick={() => change(i.id, -1)}>
                    −
                  </button>
                  <span style={{ padding: '0 10px', fontWeight: 700 }}>{cart[i.id]}</span>
                  <button className="chip" aria-label={`Add ${i.name}`} onClick={() => change(i.id, 1)}>
                    +
                  </button>
                </div>
              ) : (
                <button className="btn" onClick={() => change(i.id, 1)}>
                  Add
                </button>
              )}
            </div>
          </article>
        ))}
      </section>

      {!visible.length && <p className="muted">No menu items match your search.</p>}

      <aside
        className="card"
        style={{
          position: 'sticky',
          bottom: 12,
          padding: 14,
          marginTop: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <b>
            {count} item{count === 1 ? '' : 's'}
          </b>
          <div className="price">{formatINR(total)}</div>
        </div>
        <button
          className="btn"
          disabled={!count}
          onClick={() => {
            setMessage('');
            setOpen(true);
          }}
        >
          Place Order
        </button>
      </aside>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm your order"
          onClick={(e) => {
            if (e.target === e.currentTarget && !sending) setOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'grid',
            placeItems: 'end center',
            zIndex: 50,
            padding: 12,
          }}
        >
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              place();
            }}
            style={{
              width: 'min(100%, 460px)',
              padding: 20,
              background: '#2b1b16',
              display: 'grid',
              gap: 14,
            }}
          >
            <h2 style={{ fontFamily: 'Georgia,serif', margin: 0 }}>Almost there</h2>
            <p className="muted" style={{ margin: 0 }}>
              {count} item{count === 1 ? '' : 's'} · {formatINR(total)}. Tell us who’s ordering so staff can bring it to
              your table.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6, fontWeight: 700, fontSize: 14 }}>
                Your name
                <input
                  aria-label="Your name"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  maxLength={60}
                  placeholder="Name for this order"
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    background: '#ffffff10',
                    color: 'var(--ink)',
                  }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6, fontWeight: 700, fontSize: 14 }}>
                People
                <input
                  aria-label="Number of people"
                  required
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    background: '#ffffff10',
                    color: 'var(--ink)',
                  }}
                />
              </label>
            </div>
            {demo && (
              <p className="muted" style={{ margin: 0, padding: 10, borderLeft: '3px solid var(--accent)' }}>
                Demo mode — orders will not be sent to staff. Scan an active table QR code to place a real order.
              </p>
            )}
            {message && (
              <p role="alert" style={{ margin: 0, padding: 10, borderLeft: '3px solid #df6d5d' }}>
                {message}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="chip" disabled={sending} onClick={() => setOpen(false)}>
                Back
              </button>
              <button className="btn" style={{ flex: 1 }} disabled={sending || demo}>
                {demo ? 'Preview only' : sending ? 'Sending…' : 'Send order to staff'}
              </button>
            </div>
          </form>
        </div>
      )}

      {tracked && (
        <section className="card" aria-live="polite" style={{ padding: 16, marginTop: 18 }}>
          <b>Order #{tracked.number}</b>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {(
              {
                NEW: 'Sent to the café — waiting for staff to accept.',
                ACCEPTED: 'Accepted — being prepared for your table.',
                PREPARING: 'Being prepared now.',
                READY: 'Ready! On its way to your table.',
                COMPLETED: 'Served. Enjoy! Pay at the counter.',
                CANCELLED: 'This order was cancelled. Please ask staff.',
              } as Record<string, string>
            )[tracked.status]}
          </p>
        </section>
      )}

      {message && (
        <p role="status" className="card" style={{ padding: 14 }}>
          {message}
        </p>
      )}
    </main>
  );
}
