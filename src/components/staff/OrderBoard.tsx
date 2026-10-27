'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Bill, type DiscountType } from '@/lib/billing';
import ThermalBillModal from '@/components/staff/ThermalBillModal';
import ManualOrderModal from '@/components/staff/ManualOrderModal';
import DeliveryPlatformOrderModal from '@/components/staff/DeliveryPlatformOrderModal';
import BillDiscountModal, { type BillConfirmPayload } from '@/components/staff/BillDiscountModal';
import CollectPaymentModal from '@/components/staff/CollectPaymentModal';
import { computeKitchenTicketDelta } from '@/lib/kitchen-tickets';
import type { KitchenTicketOrderItem } from '@/lib/thermal-canvas';

type Order = {
  id: string;
  order_number: number;
  status: string;
  customer_name: string | null;
  customer_note?: string | null;
  guest_count: number | null;
  total_paise: number;
  created_at: string;
  billed_at?: string | null;
  service_mode?: string | null;
  order_source?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  paid_paise?: number;
  external_platform_name?: string | null;
  external_platform_ref?: string | null;
  cafe_tables: { label: string } | null;
  order_items: {
    id?: string;
    menu_item_id: string | null;
    item_name_snapshot: string;
    quantity: number;
    unit_price_paise?: number;
    item_note?: string | null;
    is_custom?: boolean;
    selected_options?: { name: string }[];
    selected_options_snapshot?: { name: string }[];
  }[];
};

export type MenuItem = {
  id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
  category_id?: string | null;
  category_name?: string | null;
  category_sort_order?: number;
};

type TableOption = {
  id: string;
  table_number: number;
  label: string;
};

interface EditingItem {
  key: string;
  isCustom: boolean;
  menuItemId?: string;
  name: string;
  unitPricePaise: number;
  quantity: number;
  note?: string;
}

