'use client';

import { useState, useEffect } from 'react';

export interface TableOption {
  id: string;
  table_number: number;
  label: string;
}

export interface MenuItemOption {
  id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
  category_name?: string | null;
  category_id?: string | null;
}

export interface OrderItemRow {
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
  const [serviceMode, setServiceMode] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [tableId, setTableId] = useState<string>(tables[0]?.id || '');
  const [customerNote, setCustomerNote] = useState('');
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catalogue search & category filter state
  const [searchCatalogueQuery, setSearchCatalogueQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');

  // Custom Item Form State
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPriceRupees, setCustomPriceRupees] = useState<string>('');
  const [customNote, setCustomNote] = useState('');
  const [customQty, setCustomQty] = useState(1);

  // Available dishes from catalogue (only available items)
  const availableDishes = menuItems.filter((m) => m.is_available);

  // Distinct category names for filter chips
  const categories = [
    'ALL',
    ...Array.from(
      new Set(
        availableDishes
          .map((m) => m.category_name || 'Other')
          .filter(Boolean)
      )
    ),
  ];

  // Filtered dishes for browsing
  const filteredDishes = availableDishes.filter((m) => {
    if (selectedCategoryFilter !== 'ALL' && (m.category_name || 'Other') !== selectedCategoryFilter) {
      return false;
    }
    if (searchCatalogueQuery.trim()) {
      const q = searchCatalogueQuery.trim().toLowerCase();
      const matchName = m.name.toLowerCase().includes(q);
      const matchCat = (m.category_name || '').toLowerCase().includes(q);
      return matchName || matchCat;
    }
    return true;
  });

