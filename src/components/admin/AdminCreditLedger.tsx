'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface AdminUser {
  user_id: string;
  email: string;
  role: string;
  display_name: string;
}

interface MenuItemOption {
  id: string;
  name: string;
  price_delta_paise: number;
}

interface MenuItem {
  id: string;
  name: string;
  price_paise: number;
  options?: MenuItemOption[];
}

interface CreditOrderItem {
  id?: string;
  item_name_snapshot?: string;
  name?: string;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
  item_note?: string | null;
  is_custom?: boolean;
}

interface CreditOrder {
  id: string;
  order_number: number;
  status: string;
  total_paise: number;
  subtotal_paise: number;
  created_at: string;
  customer_name: string;
  customer_note?: string | null;
  admin_user_id: string;
  payment_status: 'unpaid' | 'partially_paid' | 'paid';
  paid_paise: number;
  order_items: CreditOrderItem[];
}

interface CreditSummary {
  totalOrders: number;
  overallTotalPaise: number;
  overallPaidPaise: number;
  overallOutstandingPaise: number;
  byAdmin: Record<string, {
    adminName: string;
    totalPaise: number;
    paidPaise: number;
    outstandingPaise: number;
    orderCount: number;
  }>;
}

export default function AdminCreditLedger({
  menuItems,
}: {
  menuItems: MenuItem[];
}) {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [orders, setOrders] = useState<CreditOrder[]>([]);
  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedAdminId, setSelectedAdminId] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [settlingOrder, setSettlingOrder] = useState<CreditOrder | null>(null);

  // New Order State
  const [newOrderAdminId, setNewOrderAdminId] = useState('');
  const [newOrderNote, setNewOrderNote] = useState('');
  const [selectedCartItems, setSelectedCartItems] = useState<{
    menuItemId: string;
    name: string;
    unitPricePaise: number;
    quantity: number;
    note: string;
    isCustom?: boolean;
  }[]>([]);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Custom Item Form in Order Modal
  const [showCustomItem, setShowCustomItem] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPriceRupees, setCustomPriceRupees] = useState('');

  // Settlement Form State
  const [settleAmountRupees, setSettleAmountRupees] = useState('');
  const [settleMethod, setSettleMethod] = useState<'cash' | 'card' | 'upi' | 'bank_transfer' | 'other'>('upi');
  const [settleNotes, setSettleNotes] = useState('');
  const [submittingSettle, setSubmittingSettle] = useState(false);

  // Load admins
  useEffect(() => {
    fetch('/api/admin/credit-orders/admins')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.admins) {
          setAdmins(data.admins);
          if (data.admins.length > 0 && !newOrderAdminId) {
            setNewOrderAdminId(data.admins[0].user_id);
          }
        }
      })
      .catch((err) => console.error('Failed to load admins:', err));
  }, [newOrderAdminId]);

  // Load orders & refresh state
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          adminUserId: selectedAdminId,
          paymentStatus,
        });
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        if (search.trim()) params.set('search', search.trim());

        const res = await fetch(`/api/admin/credit-orders?${params.toString()}`);
        const data = await res.json();
        if (ignore) return;
        if (!data.ok) throw new Error(data.error || 'Failed to load credit orders');
        setOrders(data.orders || []);
        setSummary(data.summary || null);
      } catch (err) {
        if (ignore) return;
        console.error('Failed to fetch credit orders:', err);
        setError(err instanceof Error ? err.message : 'Failed to load credit orders');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    fetchData();
    return () => {
      ignore = true;
    };
  }, [selectedAdminId, paymentStatus, startDate, endDate, search, refreshKey]);

  // Handle Cart
  const addItemToCart = (item: MenuItem) => {
    setSelectedCartItems((prev) => {
      const idx = prev.findIndex((i) => i.menuItemId === item.id && !i.isCustom);
      if (idx >= 0) {
        const copy = [...prev];
        const existing = copy[idx]!;
        copy[idx] = { ...existing, quantity: existing.quantity + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          menuItemId: item.id,
          name: item.name,
          unitPricePaise: item.price_paise,
          quantity: 1,
          note: '',
          isCustom: false,
        },
      ];
    });
  };

  const addCustomItemToCart = () => {
    const name = customName.trim();
    const priceRupees = parseFloat(customPriceRupees);
    if (!name || isNaN(priceRupees) || priceRupees < 0) return;

    setSelectedCartItems((prev) => [
      ...prev,
      {
        menuItemId: '',
        name,
        unitPricePaise: Math.round(priceRupees * 100),
        quantity: 1,
        note: '',
        isCustom: true,
      },
    ]);

    setCustomName('');
    setCustomPriceRupees('');
    setShowCustomItem(false);
  };

  const removeCartItem = (index: number) => {
    setSelectedCartItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCartQty = (index: number, delta: number) => {
    setSelectedCartItems((prev) => {
      const copy = [...prev];
      const item = copy[index]!;
      const newQty = item.quantity + delta;
      if (newQty <= 0) {
        return prev.filter((_, i) => i !== index);
      }
      copy[index] = { ...item, quantity: newQty };
      return copy;
    });
  };

  const cartTotalPaise = selectedCartItems.reduce((acc, i) => acc + i.unitPricePaise * i.quantity, 0);

  // Submit new Admin Credit Order
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrderAdminId || selectedCartItems.length === 0) return;
    setSubmittingOrder(true);
    try {
      const res = await fetch('/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminUserId: newOrderAdminId,
          customerNote: newOrderNote.trim() || null,
          items: selectedCartItems.map((i) => ({
            menuItemId: i.isCustom ? null : i.menuItemId,
            name: i.name,
            quantity: i.quantity,
            unitPricePaise: i.unitPricePaise,
            note: i.note.trim() || null,
            isCustom: i.isCustom,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create admin credit order');

      setShowCreateModal(false);
      setSelectedCartItems([]);
      setNewOrderNote('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating credit order');
    } finally {
      setSubmittingOrder(false);
    }
  };

  // Open Settlement Modal
  const openSettleModal = (order: CreditOrder) => {
    setSettlingOrder(order);
    const outstandingPaise = Math.max(0, order.total_paise - order.paid_paise);
    setSettleAmountRupees((outstandingPaise / 100).toFixed(2));
    setSettleMethod('upi');
    setSettleNotes('');
  };

  // Submit Settlement
  const handleSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingOrder) return;
    const amountVal = parseFloat(settleAmountRupees);
    if (isNaN(amountVal) || amountVal <= 0) {
      alert('Enter a valid settlement amount greater than 0');
      return;
    }

    setSubmittingSettle(true);
    try {
      const res = await fetch('/api/admin/credit-orders/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: settlingOrder.id,
          amountPaise: Math.round(amountVal * 100),
          paymentMethod: settleMethod,
          notes: settleNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record payment settlement');

      setSettlingOrder(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error settling payment');
    } finally {
      setSubmittingSettle(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: 'Georgia,serif', fontSize: '1.8rem', margin: '0 0 4px' }}>
            Internal Admin Credit Ledger
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Tracks internal consumption for registered owners and administrators.
          </p>
        </div>
        <button
          className="btn"
          onClick={() => setShowCreateModal(true)}
          style={{ fontWeight: 700 }}
        >
          + New Admin Order
        </button>
      </div>

      {/* Summary KPI Cards */}
      {summary && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <div className="card" style={{ padding: 18, borderTop: '3px solid #f59e0b' }}>
            <span className="muted" style={{ fontSize: 12 }}>Total Outstanding</span>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: '2.1rem', margin: '6px 0 2px', color: '#f59e0b' }}>
              ₹{(summary.overallOutstandingPaise / 100).toFixed(2)}
            </div>
            <small className="muted">Pending settlement across all admins</small>
          </div>

          <div className="card" style={{ padding: 18, borderTop: '3px solid #10b981' }}>
            <span className="muted" style={{ fontSize: 12 }}>Total Settled</span>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: '2.1rem', margin: '6px 0 2px' }}>
              ₹{(summary.overallPaidPaise / 100).toFixed(2)}
            </div>
            <small className="muted">Actual payments received</small>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <span className="muted" style={{ fontSize: 12 }}>Total Consumption</span>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: '2.1rem', margin: '6px 0 2px' }}>
              ₹{(summary.overallTotalPaise / 100).toFixed(2)}
            </div>
            <small className="muted">{summary.totalOrders} internal credit orders</small>
          </div>
        </section>
      )}

      {/* Per-Admin Outstanding Balances */}
      {summary && Object.keys(summary.byAdmin).length > 0 && (
        <section className="card" style={{ padding: 16 }}>
          <strong style={{ display: 'block', fontSize: 14, marginBottom: 12 }}>
            Outstanding Balances by Administrator
          </strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {Object.entries(summary.byAdmin).map(([adminId, item]) => (
              <div
                key={adminId}
                style={{
                  padding: 14,
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: 'rgba(255,255,255,0.03)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{item.adminName}</div>
                  <small className="muted">{item.orderCount} orders · Settled: ₹{(item.paidPaise / 100).toFixed(2)}</small>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: item.outstandingPaise > 0 ? '#f59e0b' : '#10b981' }}>
                    ₹{(item.outstandingPaise / 100).toFixed(2)}
                  </div>
                  <small className="muted">Balance</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filter and Search Bar */}
      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Filter Admin</label>
            <select
              value={selectedAdminId}
              onChange={(e) => setSelectedAdminId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: '#1a1a1a',
                color: 'inherit',
              }}
            >
              <option value="all">All Administrators</option>
              {admins.map((a) => (
                <option key={a.user_id} value={a.user_id}>
                  {a.display_name} ({a.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Payment Status</label>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: '#1a1a1a',
                color: 'inherit',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="unpaid">Unpaid Only</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="paid">Fully Paid</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
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
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
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
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Search</label>
            <input
              type="text"
              placeholder="Order # or Name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'transparent',
                color: 'inherit',
              }}
            />
          </div>
        </div>
      </section>

      {/* Orders Table */}
      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }} className="muted">
            Loading admin credit records…
          </div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#ef4444' }}>
            Error: {error}
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center' }}>
            <p style={{ fontFamily: 'Georgia,serif', fontSize: '1.25rem', margin: '0 0 6px' }}>
              No credit orders found
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              Internal admin credit orders will appear here.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '12px 16px' }}>Order #</th>
                  <th style={{ padding: '12px 16px' }}>Date</th>
                  <th style={{ padding: '12px 16px' }}>Administrator</th>
                  <th style={{ padding: '12px 16px' }}>Dishes &amp; Items</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Total</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Settled</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Outstanding</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((ord) => {
                  const outstanding = Math.max(0, ord.total_paise - ord.paid_paise);
                  const isPaid = ord.payment_status === 'paid' || outstanding === 0;
                  const isPartial = ord.payment_status === 'partially_paid';

                  return (
                    <tr key={ord.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>#{ord.order_number}</td>
                      <td style={{ padding: '12px 16px' }} className="muted">
                        {new Date(ord.created_at).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>{ord.customer_name}</td>
                      <td style={{ padding: '12px 16px', maxWidth: 260 }}>
                        <span style={{ fontSize: 13 }}>
                          {(ord.order_items || [])
                            .map((i) => `${i.quantity}× ${i.item_name_snapshot || i.name}`)
                            .join(', ')}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>
                        ₹{(ord.total_paise / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#10b981' }}>
                        ₹{(ord.paid_paise / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: outstanding > 0 ? '#f59e0b' : '#10b981' }}>
                        ₹{(outstanding / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span
                          className="chip"
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            borderColor: isPaid ? '#10b981' : isPartial ? '#f59e0b' : '#ef4444',
                            color: isPaid ? '#10b981' : isPartial ? '#f59e0b' : '#ef4444',
                          }}
                        >
                          {isPaid ? 'PAID' : isPartial ? 'PARTIAL' : 'UNPAID'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        {!isPaid ? (
                          <button
                            className="btn"
                            onClick={() => openSettleModal(ord)}
                            style={{ fontSize: 12, padding: '4px 10px' }}
                          >
                            Settle
                          </button>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>Settled</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Settle Payment Modal */}
      {settlingOrder && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div className="card" style={{ maxWidth: 420, width: '100%', padding: 24 }}>
            <h3 style={{ fontFamily: 'Georgia,serif', margin: '0 0 8px' }}>
              Record Payment Settlement
            </h3>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 16px' }}>
              Order #{settlingOrder.order_number} · {settlingOrder.customer_name}
            </p>

            <div style={{ background: 'rgba(255,255,255,0.04)', padding: 12, borderRadius: 6, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span className="muted">Order Total:</span>
                <span>₹{(settlingOrder.total_paise / 100).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span className="muted">Already Settled:</span>
                <span style={{ color: '#10b981' }}>₹{(settlingOrder.paid_paise / 100).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700 }}>
                <span>Remaining Balance:</span>
                <span style={{ color: '#f59e0b' }}>
                  ₹{((settlingOrder.total_paise - settlingOrder.paid_paise) / 100).toFixed(2)}
                </span>
              </div>
            </div>

            <form onSubmit={handleSettle} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
                  Payment Amount (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={((settlingOrder.total_paise - settlingOrder.paid_paise) / 100).toFixed(2)}
                  value={settleAmountRupees}
                  onChange={(e) => setSettleAmountRupees(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'transparent',
                    color: 'inherit',
                    fontSize: 16,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
                  Payment Method
                </label>
                <select
                  value={settleMethod}
                  onChange={(e) => setSettleMethod(e.target.value as typeof settleMethod)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: '#1a1a1a',
                    color: 'inherit',
                  }}
                >
                  <option value="upi">UPI (GPay, PhonePe, Paytm)</option>
                  <option value="cash">Cash Received</option>
                  <option value="card">Debit / Credit Card</option>
                  <option value="bank_transfer">Bank Transfer (NEFT/IMPS)</option>
                  <option value="other">Other / Reconciliation</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
                  Notes / Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. UTR / Transaction ID or cash note"
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'transparent',
                    color: 'inherit',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setSettlingOrder(null)}
                  disabled={submittingSettle}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={submittingSettle}
                >
                  {submittingSettle ? 'Recording…' : 'Record Settlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Admin Credit Order Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 620,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 24,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontFamily: 'Georgia,serif', margin: 0 }}>
                New Admin Credit Order
              </h3>
              <button className="chip" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateOrder} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4, fontWeight: 600 }}>
                  Select Administrator
                </label>
                <select
                  value={newOrderAdminId}
                  onChange={(e) => setNewOrderAdminId(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: '#1a1a1a',
                    color: 'inherit',
                    fontSize: 14,
                  }}
                >
                  {admins.map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.display_name} ({a.role} · {a.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Dish Selector */}
              <div>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 6, fontWeight: 600 }}>
                  Add Menu Dishes
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: 8,
                    maxHeight: 180,
                    overflowY: 'auto',
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    padding: 8,
                  }}
                >
                  {menuItems.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => addItemToCart(item)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--line)',
                        background: 'rgba(255,255,255,0.02)',
                        color: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </div>
                      <span className="muted">₹{(item.price_paise / 100).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Item Trigger */}
              <div>
                {!showCustomItem ? (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setShowCustomItem(true)}
                    style={{ fontSize: 12 }}
                  >
                    + Add Custom Dish / Item
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Item name"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      style={{ flex: 2, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', color: 'inherit' }}
                    />
                    <input
                      type="number"
                      placeholder="Price (₹)"
                      value={customPriceRupees}
                      onChange={(e) => setCustomPriceRupees(e.target.value)}
                      style={{ width: 90, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', color: 'inherit' }}
                    />
                    <button type="button" className="btn" onClick={addCustomItemToCart} style={{ fontSize: 12, padding: '6px 12px' }}>
                      Add
                    </button>
                    <button type="button" className="chip" onClick={() => setShowCustomItem(false)}>Cancel</button>
                  </div>
                )}
              </div>

              {/* Selected Items Cart */}
              <div>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4, fontWeight: 600 }}>
                  Selected Items ({selectedCartItems.length})
                </label>
                {selectedCartItems.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13, padding: 12, border: '1px dashed var(--line)', borderRadius: 6, textAlign: 'center' }}>
                    No items selected yet. Tap menu dishes above to add them.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedCartItems.map((cartItem, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 10px',
                          border: '1px solid var(--line)',
                          borderRadius: 6,
                          fontSize: 13,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <b>{cartItem.name}</b> {cartItem.isCustom && <span className="chip" style={{ fontSize: 10, padding: '1px 4px' }}>CUSTOM</span>}
                          <div className="muted" style={{ fontSize: 11 }}>
                            ₹{(cartItem.unitPricePaise / 100).toFixed(2)} each
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            className="chip"
                            onClick={() => updateCartQty(idx, -1)}
                            style={{ padding: '2px 8px' }}
                          >
                            -
                          </button>
                          <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'center' }}>
                            {cartItem.quantity}
                          </span>
                          <button
                            type="button"
                            className="chip"
                            onClick={() => updateCartQty(idx, 1)}
                            style={{ padding: '2px 8px' }}
                          >
                            +
                          </button>
                          <span style={{ minWidth: 65, textAlign: 'right', fontWeight: 600 }}>
                            ₹{((cartItem.unitPricePaise * cartItem.quantity) / 100).toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeCartItem(idx)}
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}

                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 4px 0', fontWeight: 700, fontSize: 16 }}>
                      <span>Order Total:</span>
                      <span style={{ color: '#f59e0b' }}>₹{(cartTotalPaise / 100).toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
                  Order Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Tasting note or internal memo"
                  value={newOrderNote}
                  onChange={(e) => setNewOrderNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'transparent',
                    color: 'inherit',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setShowCreateModal(false)}
                  disabled={submittingOrder}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={submittingOrder || selectedCartItems.length === 0}
                >
                  {submittingOrder ? 'Placing Order…' : `Place Credit Order (₹${(cartTotalPaise / 100).toFixed(2)})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
