'use client';

import { useState, useMemo, useEffect } from 'react';
import { calculateBillDiscount, type DiscountType } from '@/lib/billing';

export interface BillConfirmPayload {
  discount?: { type: DiscountType; value: number };
  paymentMethod: 'cash' | 'upi';
  confirmPayment: boolean;
  paidAmountRupees?: number;
}

export default function BillDiscountModal({
  orderNumber,
  subtotalPaise,
  onClose,
  onConfirm,
}: {
  orderNumber: number;
  subtotalPaise: number;
  onClose: () => void;
  onConfirm: (payload: BillConfirmPayload) => Promise<void>;
}) {
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi'>('cash');
  const [confirmPayment, setConfirmPayment] = useState(true);
  const [customPaidAmount, setCustomPaidAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discountCalculation = useMemo(() => {
    if (!discountEnabled || !discountValue.trim()) {
      return null;
    }
    const num = parseFloat(discountValue);
    if (isNaN(num) || num <= 0) return null;
    try {
      return calculateBillDiscount(subtotalPaise, {
        type: discountType,
        value: num,
      });
    } catch {
      return null;
    }
  }, [discountEnabled, discountType, discountValue, subtotalPaise]);

  const finalPayablePaise = discountCalculation?.totalPaise ?? subtotalPaise;
  const finalPayableRupees = finalPayablePaise / 100;

  async function handleGenerate() {
    setError(null);
    let discountPayload: { type: DiscountType; value: number } | undefined;

    if (discountEnabled && discountValue.trim()) {
      const num = parseFloat(discountValue);
      if (isNaN(num) || num <= 0) {
        setError('Please enter a valid discount amount greater than zero.');
        return;
      }
      if (discountType === 'percentage' && num > 100) {
        setError('Percentage discount cannot exceed 100%.');
        return;
      }
      if (discountType === 'fixed' && Math.round(num * 100) > subtotalPaise) {
        setError('Fixed discount cannot exceed the order total.');
        return;
      }
      discountPayload = { type: discountType, value: num };
    }

    let paidRupees = finalPayableRupees;
    if (confirmPayment) {
      if (customPaidAmount.trim()) {
        const parsedPaid = parseFloat(customPaidAmount);
        if (isNaN(parsedPaid) || parsedPaid <= 0) {
          setError('Please enter a valid received payment amount greater than zero.');
          return;
        }
        if (parsedPaid > finalPayableRupees) {
          setError(`Received amount cannot exceed the payable total (₹${finalPayableRupees.toFixed(2)}).`);
          return;
        }
        paidRupees = parsedPaid;
      }
    } else {
      paidRupees = 0;
    }

    setSubmitting(true);
    try {
      await onConfirm({
        discount: discountPayload,
        paymentMethod,
        confirmPayment,
        paidAmountRupees: confirmPayment ? paidRupees : 0,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate bill.');
      setSubmitting(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Generate Bill for Order #${orderNumber}`}
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
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        zIndex: 9998,
        padding: 'calc(16px + env(safe-area-inset-top, 0px)) 12px calc(24px + env(safe-area-inset-bottom, 0px)) 12px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 480,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--card, #37241d)',
          border: '1px solid var(--line, #422a21)',
          borderRadius: 12,
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          boxSizing: 'border-box',
          overflow: 'hidden',
          margin: 'auto 0',
        }}
      >
        {/* Header */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid var(--line, #ffffff24)',
            background: 'var(--card, #37241d)',
          }}
        >
          <h2 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: '1.25rem', lineHeight: 1.3, fontWeight: 700 }}>
            Issue Bill · Order #{orderNumber}
          </h2>
          <button
            type="button"
            className="chip"
            onClick={onClose}
            disabled={submitting}
            style={{ minHeight: 34, minWidth: 34, padding: '4px 10px', fontSize: 13, cursor: 'pointer' }}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <div
          style={{
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {error && (
            <p role="alert" style={{ color: '#ef4444', fontSize: 13, margin: 0, borderLeft: '3px solid #ef4444', paddingLeft: 8 }}>
              {error}
            </p>
          )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line, #ffffff24)', paddingBottom: 10 }}>
          <span className="muted">Order Amount:</span>
          <b style={{ fontSize: '1.2rem' }}>₹{(subtotalPaise / 100).toFixed(2)}</b>
        </div>

        {/* Optional Bill Discount Toggle */}
        <div style={{ background: '#ffffff08', padding: 14, borderRadius: 8, border: '1px solid var(--line, #ffffff24)', display: 'grid', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={discountEnabled}
              onChange={(e) => {
                setDiscountEnabled(e.target.checked);
                if (!e.target.checked) setDiscountValue('');
              }}
            />
            Apply Bill Discount
          </label>

          {discountEnabled && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setDiscountType('fixed')}
                  style={discountType === 'fixed' ? { background: 'var(--accent)', color: '#2b1b16', fontWeight: 700 } : undefined}
                >
                  Fixed (₹)
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setDiscountType('percentage')}
                  style={discountType === 'percentage' ? { background: 'var(--accent)', color: '#2b1b16', fontWeight: 700 } : undefined}
                >
                  Percentage (%)
                </button>
              </div>

              <input
                type="number"
                min="0"
                step="any"
                placeholder={discountType === 'fixed' ? 'Discount amount in ₹' : 'Discount percentage (0–100)%'}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--line, #ffffff24)',
                  background: '#ffffff10',
                  color: 'var(--ink, #f5ead9)',
                  fontSize: 14,
                }}
              />

              {discountCalculation && discountCalculation.hasDiscount && (
                <div style={{ fontSize: 13, borderTop: '1px dashed var(--line, #ffffff24)', paddingTop: 8, display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#d7c3ab' }}>
                    <span>Original Total:</span>
                    <span>₹{(discountCalculation.subtotalBeforeDiscountPaise / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent, #d5a84b)' }}>
                    <span>Discount:</span>
                    <span>-₹{(discountCalculation.discountPaise / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
                    <span>Payable Total:</span>
                    <span>₹{(discountCalculation.totalPaise / 100).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Payment Method Selection */}
        <div style={{ background: '#ffffff08', padding: 14, borderRadius: 8, border: '1px solid var(--line, #ffffff24)', display: 'grid', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', letterSpacing: '.04em' }}>
            PAYMENT METHOD
          </span>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: paymentMethod === 'cash' ? '2px solid #10b981' : '1px solid var(--line, #ffffff24)',
                background: paymentMethod === 'cash' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)',
                color: paymentMethod === 'cash' ? '#34d399' : 'var(--ink)',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              💵 Cash
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('upi')}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: paymentMethod === 'upi' ? '2px solid #3b82f6' : '1px solid var(--line, #ffffff24)',
                background: paymentMethod === 'upi' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                color: paymentMethod === 'upi' ? '#60a5fa' : 'var(--ink)',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              📱 Online / UPI
            </button>
          </div>

          {/* Payment Confirmation Toggle */}
          <div style={{ borderTop: '1px dashed var(--line, #ffffff24)', paddingTop: 10, display: 'grid', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={confirmPayment}
                onChange={(e) => {
                  setConfirmPayment(e.target.checked);
                  if (!e.target.checked) setCustomPaidAmount('');
                }}
              />
              Confirm payment received now ({paymentMethod === 'cash' ? 'Cash' : 'Online / UPI'})
            </label>

            {confirmPayment ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>Amount received:</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                    ₹{(parseFloat(customPaidAmount) || finalPayableRupees).toFixed(2)}
                  </span>
                </div>
                <input
                  type="number"
                  min="0"
                  max={finalPayableRupees}
                  step="any"
                  placeholder={`Full amount: ₹${finalPayableRupees.toFixed(2)}`}
                  value={customPaidAmount}
                  onChange={(e) => setCustomPaidAmount(e.target.value)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line, #ffffff24)',
                    background: '#ffffff10',
                    color: 'var(--ink, #f5ead9)',
                    fontSize: 13,
                  }}
                />
                {customPaidAmount && parseFloat(customPaidAmount) < finalPayableRupees && (
                  <span style={{ fontSize: 11, color: '#f59e0b' }}>
                    ⚠️ Partial payment: ₹{(finalPayableRupees - parseFloat(customPaidAmount)).toFixed(2)} will remain outstanding.
                  </span>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '6px 10px', borderRadius: 4 }}>
                ℹ️ Bill will be issued as <b>UNPAID</b>. Zero collections will be recorded until staff confirms payment.
              </div>
            )}
          </div>
        </div>

        </div>

        {/* Footer - Fixed Action Buttons */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: '14px 20px',
            borderTop: '1px solid var(--line, #ffffff24)',
            background: 'var(--card, #37241d)',
          }}
        >
          <button
            type="button"
            className="chip"
            disabled={submitting}
            onClick={onClose}
            style={{ minHeight: 42, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={submitting}
            onClick={handleGenerate}
            style={{ minHeight: 42, padding: '8px 20px', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            {submitting
              ? 'Processing…'
              : confirmPayment
              ? `Collect ₹${(parseFloat(customPaidAmount) || finalPayableRupees).toFixed(2)} & Issue Bill`
              : 'Issue Bill (Unpaid)'}
          </button>
        </div>
      </div>
    </div>
  );
}
