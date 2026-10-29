'use client';

import { useState } from 'react';

export default function CollectPaymentModal({
  orderNumber,
  billId,
  totalPaise,
  paidPaise = 0,
  onClose,
  onSuccess,
}: {
  orderNumber: number;
  billId: string;
  totalPaise: number;
  paidPaise?: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const remainingPaise = Math.max(0, totalPaise - paidPaise);
  const remainingRupees = remainingPaise / 100;

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi'>('cash');
  const [amountRupees, setAmountRupees] = useState<string>(remainingRupees.toFixed(2));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const enteredAmount = parseFloat(amountRupees);
    if (isNaN(enteredAmount) || enteredAmount <= 0) {
      setError('Please enter a valid payment amount greater than zero.');
      return;
    }

    const enteredPaise = Math.round(enteredAmount * 100);
    if (enteredPaise > remainingPaise) {
      setError(`Amount cannot exceed the remaining balance of ₹${remainingRupees.toFixed(2)}.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const idempotencyKey = `pay-${billId}-${Date.now()}`;
      const res = await fetch(`/api/staff/bills/${billId}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payment_method: paymentMethod,
          amount_rupees: enteredAmount,
          notes: notes.trim() || null,
          idempotency_key: idempotencyKey,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to record payment. Please try again.');
      }

      onSuccess();
    } catch (err) {
      console.error('Payment collection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to record payment.');
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
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
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 'calc(16px + env(safe-area-inset-top, 0px)) 12px calc(24px + env(safe-area-inset-bottom, 0px)) 12px',
        zIndex: 1000,
        boxSizing: 'border-box',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 440,
          width: '100%',
          padding: 24,
          borderRadius: 12,
          background: 'var(--surface, #1e1b18)',
          border: '1px solid var(--line, #3a322c)',
          color: 'var(--ink, #f3eae1)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          margin: 'auto 0',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: '1.25rem' }}>
            Collect Payment · Order #{orderNumber}
          </h3>
          <button
            type="button"
            className="chip"
            onClick={onClose}
            disabled={submitting}
            style={{ padding: '4px 8px', fontSize: 13 }}
          >
            ✕
          </button>
        </div>

        {/* Bill Summary */}
        <div
          style={{
            padding: '12px 16px',
            background: '#ffffff08',
            borderRadius: 8,
            marginBottom: 20,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted, #a89485)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Bill Total
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>
              ₹{(totalPaise / 100).toFixed(2)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted, #a89485)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Paid
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4, color: '#10b981' }}>
              ₹{(paidPaise / 100).toFixed(2)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted, #a89485)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Balance Due
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4, color: 'var(--accent, #c89f65)' }}>
              ₹{remainingRupees.toFixed(2)}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          {/* Payment Method Selector */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--accent)' }}>
              Select Payment Method
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                style={{
                  padding: '12px 10px',
                  borderRadius: 8,
                  border: `2px solid ${paymentMethod === 'cash' ? 'var(--accent)' : 'var(--line)'}`,
                  background: paymentMethod === 'cash' ? 'rgba(200, 159, 101, 0.15)' : 'transparent',
                  color: paymentMethod === 'cash' ? 'var(--ink)' : 'var(--muted)',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>💵</span> Cash
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('upi')}
                style={{
                  padding: '12px 10px',
                  borderRadius: 8,
                  border: `2px solid ${paymentMethod === 'upi' ? 'var(--accent)' : 'var(--line)'}`,
                  background: paymentMethod === 'upi' ? 'rgba(200, 159, 101, 0.15)' : 'transparent',
                  color: paymentMethod === 'upi' ? 'var(--ink)' : 'var(--muted)',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>📱</span> Online / UPI
              </button>
            </div>
          </div>

          {/* Amount Received Input */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                Amount Received (₹)
              </label>
              {parseFloat(amountRupees) !== remainingRupees && (
                <button
                  type="button"
                  onClick={() => setAmountRupees(remainingRupees.toFixed(2))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: 11,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Set Full Balance (₹{remainingRupees.toFixed(2)})
                </button>
              )}
            </div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={remainingRupees}
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              placeholder="0.00"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: '#ffffff10',
                color: 'var(--ink)',
                fontSize: 16,
                fontWeight: 600,
                outline: 'none',
              }}
              required
            />
          </div>

          {/* Optional Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
              Note / Reference (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={paymentMethod === 'upi' ? 'e.g. UTR / Transaction ID' : 'e.g. Received exact change'}
              maxLength={150}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: '#ffffff08',
                color: 'var(--ink)',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          {error && (
            <p role="alert" style={{ color: '#df6d5d', fontSize: 13, margin: 0 }}>
              {error}
            </p>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="button"
              className="chip"
              onClick={onClose}
              disabled={submitting}
              style={{ padding: '8px 16px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn"
              disabled={submitting}
              style={{
                padding: '8px 20px',
                fontWeight: 700,
                background: 'var(--accent)',
                color: '#1a1410',
              }}
            >
              {submitting ? 'Recording…' : `Confirm ${paymentMethod === 'cash' ? 'Cash' : 'Online / UPI'} Payment`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
