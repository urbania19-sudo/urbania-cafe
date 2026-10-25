'use client';

import { useState, useEffect } from 'react';

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
  onSuccess: (
    order: { order_id: string; order_number: number; total_paise: number }
  ) => void;
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  async function handleSubmit() {
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
      aria-labelledby="manual-order-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: 'calc(16px + env(safe-area-inset-top, 0px)) 12px calc(16px + env(safe-area-inset-bottom, 0px)) 12px',
        zIndex: 1001,
        boxSizing: 'border-box',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 580,
          margin: 'auto 0',
          backgroundColor: 'var(--card, #1c1512)',
          border: '1px solid var(--line, #3d2d24)',
          borderRadius: 12,
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 18px',
            borderBottom: '1px solid var(--line, #3d2d24)',
            gap: 12,
          }}
        >
          <h2
            id="manual-order-modal-title"
            style={{
              fontFamily: 'Georgia, serif',
              margin: 0,
              fontSize: '1.25rem',
              lineHeight: 1.3,
              fontWeight: 700,
            }}
          >
            New Counter / Custom Order
          </h2>
          <button
            type="button"
            className="chip"
            onClick={onClose}
            disabled={submitting}
            style={{
              minHeight: 36,
              padding: '6px 14px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            aria-label="Close dialog"
          >
            ✕ Cancel
          </button>
        </div>

        {/* Form Body (Standard Flow - Rock Solid across all WebViews) */}
        <div
          style={{
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxSizing: 'border-box',
          }}
        >
          {error && (
            <div
              role="alert"
              style={{
                padding: '10px 14px',
                borderLeft: '4px solid #ef4444',
                background: 'rgba(239, 68, 68, 0.1)',
                fontSize: 13,
                borderRadius: 4,
              }}
            >
              {error}
            </div>
          )}

          {/* Service Mode Selection (2x2 Grid) */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 8,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--muted, #d7c3ab)',
              }}
            >
              Service Mode
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
                width: '100%',
              }}
            >
              {(
                [
                  ['dine_in', '🪑 Dine-in'],
                  ['takeaway', '🥡 Takeaway'],
                  ['counter', '🛎️ Counter'],
                  ['delivery', '🛵 Delivery'],
                ] as const
              ).map(([mode, label]) => {
                const isActive = serviceMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    className="chip"
                    onClick={() => setServiceMode(mode)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 44,
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: isActive ? 'var(--accent, #c89f65)' : 'rgba(255,255,255,0.04)',
                      color: isActive ? '#2b1b16' : 'inherit',
                      borderColor: isActive ? 'var(--accent, #c89f65)' : 'var(--line, #3d2d24)',
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      fontSize: 13,
                      boxSizing: 'border-box',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Table Selection for Dine-in */}
          {serviceMode === 'dine_in' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 10,
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>
                  Select Table
                </label>
                <select
                  value={tableId}
                  onChange={(e) => setTableId(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line, #3d2d24)',
                    background: '#1a1a1a',
                    color: 'inherit',
                    boxSizing: 'border-box',
                    fontSize: 13,
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
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>
                  Guest Count
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={guestCount}
                  onChange={(e) => setGuestCount(parseInt(e.target.value, 10) || 1)}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line, #3d2d24)',
                    background: 'transparent',
                    color: 'inherit',
                    boxSizing: 'border-box',
                    fontSize: 13,
                  }}
                />
              </div>
            </div>
          )}

          {/* Customer Details */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 10,
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>
                Customer Name (Optional)
              </label>
              <input
                type="text"
                placeholder={serviceMode === 'takeaway' ? 'e.g. Priya (Takeaway)' : 'e.g. Walk-in Guest'}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--line, #3d2d24)',
                  background: 'transparent',
                  color: 'inherit',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>
                Order Note (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Parcel box / Less ice"
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--line, #3d2d24)',
                  background: 'transparent',
                  color: 'inherit',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          {/* Item Selection Section */}
          <div style={{ borderTop: '1px solid var(--line, #3d2d24)', paddingTop: 14 }}>
            <strong style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
              Add Items to Order
            </strong>

            {/* Quick Catalogue Item Picker */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <select
                value={selectedMenuItemId}
                onChange={(e) => setSelectedMenuItemId(e.target.value)}
                style={{
                  flex: '1 1 200px',
                  minHeight: 44,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--line, #3d2d24)',
                  background: '#1a1a1a',
                  color: 'inherit',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              >
                {menuItems.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — ₹{(m.price_paise / 100).toFixed(2)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={addCatalogueItem}
                style={{ minHeight: 44, whiteSpace: 'nowrap', flex: '0 0 auto' }}
              >
                + Add Item
              </button>
            </div>

            {/* Custom Line Item Toggle / Form */}
            {!isAddingCustom ? (
              <button
                type="button"
                className="chip"
                onClick={() => setIsAddingCustom(true)}
                style={{ fontSize: 12, color: 'var(--accent, #c89f65)', padding: '6px 12px' }}
              >
                + Add Permitted Custom Line Item (Non-Catalogue)
              </button>
            ) : (
              <div
                style={{
                  padding: 12,
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 8,
                  marginTop: 8,
                  border: '1px solid var(--line, #3d2d24)',
                }}
              >
                <strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  Custom Dish or Charge
                </strong>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="text"
                    placeholder="Custom Item Name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--line, #3d2d24)',
                      background: 'transparent',
                      color: 'inherit',
                      boxSizing: 'border-box',
                      fontSize: 13,
                      minHeight: 40,
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
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--line, #3d2d24)',
                      background: 'transparent',
                      color: 'inherit',
                      boxSizing: 'border-box',
                      fontSize: 13,
                      minHeight: 40,
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
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--line, #3d2d24)',
                      background: 'transparent',
                      color: 'inherit',
                      boxSizing: 'border-box',
                      fontSize: 13,
                      minHeight: 40,
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
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line, #3d2d24)',
                    background: 'transparent',
                    color: 'inherit',
                    marginBottom: 8,
                    boxSizing: 'border-box',
                    fontSize: 13,
                    minHeight: 40,
                  }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="chip"
                    onClick={addCustomLineItem}
                    style={{ color: 'var(--accent, #c89f65)', fontWeight: 600, minHeight: 38 }}
                  >
                    Add Custom Item
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setIsAddingCustom(false)}
                    style={{ minHeight: 38 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Selected Items List */}
          <div>
            <strong style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
              Selected Items ({items.length})
            </strong>

            {items.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: '8px 0' }}>
                No items added yet. Select a catalogue item above or create a custom line item.
              </p>
            ) : (
              <div style={{ border: '1px solid var(--line, #3d2d24)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ maxHeight: 240, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 12px',
                        borderBottom: idx < items.length - 1 ? '1px solid var(--line, #3d2d24)' : 'none',
                        fontSize: 13,
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                        <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{item.name}</div>
                        {item.isCustom && (
                          <span className="chip" style={{ fontSize: 9, marginLeft: 0, marginTop: 2, display: 'inline-block' }}>
                            Custom
                          </span>
                        )}
                        {item.note && (
                          <div className="muted" style={{ fontSize: 11, wordBreak: 'break-word' }}>
                            Note: {item.note}
                          </div>
                        )}
                        <div className="muted" style={{ fontSize: 11 }}>₹{item.unitPriceRupees.toFixed(2)} each</div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => updateQuantity(idx, -1)}
                          style={{
                            minWidth: 36,
                            minHeight: 36,
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 16,
                            cursor: 'pointer',
                          }}
                          aria-label="Decrease quantity"
                        >
                          -
                        </button>
                        <span style={{ fontWeight: 700, minWidth: 24, textAlign: 'center' }}>
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => updateQuantity(idx, 1)}
                          style={{
                            minWidth: 36,
                            minHeight: 36,
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 16,
                            cursor: 'pointer',
                          }}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                        <span style={{ fontWeight: 700, minWidth: 70, textAlign: 'right' }}>
                          ₹{(item.unitPriceRupees * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Order Total */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: 'rgba(255,255,255,0.05)',
                    fontWeight: 700,
                    fontSize: 15,
                    borderTop: '1px solid var(--line, #3d2d24)',
                  }}
                >
                  <span>Total Amount:</span>
                  <span>₹{(totalPaise / 100).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submit Actions (Footer) */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            alignItems: 'center',
            borderTop: '1px solid var(--line, #3d2d24)',
            padding: '14px 18px',
            background: 'var(--card, #1c1512)',
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
          }}
        >
          <button
            type="button"
            className="chip"
            onClick={onClose}
            disabled={submitting}
            style={{ minHeight: 44, padding: '10px 16px', fontWeight: 600 }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={submitting || items.length === 0}
            onClick={handleSubmit}
            style={{
              backgroundColor: 'var(--accent, #c89f65)',
              color: '#2b1b16',
              minHeight: 44,
              padding: '10px 24px',
              fontWeight: 800,
              opacity: submitting || items.length === 0 ? 0.5 : 1,
            }}
          >
            {submitting ? 'Creating...' : 'Create Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