  function addOrIncrementCatalogueItem(menuItemId: string) {
    const item = menuItems.find((m) => m.id === menuItemId);
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

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
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
        customerName: undefined,
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
          maxWidth: 600,
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
            New Order
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

        {/* Form Body */}
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

          {/* Service Mode Selection (Dine-in / Takeaway Only) */}
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
          )}

          {/* Order Note */}
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

          {/* Searchable, Scrollable Menu Catalogue Browser */}
          <div style={{ display: 'grid', gap: 8, padding: '10px 0', borderTop: '1px solid var(--line, #3d2d24)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent, #c89f65)' }}>
                Menu Catalogue ({availableDishes.length} dishes available)
              </span>
              {searchCatalogueQuery && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => setSearchCatalogueQuery('')}
                  style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}
                >
                  Clear search
                </button>
              )}
            </div>

            {/* Category Filter Chips */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                overflowX: 'auto',
                paddingBottom: 4,
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {categories.map((cat) => {
                const isCatSelected = selectedCategoryFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    className="chip"
                    onClick={() => setSelectedCategoryFilter(cat)}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      whiteSpace: 'nowrap',
                      background: isCatSelected ? 'var(--accent, #c89f65)' : 'rgba(255,255,255,0.06)',
                      color: isCatSelected ? '#2b1b16' : 'inherit',
                      fontWeight: isCatSelected ? 700 : 500,
                      borderColor: isCatSelected ? 'var(--accent, #c89f65)' : 'var(--line, #ffffff18)',
                      cursor: 'pointer',
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Search Input Field */}
            <input
              type="text"
              aria-label="Search menu dishes"
              placeholder="Search catalogue by name or category (e.g. Fries, Sandwich, Chai)..."
              value={searchCatalogueQuery}
              onChange={(e) => setSearchCatalogueQuery(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--line, #3d2d24)',
                background: '#ffffff10',
                color: 'var(--ink, #f5ead9)',
                fontSize: 13,
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />

            {/* Scrollable Dish List Container */}
            <div
              style={{
                maxHeight: 220,
                overflowY: 'auto',
                borderRadius: 6,
                border: '1px solid var(--line, #3d2d24)',
                background: 'rgba(0,0,0,0.2)',
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {filteredDishes.length === 0 ? (
                <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 12, color: 'var(--muted, #999)' }}>
                  No dishes match &ldquo;{searchCatalogueQuery}&rdquo;. Try another term or add a custom dish below.
                </div>
              ) : (
                filteredDishes.map((m) => {
                  const existingInOrder = items.find((it) => !it.isCustom && it.menuItemId === m.id);
                  const inOrderQty = existingInOrder?.quantity ?? 0;

                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 4,
                        background: inOrderQty > 0 ? 'rgba(200, 159, 101, 0.1)' : 'rgba(255,255,255,0.04)',
                        border: inOrderQty > 0 ? '1px solid rgba(200, 159, 101, 0.3)' : '1px solid transparent',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>🍽️ {m.name}</span>
                          {m.category_name && (
                            <span className="chip" style={{ fontSize: 10, padding: '1px 5px', color: 'var(--muted, #a89485)' }}>
                              {m.category_name}
                            </span>
                          )}
                          <span style={{ fontSize: 12, color: 'var(--accent, #c89f65)' }}>
                            ₹{(m.price_paise / 100).toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {inOrderQty > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent, #c89f65)' }}>
                            {inOrderQty} in order
                          </span>
                        )}
                        <button
                          type="button"
                          className="chip"
                          aria-label={`Add ${m.name} to order`}
                          onClick={() => addOrIncrementCatalogueItem(m.id)}
                          style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            fontWeight: 700,
                            background: inOrderQty > 0 ? 'rgba(255,255,255,0.1)' : 'var(--accent, #c89f65)',
                            color: inOrderQty > 0 ? 'inherit' : '#2b1b16',
                            cursor: 'pointer',
                          }}
                          title={`Add ${m.name} to order`}
                        >
                          {inOrderQty > 0 ? '+ Add Another' : '+ Add'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Custom Line Item Toggle / Form */}
            {!isAddingCustom ? (
              <button
                type="button"
                className="chip"
                onClick={() => setIsAddingCustom(true)}
                style={{ fontSize: 12, color: 'var(--accent, #c89f65)', padding: '6px 12px', marginTop: 4, width: 'fit-content' }}
              >
                + Add Permitted Custom Line Item (Non-Catalogue)
              </button>
            ) : (
              <div
                style={{
                  padding: 12,
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 8,
                  marginTop: 6,
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
                      gridColumn: 'span 2',
                      minHeight: 38,
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--line, #3d2d24)',
                      background: 'transparent',
                      color: 'inherit',
                      fontSize: 13,
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Price (₹)"
                    value={customPriceRupees}
                    onChange={(e) => setCustomPriceRupees(e.target.value)}
                    style={{
                      minHeight: 38,
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--line, #3d2d24)',
                      background: 'transparent',
                      color: 'inherit',
                      fontSize: 13,
                    }}
                  />
                  <input
                    type="number"
                    min={1}
                    max={20}
                    placeholder="Qty"
                    value={customQty}
                    onChange={(e) => setCustomQty(parseInt(e.target.value, 10) || 1)}
                    style={{
                      minHeight: 38,
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--line, #3d2d24)',
                      background: 'transparent',
                      color: 'inherit',
                      fontSize: 13,
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
                    minHeight: 38,
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line, #3d2d24)',
                    background: 'transparent',
                    color: 'inherit',
                    marginBottom: 8,
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={addCustomLineItem}
                    style={{ minHeight: 38, padding: '6px 16px', fontSize: 13 }}
                  >
                    Add Custom Item
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setIsAddingCustom(false)}
                    style={{ minHeight: 38, padding: '6px 12px', fontSize: 13 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Selected Items List (Edit Order Style) */}
          <div>
            <strong style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
              Selected Items ({items.length})
            </strong>

            {items.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: '8px 0' }}>
                No items added yet. Select a dish from the catalogue above or create a custom line item.
              </p>
            ) : (
              <div style={{ border: '1px solid var(--line, #3d2d24)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ maxHeight: 240, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  {items.map((item, idx) => (
                    <div
                      key={item.isCustom ? `custom-${idx}` : item.menuItemId || idx}
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
                          <span className="chip" style={{ fontSize: 9, padding: '1px 6px', marginTop: 2, display: 'inline-block' }}>
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
                            minWidth: 32,
                            minHeight: 32,
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 16,
                            cursor: 'pointer',
                          }}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span style={{ fontWeight: 700, minWidth: 24, textAlign: 'center' }}>
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => updateQuantity(idx, 1)}
                          style={{
                            minWidth: 32,
                            minHeight: 32,
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
                        <button
                          type="button"
                          className="chip"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => removeItem(idx)}
                          style={{ fontSize: 11, padding: '4px 8px', color: '#ef4444', cursor: 'pointer' }}
                          title="Remove item"
                        >
                          ✕
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
                  <span data-testid="manual-order-total-amount">₹{(totalPaise / 100).toFixed(2)}</span>
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
            style={{ minHeight: 44, padding: '10px 16px', fontWeight: 600, cursor: 'pointer' }}
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
              cursor: submitting || items.length === 0 ? 'not-allowed' : 'pointer',
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
