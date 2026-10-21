'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { Bill, BillAuditEvent } from '@/lib/billing';
import ThermalBillModal from '@/components/staff/ThermalBillModal';
import ManualOrderModal from '@/components/staff/ManualOrderModal';

interface ReportsSummary {
  totalCount: number;
  issuedCount: number;
  cancelledCount: number;
  totalSalesPaise: number;
  totalTaxPaise: number;
  todaySalesPaise: number;
  todayBillCount: number;
}

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

export default function ReportsManager({
  tables = [],
  menuItems = [],
}: {
  tables?: TableOption[];
  menuItems?: MenuItemOption[];
}) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [summary, setSummary] = useState<ReportsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [orderSource, setOrderSource] = useState<'all' | 'qr' | 'manual'>('all');
  const [status, setStatus] = useState<'all' | 'issued' | 'cancelled'>('all');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 20;

  // Selected Bill for details drawer & thermal modal
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [billEvents, setBillEvents] = useState<BillAuditEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [thermalBill, setThermalBill] = useState<{ bill: Bill; isReprint: boolean } | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);

  // Cancellation state
  const [cancellingBill, setCancellingBill] = useState<Bill | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLegacySchema, setIsLegacySchema] = useState(false);

  useEffect(() => {
    let active = true;

    Promise.resolve().then(() => {
      if (active) {
        setLoading(true);
        setError(null);
      }
    });

    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      orderSource,
      status,
    });
    if (search.trim()) params.set('search', search.trim());
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    fetch(`/api/admin/reports/bills?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (!data.ok) throw new Error(data.error || 'Failed to load billing audit report');
        setBills(data.bills || []);
        setTotalCount(data.totalCount || 0);
        setSummary(data.summary || null);
        setIsLegacySchema(Boolean(data.isLegacySchema));
      })
      .catch((err) => {
        if (!active) return;
        console.error('Audit report load error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load report');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, search, startDate, endDate, orderSource, status, refreshKey]);

  // Load audit trail when a bill is selected
  async function openBillDetails(bill: Bill) {
    setSelectedBill(bill);
    setLoadingEvents(true);
    try {
      const res = await fetch(`/api/admin/reports/events?billId=${bill.id}`);
      const data = await res.json();
      if (res.ok && data.ok) {
        setBillEvents(data.events || []);
      } else {
        setBillEvents([]);
      }
    } catch {
      setBillEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }

  // Handle bill cancellation / void
  async function handleCancelBill() {
    if (!cancellingBill) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/admin/bills/${cancellingBill.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason || 'Voided by administrator' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to cancel bill');
      }

      setCancellingBill(null);
      setCancelReason('');
      if (selectedBill?.id === cancellingBill.id) {
        setSelectedBill(data.bill);
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not cancel bill');
    } finally {
      setCancelling(false);
    }
  }

  // Quick Date presets
  function setDatePreset(preset: 'today' | 'yesterday' | '7days' | '30days' | 'all') {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'today') {
      const d = istNow.toISOString().slice(0, 10);
      setStartDate(d);
      setEndDate(d);
    } else if (preset === 'yesterday') {
      const yDate = new Date(istNow.getTime() - 24 * 60 * 60 * 1000);
      const d = yDate.toISOString().slice(0, 10);
      setStartDate(d);
      setEndDate(d);
    } else if (preset === '7days') {
      const past = new Date(istNow.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().slice(0, 10));
      setEndDate(istNow.toISOString().slice(0, 10));
    } else if (preset === '30days') {
      const past = new Date(istNow.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().slice(0, 10));
      setEndDate(istNow.toISOString().slice(0, 10));
    }
    setPage(1);
  }

  const exportUrl = (type: 'bills' | 'items' | 'events') => {
    const params = new URLSearchParams({ orderSource, status });
    if (search.trim()) params.set('search', search.trim());
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return `/api/admin/reports/export/${type}?${params.toString()}`;
  };

  const totalPages = Math.ceil(totalCount / limit) || 1;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header Actions & Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Georgia,serif', fontSize: 'clamp(1.9rem,4vw,2.6rem)', margin: 0, lineHeight: 1 }}>
            Billing Audit &amp; Reports
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Authoritative bill logs, immutable item snapshots, and spreadsheet-ready CSV exports.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            onClick={() => setShowManualModal(true)}
          >
            + New Custom Bill / Order
          </button>
        </div>
      </div>

      {/* Database Schema Compatibility Notice */}
      {isLegacySchema && (
        <section
          role="status"
          className="card"
          style={{
            padding: '14px 18px',
            borderLeft: '4px solid var(--accent)',
            background: 'rgba(213, 168, 75, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <b style={{ color: 'var(--accent)' }}>Database Compatibility Mode Active (Migration 0009 Pending)</b>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Historical bills and sales revenue are loaded in backward-compatible mode. Manual orders, reprint audit logs, and cancellation reasons will become fully active once Migration 0009 is applied to this database.
            </p>
          </div>
          <span className="chip" style={{ fontSize: 11, borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            Migration 0009 Pending
          </span>
        </section>
      )}

      {/* KPI Summary Cards */}
      {summary && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div className="card" style={{ padding: 16, borderTop: '3px solid var(--accent)' }}>
            <span className="muted" style={{ fontSize: 12 }}>Total Filtered Sales</span>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: '1.9rem', margin: '4px 0 2px' }}>
              ₹{(summary.totalSalesPaise / 100).toFixed(2)}
            </div>
            <small className="muted">{summary.issuedCount} issued bills</small>
          </div>

          <div className="card" style={{ padding: 16, borderTop: '3px solid #10b981' }}>
            <span className="muted" style={{ fontSize: 12 }}>Today’s Live Revenue</span>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: '1.9rem', margin: '4px 0 2px' }}>
              ₹{(summary.todaySalesPaise / 100).toFixed(2)}
            </div>
            <small className="muted">{summary.todayBillCount} orders billed today</small>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <span className="muted" style={{ fontSize: 12 }}>Filtered Bill Count</span>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: '1.9rem', margin: '4px 0 2px' }}>
              {summary.totalCount}
            </div>
            <small className="muted">{summary.cancelledCount} voided / cancelled</small>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <span className="muted" style={{ fontSize: 12 }}>GST / Tax Collected</span>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: '1.9rem', margin: '4px 0 2px' }}>
              ₹{(summary.totalTaxPaise / 100).toFixed(2)}
            </div>
            <small className="muted">Exclusive tax ledger</small>
          </div>
        </section>
      )}

      {/* CSV Export Bar */}
      <section className="card" style={{ padding: 16, backgroundColor: '#ffffff06' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <strong style={{ display: 'block', fontSize: 14 }}>Spreadsheet-Compatible CSV Exports</strong>
            <small className="muted">
              Exports adhere to RFC 4180 with UTF-8 BOM encoding and formula-injection defenses.
            </small>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="chip" href={exportUrl('bills')} download style={{ textDecoration: 'none', fontWeight: 600 }}>
              📥 Export Bills CSV
            </a>
            <a className="chip" href={exportUrl('items')} download style={{ textDecoration: 'none', fontWeight: 600 }}>
              📥 Export Bill Items CSV
            </a>
            <a className="chip" href={exportUrl('events')} download style={{ textDecoration: 'none', fontWeight: 600 }}>
              📥 Export Audit Events CSV
            </a>
          </div>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Search Bills</label>
            <input
              type="text"
              placeholder="Bill #, order #, name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
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

          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
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
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
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
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Order Source</label>
            <select
              value={orderSource}
              onChange={(e) => {
                setOrderSource(e.target.value as 'all' | 'qr' | 'manual');
                setPage(1);
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: '#1a1a1a',
                color: 'inherit',
              }}
            >
              <option value="all">All Sources (QR &amp; Manual)</option>
              <option value="qr">QR Table Orders Only</option>
              <option value="manual">Manual / Counter Orders Only</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Bill Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as 'all' | 'issued' | 'cancelled');
                setPage(1);
              }}
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
              <option value="issued">Issued Active Bills</option>
              <option value="cancelled">Cancelled / Voided Bills</option>
            </select>
          </div>
        </div>

        {/* Quick Presets */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>Date Presets:</span>
          <button type="button" className="chip" style={{ fontSize: 11 }} onClick={() => setDatePreset('today')}>
            Today
          </button>
          <button type="button" className="chip" style={{ fontSize: 11 }} onClick={() => setDatePreset('yesterday')}>
            Yesterday
          </button>
          <button type="button" className="chip" style={{ fontSize: 11 }} onClick={() => setDatePreset('7days')}>
            Last 7 Days
          </button>
          <button type="button" className="chip" style={{ fontSize: 11 }} onClick={() => setDatePreset('30days')}>
            Last 30 Days
          </button>
          <button type="button" className="chip" style={{ fontSize: 11 }} onClick={() => setDatePreset('all')}>
            Clear Dates
          </button>
        </div>
      </section>

      {/* Bills Table Section */}
      <section>
        {error && (
          <div role="alert" style={{ padding: 12, borderLeft: '3px solid #ef4444', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <p className="muted" style={{ margin: 0 }}>Loading billing records...</p>
          </div>
        ) : bills.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <h3 style={{ fontFamily: 'Georgia,serif', margin: '0 0 6px' }}>No bills found</h3>
            <p className="muted" style={{ margin: 0 }}>
              Try adjusting your date range, search query, or order source filter.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {bills.map((bill) => {
              const dateObj = new Date(bill.issued_at);
              const dateStr = dateObj.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                timeZone: 'Asia/Kolkata',
              });
              const timeStr = dateObj.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Kolkata',
              });

              const isCancelled = bill.status === 'cancelled';
              const itemCount = bill.items_snapshot?.reduce((acc, i) => acc + i.quantity, 0) || 0;

              return (
                <article
                  key={bill.id}
                  className="card"
                  style={{
                    padding: 16,
                    borderLeft: isCancelled ? '3px solid #ef4444' : '3px solid #10b981',
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 16, letterSpacing: '.03em' }}>{bill.bill_number}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>Order #{bill.order_number}</span>
                        <span
                          className="chip"
                          style={{
                            fontSize: 10,
                            padding: '2px 8px',
                            background: bill.order_source === 'manual' ? '#f59e0b22' : '#3b82f622',
                            color: bill.order_source === 'manual' ? '#f59e0b' : '#3b82f6',
                          }}
                        >
                          {bill.order_source === 'manual' ? 'Manual' : 'QR Order'}
                        </span>
                        <span className="chip" style={{ fontSize: 10, padding: '2px 8px' }}>
                          {bill.service_mode || 'dine_in'}
                        </span>
                        {isCancelled && (
                          <span className="chip" style={{ fontSize: 10, padding: '2px 8px', background: '#ef444422', color: '#ef4444' }}>
                            Cancelled
                          </span>
                        )}
                      </div>

                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {dateStr} · {timeStr} · Table: {bill.table_label || bill.table_number || 'Takeaway'} · Customer: {bill.customer_name || 'Guest'}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'Georgia,serif', fontSize: '1.4rem', fontWeight: 700 }}>
                        ₹{(bill.total_paise / 100).toFixed(2)}
                      </div>
                      <span className="muted" style={{ fontSize: 11 }}>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
                    </div>
                  </div>

                  {/* Actions for this bill */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => openBillDetails(bill)}
                      style={{ cursor: 'pointer' }}
                    >
                      🔍 View Details &amp; Items
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => setThermalBill({ bill, isReprint: true })}
                      style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}
                    >
                      View Image
                    </button>
                    {!isCancelled && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          setCancellingBill(bill);
                          setCancelReason('');
                        }}
                        style={{ cursor: 'pointer', color: '#ef4444' }}
                      >
                        ⛔ Void / Cancel Bill
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <button
              type="button"
              className="chip"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'default' : 'pointer' }}
            >
              ← Previous
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              Page {page} of {totalPages} ({totalCount} bills)
            </span>
            <button
              type="button"
              className="chip"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{ opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'default' : 'pointer' }}
            >
              Next →
            </button>
          </div>
        )}
      </section>

      {/* Bill Details Drawer / Modal */}
      {selectedBill && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedBill(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(4px)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            zIndex: 999,
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 580,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 24,
              borderRadius: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <span className="chip" style={{ fontSize: 11, marginBottom: 4 }}>Bill #{selectedBill.bill_number}</span>
                <h2 style={{ fontFamily: 'Georgia,serif', margin: '4px 0 0', fontSize: '1.6rem' }}>
                  Order #{selectedBill.order_number} Details
                </h2>
              </div>
              <button
                type="button"
                className="chip"
                onClick={() => setSelectedBill(null)}
                style={{ fontSize: 14 }}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: 13, marginBottom: 16, padding: 12, background: '#ffffff08', borderRadius: 8 }}>
              <div><strong>Status:</strong> {selectedBill.status.toUpperCase()}</div>
              <div><strong>Service Mode:</strong> {selectedBill.service_mode || 'dine_in'}</div>
              <div><strong>Order Source:</strong> {selectedBill.order_source || 'qr'}</div>
              <div><strong>Table:</strong> {selectedBill.table_label || selectedBill.table_number || 'Takeaway'}</div>
              <div><strong>Customer:</strong> {selectedBill.customer_name || 'Guest'}</div>
              <div><strong>Issued At:</strong> {new Date(selectedBill.issued_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
            </div>

            {/* Line Items Table */}
            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Immutable Line Items Snapshot</h3>
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 16 }}>
              <table style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#ffffff0f', borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px' }}>Item</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center' }}>Qty</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Rate (₹)</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBill.items_snapshot.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <strong>{item.name}</strong>
                        {item.is_custom && <span className="chip" style={{ fontSize: 9, marginLeft: 6 }}>Custom</span>}
                        {item.selected_options && item.selected_options.length > 0 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            + {item.selected_options.map((o) => o.name).join(', ')}
                          </div>
                        )}
                        {item.note && <div className="muted" style={{ fontSize: 11 }}>Note: {item.note}</div>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>{item.quantity}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{(item.unit_price_paise / 100).toFixed(2)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{(item.line_total_paise / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ padding: '10px 12px', display: 'grid', gap: 4, textAlign: 'right', fontSize: 13, background: '#ffffff05' }}>
                <div>Subtotal: ₹{(selectedBill.subtotal_paise / 100).toFixed(2)}</div>
                {selectedBill.tax_paise > 0 && <div>Tax: ₹{(selectedBill.tax_paise / 100).toFixed(2)}</div>}
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                  Total Amount: ₹{(selectedBill.total_paise / 100).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Audit Trail Section */}
            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Bill Audit Event Log</h3>
            {loadingEvents ? (
              <p className="muted" style={{ fontSize: 12 }}>Loading audit events...</p>
            ) : billEvents.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>No audit events recorded for this bill.</p>
            ) : (
              <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
                {billEvents.map((ev) => (
                  <div key={ev.id} style={{ padding: '8px 10px', background: '#ffffff06', borderRadius: 6, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ textTransform: 'uppercase', color: ev.event_type === 'cancelled' ? '#ef4444' : ev.event_type === 'issued' ? '#10b981' : 'var(--accent)' }}>
                        {ev.event_type}
                      </strong>
                      <span className="muted">
                        {new Date(ev.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </span>
                    </div>
                    <div className="muted" style={{ marginTop: 2 }}>
                      Actor: {ev.actor_email || ev.actor_role || ev.actor_id || 'System'}
                      {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                        <span> · {JSON.stringify(ev.metadata)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                className="chip"
                onClick={() => setThermalBill({ bill: selectedBill, isReprint: true })}
                style={{ color: 'var(--accent)', fontWeight: 600 }}
              >
                View Image
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill Cancellation Dialog */}
      {cancellingBill && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ maxWidth: 440, width: '100%', padding: 24, borderRadius: 12 }}>
            <h3 style={{ fontFamily: 'Georgia,serif', margin: '0 0 8px', color: '#ef4444' }}>
              Void Bill #{cancellingBill.bill_number}?
            </h3>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 16px' }}>
              This marks the bill as cancelled and logs a permanent audit entry. The underlying order #{cancellingBill.order_number} will also be marked CANCELLED.
            </p>

            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
              Reason for Cancellation (required)
            </label>
            <input
              type="text"
              placeholder="e.g. Customer cancelled order / Wrong punch"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'transparent',
                color: 'inherit',
                marginBottom: 16,
              }}
            />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="chip"
                disabled={cancelling}
                onClick={() => setCancellingBill(null)}
              >
                Keep Bill
              </button>
              <button
                type="button"
                className="chip"
                disabled={cancelling}
                onClick={handleCancelBill}
                style={{ background: '#ef4444', color: '#fff', border: 'none' }}
              >
                {cancelling ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thermal Receipt Print Modal */}
      {thermalBill && (
        <ThermalBillModal
          bill={thermalBill.bill}
          isReprint={thermalBill.isReprint}
          onClose={() => setThermalBill(null)}
        />
      )}

      {/* Manual Order Creation Modal */}
      {showManualModal && (
        <ManualOrderModal
          tables={tables}
          menuItems={menuItems}
          onClose={() => setShowManualModal(false)}
          onSuccess={(created) => {
            setShowManualModal(false);
            setRefreshKey((k) => k + 1);
            // Automatically prompt to open thermal bill
            fetch(`/api/staff/orders/${created.order_id}/bill`, { method: 'POST' })
              .then((r) => r.json())
              .then((d) => {
                if (d.ok && d.bill) {
                  setThermalBill({ bill: d.bill, isReprint: false });
                }
              })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
