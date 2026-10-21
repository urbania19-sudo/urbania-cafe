'use client';

import { useState } from 'react';

interface TableOption {
  id: string;
  table_number: number;
  label: string;
}

interface MenuItemOption {
  id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
}

interface OrderItemRow {
  isCustom: boolean;
  menuItemId?: string;
  name: string;
  unitPriceRupees: number;
  quantity: number;
  note?: string;
}

export default function ManualOrderModal({
  tables = [],
  menuItems = [],
  onClose,
  onSuccess,
}: {
  tables?: TableOption[];
  menuItems?: MenuItemOption[];
  onClose: () => void;
  onSuccess: (order: { order_id: string; order_number: number; total_paise: number }) => void;
}) {
  const [serviceMode, setServiceMode] = useState<'dine_in' | 'takeaway' | 'counter' | 'delivery'>('dine_in');
  const [tableId, setTableId] = useState<string>(tables[0]?.id || '');
  const [customerName, setCustomerName] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [guestCount, setGuestCount] = useState(1);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New item draft inputs
  const [selectedMenuItemId, setSelectedMenuItemId] = useState<string>(menuItems[0]?.id || '');
  const [customName, setCustomName] = useState('');
  const [customPriceRupees, setCustomPriceRupees] = useState<string>('');
  const [customNote, setCustomNote] = useState('');
  const [customQty, setCustomQty] = useState(1);
  const [isAddingCustom, setIsAddingCustom] = useState(false);

  function addCatalogueItem() {
    const item = menuItems.find((m) => m.id === selectedMenuItemId);
    if (!item) return;

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

  function addCustomLineItem() {
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
        quantity: Math.max(1, Math.min(20, customQty)),
        note: customNote.trim() || undefined,
      },
    ]);

    setCustomName('');
    setCustomPriceRupees('');
    setCustomNote('');
    setCustomQty(1);
    setIsAddingCustom(false);
    setError(null);
  }

  function updateQuantity(idx: number, delta: number) {
    setItems((prev) => {
      const copy = [...prev];
      const item = copy[idx];
      if (!item) return prev;
      const n = item.quantity + delta;
      if (n <= 0) {
        copy.splice(idx, 1);
      } else {
        copy[idx] = { ...item, quantity: Math.min(20, n) };
      }
      return copy;
    });
  }

  const totalPaise = items.reduce((acc, i) => acc + Math.round(i.unitPriceRupees * 100) * i.quantity, 0);

  async function handleSubmit(autoBill: boolean = true) {
    if (items.length === 0) {
      setError('Please add at least one item to the order.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        serviceMode,
        tableId: serviceMode === 'dine_in' ? tableId || null : null,
        customerName: customerName.trim() || undefined,
        customerNote: customerNote.trim() || undefined,
        guestCount,
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
        throw new Error(data.error || 'Failed to create order');
      }

      onSuccess(data);
    } catch (err) {
      console.error('Manual order submit error:', err);
      setError(err instanceof Error ? err.message : 'Could not create order.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        zIndex: 1001,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 580,
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: 24,
          borderRadius: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontFamily: 'Georgia,serif', margin: 0, fontSize: '1.6rem' }}>
            New Counter / Custom Order
          </h2>
          <button type="button" className="chip" onClick={onClose} disabled={submitting}>
            ✕ Cancel
          </button>
        </div>

        {error && (
          <div role="alert" style={{ padding: 10, borderLeft: '3px solid #ef4444', marginBottom: 14, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Service Mode Selection */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Service Mode
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['dine_in', '🪑 Dine-in'],
                ['takeaway', '🥡 Takeaway'],
                ['counter', '🛎️ Counter'],
                ['delivery', '🛵 Delivery'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className="chip"
                onClick={() => setServiceMode(mode)}
                style={{
                  background: serviceMode === mode ? 'var(--accent)' : 'transparent',
                  color: serviceMode === mode ? '#ffffff' : 'inherit',
                  borderColor: serviceMode === mode ? 'var(--accent)' : 'var(--line)',
                  fontWeight: serviceMode === mode ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table Selection for Dine-in */}
        {serviceMode === 'dine_in' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Select Table</label>
              <select
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: '#1a1a1a',
                  color: 'inherit',
                }}
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} (Table {t.table_number})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Guest Count</label>
              <input
                type="number"
                min={1}
                max={20}
                value={guestCount}
                onChange={(e) => setGuestCount(parseInt(e.target.value, 10) || 1)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: 'transparent',
                  color: 'inherit',
                }}
              />
            </div>
          </div>
        )}

        {/* Customer Details */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Customer Name (Optional)</label>
            <input
              type="text"
              placeholder={serviceMode === 'takeaway' ? 'e.g. Priya (Takeaway)' : 'e.g. Walk-in Guest'}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'transparent',
                color: 'inherit',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Order Note (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Parcel box / Less ice"
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'transparent',
                color: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Item Selection Section */}
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginBottom: 14 }}>
          <strong style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Add Items to Order</strong>

          {/* Quick Catalogue Item Picker */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select
              value={selectedMenuItemId}
              onChange={(e) => setSelectedMenuItemId(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: '#1a1a1a',
                color: 'inherit',
              }}
            >
              {menuItems.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — ₹{(m.price_paise / 100).toFixed(2)}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={addCatalogueItem}>
              + Add Item
            </button>
          </div>

          {/* Custom Line Item Toggle / Form */}
          {!isAddingCustom ? (
            <button
              type="button"
              className="chip"
              onClick={() => setIsAddingCustom(true)}
              style={{ fontSize: 11, color: 'var(--accent)' }}
            >
              + Add Permitted Custom Line Item (Non-Catalogue)
            </button>
          ) : (
            <div style={{ padding: 12, background: '#ffffff08', borderRadius: 8, marginTop: 8 }}>
              <strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Custom Dish or Charge</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 8 }}>
                <input
                  type="text"
                  placeholder="Custom Item Name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'transparent',
                    color: 'inherit',
                  }}
                />
                <input
                  type="number"
                  step="1"
                  min="0"
                  placeholder="Price (₹)"
                  value={customPriceRupees}
                  onChange={(e) => setCustomPriceRupees(e.target.value)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'transparent',
                    color: 'inherit',
                  }}
                />
                <input
                  type="number"
                  min="1"
                  max="20"
                  placeholder="Qty"
                  value={customQty}
                  onChange={(e) => setCustomQty(parseInt(e.target.value, 10) || 1)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'transparent',
                    color: 'inherit',
                  }}
                />
              </div>
              <input
                type="text"
                placeholder="Optional Note for custom item"
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: 'transparent',
                  color: 'inherit',
                  marginBottom: 8,
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="chip" onClick={addCustomLineItem} style={{ color: 'var(--accent)' }}>
                  Add Custom Item
                </button>
                <button type="button" className="chip" onClick={() => setIsAddingCustom(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Selected Items List */}
        <div style={{ marginBottom: 16 }}>
          <strong style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
            Selected Items ({items.length})
          </strong>

          {items.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0' }}>
              No items added yet. Select a catalogue item above or create a custom line item.
            </p>
          ) : (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
              {items.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderBottom: idx < items.length - 1 ? '1px solid var(--line)' : 'none',
                    fontSize: 13,
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{item.name}</strong>
                    {item.isCustom && <span className="chip" style={{ fontSize: 9, marginLeft: 6 }}>Custom</span>}
                    {item.note && <div className="muted" style={{ fontSize: 11 }}>Note: {item.note}</div>}
                    <div className="muted" style={{ fontSize: 11 }}>₹{item.unitPriceRupees.toFixed(2)} each</div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => updateQuantity(idx, -1)}
                      style={{ padding: '2px 8px' }}
                    >
                      -
                    </button>
                    <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{item.quantity}</span>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => updateQuantity(idx, 1)}
                      style={{ padding: '2px 8px' }}
                    >
                      +
                    </button>
                    <span style={{ fontWeight: 700, minWidth: 65, textAlign: 'right' }}>
                      ₹{(item.unitPriceRupees * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: '#ffffff08',
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                <span>Total Amount:</span>
                <span>₹{(totalPaise / 100).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Submit Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <button type="button" className="chip" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={submitting || items.length === 0}
            onClick={() => handleSubmit(true)}
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            {submitting ? 'Creating...' : 'Create & Generate Bill'}
          </button>
        </div>
      </div>
    </div>
  );
}