interface OrderEditState {
  id: string; // for backward compatibility
  orderId: string;
  items: EditingItem[];
  customName: string;
  customPriceRupees: string;
  customQty: number;
  customNote: string;
  showCustomForm: boolean;
  qty: Record<string, number>;
}

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
  initialKots = {},
}: {
  initial: Order[];
  menu: MenuItem[];
  tables?: TableOption[];
  initialKots?: Record<string, any>;
}) {
  const router = useRouter();
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<OrderEditState | null>(null);
  const [adding, setAdding] = useState('');
  const [activeBill, setActiveBill] = useState<{ bill: Bill; isReprint: boolean } | null>(null);
  const [billingOrder, setBillingOrder] = useState<Order | null>(null);
  const [collectingPayment, setCollectingPayment] = useState<{ order: Order; bill: Bill } | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'completed'>('all');
  const [kotsByOrderId, setKotsByOrderId] = useState<Record<string, any>>(initialKots);
  const [searchCatalogueQuery, setSearchCatalogueQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');

  function openKitchenTicket(order: Order, forceReprint: boolean = false) {
    const latestKot = kotsByOrderId[order.id];
    const delta = computeKitchenTicketDelta(
      (order.order_items || []) as unknown as KitchenTicketOrderItem[],
      latestKot?.full_order_snapshot
    );

    if (!forceReprint && delta.ticketType === 'none') {
      setError(`All items for Order #${order.order_number} have already been sent to the kitchen. Use Reprint Full for another copy.`);
      return;
    }

    router.push(`/staff/orders/${order.id}/kitchen-token/print${forceReprint ? '?reprint=true' : ''}`);
  }

  async function acknowledgeKitchenTicket(order: Order) {
    const latestKot = kotsByOrderId[order.id] ?? null;
    const currentItems = (order.order_items || []) as unknown as KitchenTicketOrderItem[];
    const delta = computeKitchenTicketDelta(currentItems, latestKot?.full_order_snapshot);
    if (delta.ticketType === 'none') {
      setError(`There are no pending kitchen items for Order #${order.order_number}.`);
      return;
    }

    setBusy(order.id);
    setError('');
    try {
      const response = await fetch(`/api/staff/orders/${order.id}/kitchen-token/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ticketType: delta.ticketType,
          itemsSnapshot: delta.deltaItems,
          fullOrderSnapshot: currentItems,
          expectedPreviousTicketId: latestKot?.id ?? null,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Could not mark this kitchen ticket as sent.');
      }
      setKotsByOrderId((previous) => ({ ...previous, [order.id]: data.ticket }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark this kitchen ticket as sent.');
    } finally {
      setBusy(undefined);
    }
  }

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
    const items: EditingItem[] = o.order_items.map((i, idx) => ({
      key: i.menu_item_id || `custom-${idx}`,
      isCustom: !i.menu_item_id || Boolean(i.is_custom),
      menuItemId: i.menu_item_id || undefined,
      name: i.item_name_snapshot,
      unitPricePaise: i.unit_price_paise ?? 0,
      quantity: i.quantity,
      note: i.item_note || '',
    }));

    setEditing({
      id: o.id,
      orderId: o.id,
      items,
      customName: '',
      customPriceRupees: '',
      customQty: 1,
      customNote: '',
      showCustomForm: false,
      qty: Object.fromEntries(
        o.order_items.filter((i) => i.menu_item_id).map((i) => [i.menu_item_id as string, i.quantity])
      ),
    });
  }

  function setQty(id: string, delta: number) {
    setEditing((e) => {
      if (!e) return e;
      const idx = e.items.findIndex((item) => item.menuItemId === id || item.key === id);
      if (idx === -1) return e;

      const currentItem = e.items[idx];
      if (!currentItem) return e;

      const newQty = currentItem.quantity + delta;
      let newItems: EditingItem[];
      if (newQty < 1) {
        newItems = e.items.filter((_, i) => i !== idx);
      } else {
        newItems = [...e.items];
        newItems[idx] = { ...currentItem, quantity: Math.min(newQty, 20) };
      }

      const newQtyMap: Record<string, number> = {};
      newItems.forEach((it) => {
        if (it.menuItemId) newQtyMap[it.menuItemId] = it.quantity;
      });

      return {
        ...e,
        items: newItems,
        qty: newQtyMap,
      };
    });
  }

  function addCatalogueItemToEdit(menuItemId: string) {
    const menuItem = menu.find((m) => m.id === menuItemId);
    if (!menuItem) return;

    setEditing((e) => {
      if (!e) return e;
      const existingIdx = e.items.findIndex((it) => !it.isCustom && it.menuItemId === menuItem.id);
      let newItems: EditingItem[];
      if (existingIdx >= 0) {
        newItems = [...e.items];
        const exist = newItems[existingIdx];
        if (exist) {
          newItems[existingIdx] = {
            ...exist,
            quantity: Math.min(exist.quantity + 1, 20),
          };
        }
      } else {
        newItems = [
          ...e.items,
          {
            key: menuItem.id,
            isCustom: false,
            menuItemId: menuItem.id,
            name: menuItem.name,
            unitPricePaise: menuItem.price_paise,
            quantity: 1,
            note: '',
          },
        ];
      }

      const newQtyMap: Record<string, number> = {};
      newItems.forEach((it) => {
        if (it.menuItemId) newQtyMap[it.menuItemId] = it.quantity;
      });

      return {
        ...e,
        items: newItems,
        qty: newQtyMap,
      };
    });
  }

  function addCustomItemToEdit() {
    if (!editing) return;
    const name = editing.customName.trim();
    const priceRupees = parseFloat(editing.customPriceRupees);
    if (!name) {
      setError('Please enter a name for the custom dish.');
      return;
    }
    if (isNaN(priceRupees) || priceRupees < 0) {
      setError('Custom dish price must be a valid non-negative number.');
      return;
    }
    const qty = Math.min(Math.max(1, editing.customQty), 20);

    const newItem: EditingItem = {
      key: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      isCustom: true,
      name,
      unitPricePaise: Math.round(priceRupees * 100),
      quantity: qty,
      note: editing.customNote.trim() || undefined,
    };

    setEditing((e) => {
      if (!e) return e;
      return {
        ...e,
        items: [...e.items, newItem],
        customName: '',
        customPriceRupees: '',
        customQty: 1,
        customNote: '',
        showCustomForm: false,
      };
    });
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.items.length) {
      return setError('An order needs at least one item. Use Reject to cancel it instead.');
    }
    setBusy(editing.orderId);
    setError('');

    const payloadItems = editing.items.map((it) => {
      if (it.isCustom) {
        return {
          isCustom: true,
          name: it.name,
          unitPricePaise: it.unitPricePaise,
          quantity: it.quantity,
          note: it.note || null,
        };
      }
      return {
        isCustom: false,
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        note: it.note || null,
      };
    });

    try {
      const r = await fetch(`/api/staff/orders/${editing.orderId}/items`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: payloadItems }),
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
        // Already billed: directly fetch existing bill (reprint mode, NO discount prompt)
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

      // Not yet billed: allow staff to apply optional discount before issuing
      setBillingOrder(o);
    } catch (err) {
      console.error('Receipt view error:', err);
      setError(err instanceof Error ? err.message : 'Could not open receipt.');
    } finally {
      setBusy(undefined);
    }
  }

  async function billOrderDirectly(
    orderId: string,
    payload?: BillConfirmPayload
  ) {
    setBusy(orderId);
    setError('');
    try {
      const res = await fetch(`/api/staff/orders/${orderId}/bill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          payload
            ? {
                discount_type: payload.discount?.type,
                discount_value: payload.discount?.value,
                payment_method: payload.paymentMethod,
                confirm_payment: payload.confirmPayment,
                paid_amount_rupees: payload.paidAmountRupees,
                idempotency_key: `bill-${orderId}-${Date.now()}`,
              }
            : {}
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === 'PREVIEW_READ_ONLY') {
          throw new Error('Preview mode is read-only to protect live café data.');
        }
        throw new Error(data.error || 'Failed to generate bill');
      }
      setActiveBill({
        bill: data.bill,
        isReprint: Boolean(data.already_issued),
      });
      router.refresh();
    } catch (err) {
      console.error('Billing error:', err);
      setError(err instanceof Error ? err.message : 'Could not generate bill.');
    } finally {
      setBusy(undefined);
    }
  }

  async function handleOpenCollectPayment(o: Order) {
    setBusy(o.id);
    setError('');
    try {
      const res = await fetch(`/api/staff/orders/${o.id}/bill`);
      const data = await res.json();
      if (!res.ok || !data.bill) {
        throw new Error(data.error || 'Could not load bill details for payment.');
      }
      setCollectingPayment({ order: o, bill: data.bill });
    } catch (err) {
      console.error('Error opening payment collection:', err);
      setError(err instanceof Error ? err.message : 'Could not open payment collection.');
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
            <button
              className="btn"
              onClick={() => setShowDeliveryModal(true)}
              style={{
                padding: '10px 20px',
                fontSize: 14,
                background: 'transparent',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
              }}
            >
              🛵 + Delivery Platform Order
            </button>
          </div>
        </section>

        {showManualModal && (
          <ManualOrderModal
            tables={tables}
            menuItems={menu}
            onClose={() => setShowManualModal(false)}
            onSuccess={(newOrder) => {
              setShowManualModal(false);
              setBillingOrder(null);
              router.refresh();
            }}
          />
        )}

        {showDeliveryModal && (
          <DeliveryPlatformOrderModal
            menuItems={menu}
            onClose={() => setShowDeliveryModal(false)}
            onSuccess={(newOrder) => {
              setShowDeliveryModal(false);
              setBillingOrder(null);
              router.refresh();
            }}
          />
        )}

        {billingOrder && (
          <BillDiscountModal
            orderNumber={billingOrder.order_number}
            subtotalPaise={billingOrder.total_paise}
            onClose={() => setBillingOrder(null)}
            onConfirm={async (discount) => {
              const targetOrderId = billingOrder.id;
              setBillingOrder(null);
              await billOrderDirectly(targetOrderId, discount);
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

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={() => setShowManualModal(true)}
            style={{ fontSize: 13, padding: '8px 16px' }}
          >
            + Counter / Takeaway Order
          </button>
          <button
            className="btn"
            onClick={() => setShowDeliveryModal(true)}
            style={{
              fontSize: 13,
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
            }}
          >
            🛵 + Delivery Platform Order
          </button>
        </div>
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
          const isCancelled = o.status === 'CANCELLED';
          const isBilled = Boolean(o.billed_at);
          const canViewReceipt = isCompleted || isBilled;
          const canEdit =
            !isBilled &&
            !isCompleted &&
            !isCancelled &&
            ['NEW', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status) &&
            editing?.orderId !== o.id;

          const latestKot = kotsByOrderId[o.id];
          const kotDelta = computeKitchenTicketDelta(
            (o.order_items || []) as unknown as KitchenTicketOrderItem[],
            latestKot?.full_order_snapshot
          );

          return (
            <article className="card staff-order-card" key={o.id} style={{ padding: 18, minWidth: 0 }}>
              <div
                className="staff-order-card-header"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'start',
                  flexWrap: 'wrap',
                }}
              >
                <div className="staff-order-card-details" style={{ minWidth: 0, flex: '1 1 240px' }}>
                  <span
                    style={{
                      color: 'var(--accent)',
                      fontSize: 12,
                      letterSpacing: '.12em',
                      fontWeight: 600,
                      display: 'block',
                      overflowWrap: 'break-word',
                      wordBreak: 'normal',
                    }}
                  >
                    {o.external_platform_name || ['swiggy', 'zomato', 'delivery_platform'].includes(o.order_source || '')
                      ? `${(o.external_platform_name || o.order_source || 'DELIVERY').toUpperCase()} · #${(o.external_platform_ref || '').replace(/^#/, '')}`
                      : o.order_source === 'admin_credit'
                      ? 'ADMIN CREDIT'
                      : o.cafe_tables?.label
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
                      wordBreak: 'normal',
                    }}
                  >
                    Order #{o.order_number}
                  </h2>
                  <p className="muted" style={{ margin: '0 0 4px', overflowWrap: 'break-word', wordBreak: 'normal' }}>
                    {o.customer_name || 'Guest'} · {o.guest_count ?? 1}{' '}
                    {o.guest_count === 1 ? 'person' : 'people'}
                  </p>
                </div>
                <div
                  className="staff-order-card-badges"
                  style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  {kotDelta.ticketType === 'new' && !isCancelled && (
                    <span className="chip" style={{ fontSize: 11, borderColor: '#f59e0b88', color: '#f59e0b', fontWeight: 600 }}>
                      ● Kitchen: {kotDelta.addedItemsCount} pending
                    </span>
                  )}
                  {kotDelta.ticketType === 'addon' && !isCancelled && (
                    <span className="chip" style={{ fontSize: 11, borderColor: '#3b82f688', color: '#3b82f6', fontWeight: 600 }}>
                      ● Kitchen add-on: +{kotDelta.addedItemsCount}
                    </span>
                  )}
                  {kotDelta.ticketType === 'none' && latestKot && !isCancelled && (
                    <span className="chip" style={{ fontSize: 11, borderColor: '#10b98188', color: '#10b981', fontWeight: 600 }}>
                      ✓ KOT Sent
                    </span>
                  )}
                  {(o.external_platform_name || ['swiggy', 'zomato', 'delivery_platform'].includes(o.order_source || '')) && (
                    <span className="chip" style={{ fontSize: 11, borderColor: '#3b82f688', color: '#60a5fa', fontWeight: 600 }}>
                      🛵 {o.external_platform_name || (o.order_source === 'swiggy' ? 'Swiggy' : 'Zomato')} · Paid Externally
                    </span>
                  )}
                  {o.order_source === 'admin_credit' && (
                    <span className="chip" style={{ fontSize: 11, borderColor: '#f59e0b88', color: '#f59e0b', fontWeight: 600 }}>
                      💳 Admin Credit ({o.payment_status?.toUpperCase() || 'UNPAID'})
                    </span>
                  )}
                  {o.billed_at && !['admin_credit', 'swiggy', 'zomato', 'delivery_platform'].includes(o.order_source || '') && !o.external_platform_name && (
                    <span
                      className="chip"
                      style={{
                        fontSize: 11,
                        borderColor: o.payment_status === 'paid' ? '#10b98188' : o.payment_status === 'partial' ? '#f59e0b88' : '#d5a84b66',
                        color: o.payment_status === 'paid' ? '#10b981' : o.payment_status === 'partial' ? '#f59e0b' : 'var(--accent)',
                        fontWeight: 600,
                      }}
                    >
                      {o.payment_status === 'paid'
                        ? `✓ Paid (${o.payment_method === 'cash' ? '💵 Cash' : '📱 Online/UPI'})`
                        : o.payment_status === 'partial'
                        ? `● Partial (₹${((o.paid_paise || 0) / 100).toFixed(2)} / ₹${(o.total_paise / 100).toFixed(2)})`
                        : o.payment_status === 'unpaid'
                        ? '⏳ Billed (Unpaid)'
                        : '✓ Billed'}
                    </span>
                  )}
                  {o.billed_at && (['admin_credit', 'swiggy', 'zomato', 'delivery_platform'].includes(o.order_source || '') || Boolean(o.external_platform_name)) && (
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

              {editing?.orderId === o.id ? (
                <div style={{ display: 'grid', gap: 10, margin: '14px 0', background: '#ffffff06', padding: 12, borderRadius: 8, border: '1px solid var(--line)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
                    Edit Order Items:
                  </div>

                  {editing.items.map((item) => (
                    <div
                      key={item.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                        borderBottom: '1px dashed var(--line, #ffffff18)',
                        paddingBottom: 8,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, overflowWrap: 'break-word' }}>
                            {item.isCustom ? item.name : nameOf(item.menuItemId || '', o)}
                          </span>
                          {item.isCustom && (
                            <span className="chip" style={{ fontSize: 10, padding: '1px 6px', color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                              Custom
                            </span>
                          )}
                          <span className="muted" style={{ fontSize: 12 }}>
                            ₹{((item.unitPricePaise * item.quantity) / 100).toFixed(2)}
                          </span>
                        </div>
                        {item.note && (
                          <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>
                            Note: {item.note}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button className="chip" aria-label="Less" onClick={() => setQty(item.menuItemId || item.key, -1)}>
                          −
                        </button>
                        <span style={{ padding: '0 8px', fontWeight: 700, minWidth: 20, textAlign: 'center' }}>
                          {item.quantity}
                        </span>
                        <button className="chip" aria-label="More" onClick={() => setQty(item.menuItemId || item.key, 1)}>
                          +
                        </button>
                        <button
                          type="button"
                          className="chip"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => setQty(item.menuItemId || item.key, -999)}
                          style={{ fontSize: 11, padding: '4px 8px', color: '#ef4444' }}
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Searchable, Scrollable Dish Catalogue Browser (Issue 2) */}
                  <div style={{ display: 'grid', gap: 8, padding: '10px 0', borderTop: '1px solid var(--line, #ffffff18)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent, #c89f65)' }}>
                        Menu Catalogue ({menu.filter((m) => m.is_available).length} dishes available)
                      </span>
                      {searchCatalogueQuery && (
                        <button
                          type="button"
                          className="chip"
                          onClick={() => setSearchCatalogueQuery('')}
                          style={{ fontSize: 11, padding: '1px 6px' }}
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
                      {['ALL', ...Array.from(new Set(menu.map((m) => m.category_name || 'Other').filter(Boolean)))].map((cat) => {
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
                        border: '1px solid var(--line, #ffffff24)',
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
                        border: '1px solid var(--line, #ffffff18)',
                        background: 'rgba(0,0,0,0.2)',
                        padding: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      {(() => {
                        const eligibleDishes = menu.filter((m) => {
                          if (!m.is_available) return false;
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

                        if (eligibleDishes.length === 0) {
                          return (
                            <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 12, color: 'var(--muted, #999)' }}>
                              No dishes match &ldquo;{searchCatalogueQuery}&rdquo;. Try another term or add a custom dish below.
                            </div>
                          );
                        }

                        return eligibleDishes.map((m) => {
                          const existingInOrder = editing.items.find((it) => !it.isCustom && it.menuItemId === m.id);
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
                                  onClick={() => addCatalogueItemToEdit(m.id)}
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
                        });
                      })()}
                    </div>
                  </div>

                  {/* Add Catalogue Item Dropdown (Accessible Quick Select) */}
                  <select
                    aria-label="Add an item to order"
                    value={adding}
                    onChange={(e) => {
                      if (e.target.value) {
                        addCatalogueItemToEdit(e.target.value);
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
                      .filter((m) => m.is_available && !editing.items.some((it) => !it.isCustom && it.menuItemId === m.id))
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

                  {/* Add Custom Non-Catalogue Dish Section */}
                  <div style={{ borderTop: '1px solid var(--line, #ffffff24)', paddingTop: 10 }}>
                    {!editing.showCustomForm ? (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => setEditing((e) => (e ? { ...e, showCustomForm: true } : e))}
                        style={{ fontSize: 12, padding: '6px 12px', width: '100%', justifyContent: 'center' }}
                      >
                        + Add Custom Dish (Non-Catalogue)
                      </button>
                    ) : (
                      <div style={{ display: 'grid', gap: 8, background: '#ffffff08', padding: 10, borderRadius: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <b style={{ fontSize: 12, color: 'var(--accent)' }}>New Custom Dish</b>
                          <button
                            type="button"
                            className="chip"
                            onClick={() => setEditing((e) => (e ? { ...e, showCustomForm: false } : e))}
                            style={{ fontSize: 11, padding: '2px 6px' }}
                          >
                            Cancel
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Dish name (e.g. Extra Butter Toast)"
                          value={editing.customName}
                          onChange={(e) => setEditing((prev) => prev ? { ...prev, customName: e.target.value } : prev)}
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: '1px solid var(--line)',
                            background: '#ffffff10',
                            color: 'var(--ink)',
                            fontSize: 13,
                          }}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            placeholder="Price (₹)"
                            value={editing.customPriceRupees}
                            onChange={(e) => setEditing((prev) => prev ? { ...prev, customPriceRupees: e.target.value } : prev)}
                            style={{
                              padding: 8,
                              borderRadius: 6,
                              border: '1px solid var(--line)',
                              background: '#ffffff10',
                              color: 'var(--ink)',
                              fontSize: 13,
                            }}
                          />
                          <input
                            type="number"
                            min="1"
                            max="20"
                            placeholder="Quantity"
                            value={editing.customQty}
                            onChange={(e) => setEditing((prev) => prev ? { ...prev, customQty: parseInt(e.target.value) || 1 } : prev)}
                            style={{
                              padding: 8,
                              borderRadius: 6,
                              border: '1px solid var(--line)',
                              background: '#ffffff10',
                              color: 'var(--ink)',
                              fontSize: 13,
                            }}
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Special instructions (optional)"
                          value={editing.customNote}
                          onChange={(e) => setEditing((prev) => prev ? { ...prev, customNote: e.target.value } : prev)}
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: '1px solid var(--line)',
                            background: '#ffffff10',
                            color: 'var(--ink)',
                            fontSize: 13,
                          }}
                        />
                        <button
                          type="button"
                          className="btn"
                          onClick={addCustomItemToEdit}
                          style={{ fontSize: 12, padding: '8px' }}
                        >
                          + Add to Order
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Edited Total Preview */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
                    <span className="muted" style={{ fontSize: 13 }}>New Order Total:</span>
                    <b style={{ fontSize: 14 }}>
                      ₹{(editing.items.reduce((sum, item) => sum + item.unitPricePaise * item.quantity, 0) / 100).toFixed(2)}
                    </b>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
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
                      {i.quantity}× {i.item_name_snapshot}{' '}
                      {i.is_custom && (
                        <span className="chip" style={{ fontSize: 9, padding: '1px 5px', color: 'var(--accent)' }}>
                          Custom
                        </span>
                      )}
                      {i.item_note && <em style={{ fontSize: 12, display: 'block', color: '#d7c3ab' }}>Note: {i.item_note}</em>}
                    </li>
                  ))}
                </ul>
              )}

              <div
                className="staff-order-card-footer"
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
                <div
                  className="staff-order-card-actions"
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}
                >
                  {o.status === 'NEW' && (
                    <button className="chip" disabled={busy === o.id} onClick={() => reject(o)}>
                      Reject
                    </button>
                  )}
                  {canEdit && (
                    <button className="chip" onClick={() => startEdit(o)}>
                      Edit items
                    </button>
                  )}
                  {!isCancelled && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => openKitchenTicket(o, false)}
                        title="Open the print-only kitchen ticket page"
                        style={{
                          fontWeight: 600,
                          background: kotDelta.hasAdditions ? 'rgba(200, 159, 101, 0.15)' : undefined,
                          borderColor: kotDelta.hasAdditions ? 'var(--accent)' : undefined,
                        }}
                      >
                        {kotDelta.ticketType === 'addon'
                          ? `Kitchen Ticket (+${kotDelta.addedItemsCount} new)`
                          : 'Kitchen Ticket'}
                      </button>
                      {kotDelta.hasAdditions && (
                        <button
                          type="button"
                          className="chip"
                          disabled={busy === o.id}
                          onClick={() => acknowledgeKitchenTicket(o)}
                          title="Confirm the currently pending ticket was sent to the kitchen"
                          style={{ fontWeight: 700, minHeight: 34, borderColor: '#10b98188', color: '#10b981' }}
                        >
                          {busy === o.id ? 'Saving…' : 'Mark sent'}
                        </button>
                      )}
                      {latestKot && (
                        <button
                          type="button"
                          className="chip"
                          onClick={() => openKitchenTicket(o, true)}
                          title="Reprint entire kitchen ticket"
                          style={{ minHeight: 34, color: 'var(--muted, #a89485)' }}
                        >
                          Reprint Full
                        </button>
                      )}
                    </div>
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
                  {!isBilled &&
                    !isCancelled &&
                    !['swiggy', 'zomato', 'delivery_platform', 'admin_credit'].includes(o.order_source || '') &&
                    ['ACCEPTED', 'PREPARING', 'READY'].includes(o.status) && (
                    <button
                      className="chip"
                      disabled={busy === o.id}
                      onClick={() => openBill(o)}
                      style={{ fontWeight: 600 }}
                      title="Issue bill for this accepted order"
                    >
                      Generate Bill
                    </button>
                  )}
                  {isBilled &&
                    !isCancelled &&
                    o.payment_status !== 'paid' &&
                    !['swiggy', 'zomato', 'delivery_platform', 'admin_credit'].includes(o.order_source || '') &&
                    !o.external_platform_name && (
                    <button
                      className="chip"
                      disabled={busy === o.id}
                      onClick={() => handleOpenCollectPayment(o)}
                      style={{
                        fontWeight: 700,
                        borderColor: 'var(--accent)',
                        color: 'var(--accent)',
                        background: 'rgba(200, 159, 101, 0.1)',
                      }}
                      title="Collect customer payment"
                    >
                      {busy === o.id ? 'Loading…' : 'Collect Payment'}
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
          onSuccess={(newOrder) => {
            setShowManualModal(false);
            setBillingOrder(null);
            router.refresh();
          }}
        />
      )}

      {showDeliveryModal && (
        <DeliveryPlatformOrderModal
          menuItems={menu}
          onClose={() => setShowDeliveryModal(false)}
          onSuccess={(newOrder) => {
            setShowDeliveryModal(false);
            setBillingOrder(null);
            router.refresh();
          }}
        />
      )}

      {billingOrder && (
        <BillDiscountModal
          orderNumber={billingOrder.order_number}
          subtotalPaise={billingOrder.total_paise}
          onClose={() => setBillingOrder(null)}
          onConfirm={async (payload) => {
            const targetOrderId = billingOrder.id;
            setBillingOrder(null);
            await billOrderDirectly(targetOrderId, payload);
          }}
        />
      )}

      {collectingPayment && (
        <CollectPaymentModal
          orderNumber={collectingPayment.order.order_number}
          billId={collectingPayment.bill.id}
          totalPaise={collectingPayment.bill.total_paise}
          paidPaise={collectingPayment.bill.paid_paise || 0}
          onClose={() => setCollectingPayment(null)}
          onSuccess={() => {
            setCollectingPayment(null);
            router.refresh();
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
