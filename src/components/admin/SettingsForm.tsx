'use client';

import { useState, useMemo } from 'react';

type Settings = {
  id?: string;
  cafe_name?: string;
  legal_name?: string;
  fssai_number?: string;
  fssai_validity_date?: string | null;
  address_line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
  pincode_verified?: boolean;
  phone?: string | null;
  email?: string | null;
  gst_status?: 'unconfirmed' | 'registered' | 'not_registered';
  gstin?: string | null;
  tax_treatment?: 'inclusive' | 'exclusive' | 'none';
  bill_prefix?: string;
  bill_header_text?: string | null;
  bill_footer_text?: string;
};

const fieldStyle = {
  padding: 10,
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: '#ffffff10',
  color: 'var(--ink)',
  width: '100%',
};

export default function SettingsForm({ initial }: { initial: Settings | null }) {
  const [form, setForm] = useState<Settings>({
    cafe_name: initial?.cafe_name || 'Urbania Café',
    legal_name: initial?.legal_name || 'URBANIA CAFE AND JUICE BAR',
    fssai_number: initial?.fssai_number || '12226032000212',
    fssai_validity_date: initial?.fssai_validity_date || '2027-02-22',
    address_line1: initial?.address_line1 || '17/456, Chopasni Housing Board',
    city: initial?.city || 'Jodhpur',
    state: initial?.state || 'Rajasthan',
    pincode: initial?.pincode || '342008',
    pincode_verified: initial?.pincode_verified ?? false,
    phone: initial?.phone || '',
    email: initial?.email || '',
    gst_status: initial?.gst_status || 'unconfirmed',
    gstin: initial?.gstin || '',
    tax_treatment: initial?.tax_treatment || 'inclusive',
    bill_prefix: initial?.bill_prefix || 'UB-',
    bill_header_text: initial?.bill_header_text || '',
    bill_footer_text: initial?.bill_footer_text || 'Thank you for visiting Urbania Café!',
  });

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const fssaiDaysRemaining = useMemo(() => {
    if (!form.fssai_validity_date) return null;
    const target = new Date(form.fssai_validity_date + 'T00:00:00');
    const now = new Date();
    const diff = target.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }, [form.fssai_validity_date]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setMessage({ text: 'Settings saved successfully.' });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Error saving settings', error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 20 }}>
      {message && (
        <div
          role="alert"
          style={{
            padding: 14,
            borderRadius: 8,
            borderLeft: `4px solid ${message.error ? '#df6d5d' : 'var(--accent)'}`,
            background: '#ffffff10',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Business Identity */}
      <section className="card" style={{ padding: 20, display: 'grid', gap: 14 }}>
        <h2 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: '1.3rem' }}>
          Business Identity & Legal Entity
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            Trade Name (Café Name)
            <input
              required
              value={form.cafe_name || ''}
              onChange={(e) => setForm({ ...form, cafe_name: e.target.value })}
              style={fieldStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            Legal Entity Name
            <input
              required
              value={form.legal_name || ''}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
              style={fieldStyle}
            />
          </label>
        </div>
      </section>

      {/* FSSAI Compliance */}
      <section className="card" style={{ padding: 20, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: '1.3rem' }}>
            FSSAI Food Safety Compliance
          </h2>
          {fssaiDaysRemaining !== null && (
            <span
              className="chip"
              style={{
                fontSize: 12,
                color: fssaiDaysRemaining < 60 ? '#df6d5d' : 'var(--accent)',
                borderColor: fssaiDaysRemaining < 60 ? '#df6d5d' : 'var(--accent)',
              }}
            >
              {fssaiDaysRemaining > 0 ? `Licence Valid: ${fssaiDaysRemaining} days remaining` : 'Licence Expired'}
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            FSSAI 14-Digit Licence Number
            <input
              required
              pattern="[0-9]{14}"
              maxLength={14}
              value={form.fssai_number || ''}
              onChange={(e) => setForm({ ...form, fssai_number: e.target.value })}
              style={{ ...fieldStyle, fontFamily: 'monospace' }}
              title="Must be exactly 14 numeric digits"
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            Licence Expiry Date
            <input
              type="date"
              value={form.fssai_validity_date || ''}
              onChange={(e) => setForm({ ...form, fssai_validity_date: e.target.value })}
              style={fieldStyle}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            Registered Address
            <input
              value={form.address_line1 || ''}
              onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
              style={fieldStyle}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              City
              <input
                value={form.city || ''}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              State
              <input
                value={form.state || ''}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              PIN Code
              <input
                value={form.pincode || ''}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                style={fieldStyle}
              />
            </label>
          </div>
        </div>

        {/* Address & PIN Verification Section */}
        <div
          style={{
            padding: 14,
            borderRadius: 8,
            background: form.pincode_verified ? '#10b98115' : '#f59e0b15',
            border: `1px solid ${form.pincode_verified ? '#10b98144' : '#f59e0b44'}`,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <b>📍 Business Premises & PIN Verification</b>
            <span
              className="chip"
              style={{
                fontSize: 11,
                borderColor: form.pincode_verified ? '#10b981' : '#f59e0b',
                color: form.pincode_verified ? '#10b981' : '#f59e0b',
              }}
            >
              {form.pincode_verified ? '✓ PIN Confirmed' : '⚠️ Verification Pending'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
            {form.pincode_verified
              ? 'Address and PIN code (342008) have been confirmed by the administrator against the physical café location.'
              : 'Registered certificate address: "17/456, Chopasni Housing Board, Jodhpur, Rajasthan 342008". Verification is pending: confirm that PIN 342008 matches local postal deliveries for Chopasni Housing Board before marking as verified.'}
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
            <input
              type="checkbox"
              checked={form.pincode_verified}
              onChange={(e) => setForm({ ...form, pincode_verified: e.target.checked })}
            />
            <span>I have verified that PIN code {form.pincode || '342008'} matches the physical café premises</span>
          </label>
        </div>
      </section>

      {/* GST & Tax Treatment */}
      <section className="card" style={{ padding: 20, display: 'grid', gap: 14 }}>
        <h2 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: '1.3rem' }}>
          GST Status & Billing Classification
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            GST Registration Status
            <select
              value={form.gst_status}
              onChange={(e) =>
                setForm({ ...form, gst_status: e.target.value as Settings['gst_status'] })
              }
              style={fieldStyle}
            >
              <option value="unconfirmed">Pending / Unconfirmed Registration</option>
              <option value="not_registered">Not Registered (Exempt / Below Threshold)</option>
              <option value="registered" disabled>
                Registered (Disabled pending itemized GST engine)
              </option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            GSTIN (if registered)
            <input
              placeholder="e.g. 08AAAAA0000A1Z5"
              value={form.gstin || ''}
              disabled={form.gst_status !== 'registered'}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
              style={{ ...fieldStyle, opacity: form.gst_status === 'registered' ? 1 : 0.5 }}
            />
          </label>
        </div>

        {/* GST Warning callout */}
        <div style={{ padding: 12, borderRadius: 8, background: '#ffffff0a', fontSize: 12, lineHeight: 1.5 }}>
          <b>🛡️ Legal Notice:</b> When GST status is pending or unregistered, customer receipts are issued as{' '}
          <b>BILL / CASH RECEIPT</b> without tax invoices. Switching to Registered is temporarily disabled until itemized CGST + SGST tax calculation is configured in the billing engine.
        </div>
      </section>

      {/* Thermal Receipt Configuration */}
      <section className="card" style={{ padding: 20, display: 'grid', gap: 14 }}>
        <h2 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: '1.3rem' }}>
          Thermal Receipt (58mm / MX11) Layout
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            Bill Prefix
            <input
              value={form.bill_prefix || 'UB-'}
              maxLength={6}
              onChange={(e) => setForm({ ...form, bill_prefix: e.target.value })}
              style={fieldStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
            Bill Footer Text
            <input
              value={form.bill_footer_text || ''}
              onChange={(e) => setForm({ ...form, bill_footer_text: e.target.value })}
              style={fieldStyle}
            />
          </label>
        </div>
      </section>

      <button className="btn" type="submit" disabled={saving} style={{ padding: 16, fontSize: 14 }}>
        {saving ? 'Saving Settings…' : 'Save Business & FSSAI Settings'}
      </button>
    </form>
  );
}
