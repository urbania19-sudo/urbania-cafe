'use client';

import { useState, useEffect } from 'react';

interface MenuItemOption {
  id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
  category_name?: string | null;
}

interface OrderItemRow {
  isCustom: boolean;
  menuItemId?: string;
  name: string;
  unitPriceRupees: number;
  quantity: number;
  note?: string;
}

export default function DeliveryPlatformOrderModal({
  menuItems = [],
  onClose,
  onSuccess,
}: {
  menuItems?: MenuItemOption[];
  onClose: () => void;
  onSuccess: (order: { order_id: string; order_number: number; total_paise: number }) => void;
}) {
  const [platform, setPlatform] = useState<'swiggy' | 'zomato'>('swiggy');
  const [platformRef, setPlatformRef] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerNote, setCustomerNote] = useState('');

  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catalogue search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Custom dish drawer/inputs
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPriceRupees, setCustomPriceRupees] = useState('');
  const [customQty, setCustomQty] = useState(1);
  const [customNote, setCustomNote] = useState('');

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  const categories = Array.from(
    new Set(
      menuItems
        .map((m) => m.category_name || 'Other')
        .filter(Boolean)
    )
  ).sort();

  const filteredMenuItems = menuItems.filter((m) => {
    if (!m.is_available) return false;
    if (selectedCategory !== 'ALL' && (m.category_name || 'Other') !== selectedCategory) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchName = m.name.toLowerCase().includes(q);
      const matchCat = (m.category_name || '').toLowerCase().includes(q);
      return matchName || matchCat;
    }
    return true;
  });

  function addItem(item: MenuItemOption) {
    setItems((prev) => {
      const existingIdx = prev.findIndex((p) => !p.isCustom && p.menuItemId === item.id);
      if (existingIdx >= 0) {
        const copy = [...prev];
        const existing = copy[existingIdx];
        if (existing) {
          copy[existingIdx] = {
            ...existing,
            quantity: Math.min(20, existing.quantity + 1),
          };
        }
        return copy;
      }
      return [
        ...prev,
        {
          isCustom: false,
          menuItemId: item.id,
          name: item.name,
          unitPriceRupees: item.price_paise / 100,
          quantity: 1,
        },
      ];
    });
  }

  function updateQuantity(idx: number, delta: number) {
    setItems((prev) => {
      const copy = [...prev];
      const item = copy[idx];
      if (!item) return prev;
      const nextQty = item.quantity + delta;
      if (nextQty <= 0) {
        copy.splice(idx, 1);
      } else {
        copy[idx] = { ...item, quantity: Math.min(20, nextQty) };
      }
      return copy;
    });
  }

  function updateItemNote(idx: number, note: string) {
    setItems((prev) => {
      const copy = [...prev];
      if (copy[idx]) {
        copy[idx] = { ...copy[idx]!, note: note || undefined };
      }
      return copy;
    });
  }

  function addCustomItem() {
    const name = customName.trim();
    const price = parseFloat(customPriceRupees);
    if (!name) {
      setError('Please enter a name for the custom item.');
      return;
    }
    if (isNaN(price) || price < 0) {
      setError('Please enter a valid price for the custom item.');
      return;
    }

    setItems((prev) => [
      ...prev,
      {
        isCustom: true,
        name,
        unitPriceRupees: price,
        quantity: customQty,
        note: customNote.trim() || undefined,
      },
    ]);

    setCustomName('');
    setCustomPriceRupees('');
    setCustomQty(1);
    setCustomNote('');
    setShowCustomForm(false);
    setError(null);
  }

  const totalPaise = items.reduce(
    (acc, i) => acc + Math.round(i.unitPriceRupees * 100) * i.quantity,
    0
  );

  async function handleSubmit() {
    if (!platformRef.trim()) {
      setError('Please enter the delivery platform order reference / ID (e.g. #SW-1042).');
      return;
    }

    if (items.length === 0) {
      setError('Please add at least one item to prepare in the kitchen.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        serviceMode: 'delivery',
        orderSource: platform,
        externalPlatformName: platform === 'swiggy' ? 'Swiggy' : 'Zomato',
        externalPlatformRef: platformRef.trim(),
        customerName: customerName.trim() || `${platform === 'swiggy' ? 'Swiggy' : 'Zomato'} Delivery`,
        customerNote: customerNote.trim() || undefined,
        guestCount: 1,
        items: items.map((i) => ({
          menuItemId: i.isCustom ? undefined : i.menuItemId,
          name: i.isCustom ? i.name : undefined,
          quantity: i.quantity,
          unitPricePaise: Math.round(i.unitPriceRupees * 100),
          note: i.note,
          isCustom: i.isCustom,
        })),
      };

      const res = await fetch('/api/staff/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to create platform order');
      }

      onSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create platform order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 20px',
          overflow: 'hidden',
          boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
          border: '1px solid var(--line)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: '1.35rem' }}>
              🛵 Delivery Platform Order
            </h2>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
              Create kitchen ticket for Swiggy or Zomato delivery order. Customer billing is disabled.
            </p>
          </div>
          <button
            className="chip"
            onClick={onClose}
            disabled={submitting}
            style={{ fontSize: 16, width: 34, height: 34, padding: 0, display: 'grid', placeItems: 'center' }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              backgroundColor: '#df6d5d1a',
              borderLeft: '3px solid #df6d5d',
              color: '#f87171',
              fontSize: 13,
              marginBottom: 14,
              borderRadius: 4,
            }}
          >
            {error}
          </div>
        )}

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 4 }}>
          {/* Platform Selector & Order Ref */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
                Platform
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setPlatform('swiggy')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: platform === 'swiggy' ? '2px solid #fc8019' : '1px solid var(--line)',
                    background: platform === 'swiggy' ? '#fc801922' : 'transparent',
                    color: platform === 'swiggy' ? '#fc8019' : 'var(--ink)',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  🟠 Swiggy
                </button>
                <button
                  type="button"
                  onClick={() => setPlatform('zomato')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: platform === 'zomato' ? '2px solid #e23744' : '1px solid var(--line)',
                    background: platform === 'zomato' ? '#e2374422' : 'transparent',
                    color: platform === 'zomato' ? '#e23744' : 'var(--ink)',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  🔴 Zomato
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
                Platform Order Reference / ID *
              </label>
              <input
                type="text"
                placeholder={platform === 'swiggy' ? 'e.g. #SW-1042' : 'e.g. #ZOM-8831'}
                value={platformRef}
                onChange={(e) => setPlatformRef(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: '#ffffff0a',
                  color: 'var(--ink)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Delivery Rider / Notes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
                Rider / Customer Info (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Rider Ramesh / Customer Rahul"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: '#ffffff0a',
                  color: 'var(--ink)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
                Kitchen / Packaging Note (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Pack extra napkins, separate gravy"
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: '#ffffff0a',
                  color: 'var(--ink)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Order Items Section */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '.05em' }}>
                ITEMS TO PREPARE ({items.reduce((s, i) => s + i.quantity, 0)})
              </label>
              <button
                type="button"
                onClick={() => setShowCustomForm(!showCustomForm)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {showCustomForm ? 'Cancel Custom Item' : '+ Add Custom Dish'}
              </button>
            </div>

            {/* Custom Item Form */}
            {showCustomForm && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 6,
                  border: '1px dashed var(--accent)',
                  background: 'rgba(200, 159, 101, 0.05)',
                  marginBottom: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Custom dish name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    style={{
                      padding: 8,
                      borderRadius: 4,
                      border: '1px solid var(--line)',
                      background: '#ffffff10',
                      color: 'var(--ink)',
                      fontSize: 12,
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Price (₹)"
                    value={customPriceRupees}
                    onChange={(e) => setCustomPriceRupees(e.target.value)}
                    style={{
                      padding: 8,
                      borderRadius: 4,
                      border: '1px solid var(--line)',
                      background: '#ffffff10',
                      color: 'var(--ink)',
                      fontSize: 12,
                    }}
                  />
                  <input
                    type="number"
                    min="1"
                    max="20"
                    placeholder="Qty"
                    value={customQty}
                    onChange={(e) => setCustomQty(parseInt(e.target.value) || 1)}
                    style={{
                      padding: 8,
                      borderRadius: 4,
                      border: '1px solid var(--line)',
                      background: '#ffffff10',
                      color: 'var(--ink)',
                      fontSize: 12,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Preparation note (optional)"
                    value={customNote}
                    onChange={(e) => setCustomNote(e.target.value)}
                    style={{
                      flex: 1,
                      padding: 8,
                      borderRadius: 4,
                      border: '1px solid var(--line)',
                      background: '#ffffff10',
                      color: 'var(--ink)',
                      fontSize: 12,
                    }}
                  />
                  <button type="button" className="btn" onClick={addCustomItem} style={{ fontSize: 12, padding: '6px 14px' }}>
                    Add Line Item
                  </button>
                </div>
              </div>
            )}

            {/* Selected Items List */}
            {items.length === 0 ? (
              <div
                style={{
                  padding: '16px',
                  textAlign: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 6,
                  border: '1px dashed var(--line)',
                  color: 'var(--muted)',
                  fontSize: 13,
                }}
              >
                No dishes selected. Choose dishes from the catalogue below.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {items.map((it, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--line)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                          {it.name} {it.isCustom && <span className="chip" style={{ fontSize: 9, padding: '1px 5px', color: 'var(--accent)' }}>Custom</span>}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--accent)' }}>
                          ₹{it.unitPriceRupees.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => updateQuantity(idx, -1)}
                          style={{ width: 26, height: 26, padding: 0, display: 'grid', placeItems: 'center' }}
                        >
                          -
                        </button>
                        <span style={{ fontSize: 13, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => updateQuantity(idx, 1)}
                          style={{ width: 26, height: 26, padding: 0, display: 'grid', placeItems: 'center' }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="Item note / kitchen instruction (optional)"
                      value={it.note || ''}
                      onChange={(e) => updateItemNote(idx, e.target.value)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: 'transparent',
                        color: 'var(--ink)',
                        fontSize: 11,
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Menu Catalogue Browser */}
            <div
              style={{
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'rgba(0,0,0,0.25)',
                padding: 10,
              }}
            >
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="🔍 Search dishes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    flex: '1 1 180px',
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid var(--line)',
                    background: '#ffffff0a',
                    color: 'var(--ink)',
                    fontSize: 12,
                  }}
                />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid var(--line)',
                    background: '#222',
                    color: 'var(--ink)',
                    fontSize: 12,
                  }}
                >
                  <option value="ALL">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {filteredMenuItems.map((m) => {
                  const existingItem = items.find((i) => !i.isCustom && i.menuItemId === m.id);
                  const inOrderCount = existingItem?.quantity || 0;
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 8px',
                        borderRadius: 4,
                        background: inOrderCount > 0 ? 'rgba(200, 159, 101, 0.08)' : 'rgba(255,255,255,0.02)',
                        border: inOrderCount > 0 ? '1px solid rgba(200, 159, 101, 0.25)' : '1px solid transparent',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{m.name}</span>
                        {m.category_name && (
                          <span className="chip" style={{ fontSize: 9, padding: '1px 5px', color: 'var(--muted)' }}>
                            {m.category_name}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                          ₹{(m.price_paise / 100).toFixed(2)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {inOrderCount > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                            {inOrderCount} in order
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn"
                          onClick={() => addItem(m)}
                          style={{ fontSize: 11, padding: '3px 8px' }}
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Operational Policy Banner */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              fontSize: 12,
              lineHeight: 1.5,
              color: '#93c5fd',
            }}
          >
            ℹ️ <b>Delivery Platform Policy:</b> Payments are managed externally by {platform === 'swiggy' ? 'Swiggy' : 'Zomato'}. Customer billing is disabled for this order. It will generate a kitchen-only preparation ticket (KOT).
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid var(--line)',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <span className="muted" style={{ fontSize: 12, display: 'block' }}>Platform Menu Value</span>
            <b style={{ fontSize: '1.2rem', color: 'var(--ink)' }}>₹{(totalPaise / 100).toFixed(2)}</b>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="chip"
              onClick={onClose}
              disabled={submitting}
              style={{ minHeight: 38 }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleSubmit}
              disabled={submitting || items.length === 0 || !platformRef.trim()}
              style={{
                minHeight: 38,
                padding: '0 20px',
                background: platform === 'swiggy' ? '#fc8019' : '#e23744',
                borderColor: platform === 'swiggy' ? '#fc8019' : '#e23744',
                color: '#fff',
                fontWeight: 700,
              }}
            >
              {submitting ? 'Submitting…' : `Send to Kitchen (${platform === 'swiggy' ? 'Swiggy' : 'Zomato'})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
