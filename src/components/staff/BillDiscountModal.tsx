'use client';

import { useState, useMemo } from 'react';
import { calculateBillDiscount, type DiscountType } from '@/lib/billing';

export default function BillDiscountModal({
  orderNumber,
  subtotalPaise,
  onClose,
  onConfirm,
}: {
  orderNumber: number;
  subtotalPaise: number;
  onClose: () => void;
  onConfirm: (discount?: { type: DiscountType; value: number }) => Promise<void>;
}) {
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [discountValue, setDiscountValue] = useState<string>('');
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

    setSubmitting(true);
    try {
      await onConfirm(discountPayload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate bill.');
      setSubmitting(false);
    }
  }

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
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 9998,
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          width: 'min(100%, 440px)',
          padding: 24,
          background: 'var(--card, #37241d)',
          display: 'grid',
          gap: 16,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: '1.4rem' }}>
            Issue Bill · Order #{orderNumber}
          </h2>
          <button
            type="button"
            className="chip"
            onClick={onClose}
            disabled={submitting}
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

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

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            className="chip"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={submitting}
            onClick={handleGenerate}
            style={{ fontWeight: 700 }}
          >
            {submitting ? 'Generating…' : 'Generate Bill & Receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}
