'use client';

import { useState, useMemo } from 'react';
import type { Bill } from '@/lib/billing';
import {
  downloadReceiptImage,
  copyReceiptImage,
  shareOrDownloadReceipt,
  getFunPrintLaunchInfo,
  isAbortError,
} from '@/lib/thermal-canvas';

export default function ThermalBillModal({
  bill,
  onClose,
  isReprint = false,
}: {
  bill: Bill;
  onClose: () => void;
  isReprint?: boolean;
}) {
  const [processing, setProcessing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const biz = bill.business_snapshot;
  const launchInfo = useMemo(() => getFunPrintLaunchInfo(), []);

  const formattedDate = new Date(bill.issued_at).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const formattedTime = new Date(bill.issued_at).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const handlePrintWithFunPrint = async () => {
    try {
      setProcessing(true);
      const res = await shareOrDownloadReceipt(bill, {
        scale: 1,
        isReprint,
      });

      if (res.action === 'shared') {
        setStatusMessage(
          'Receipt passed to your device’s share menu. Select Fun Print to send to your MX11 printer.'
        );
      } else if (res.action === 'cancelled') {
        // User dismissed the share sheet: do not download, leave preview intact
        return;
      } else if (res.action === 'downloaded') {
        setStatusMessage(
          'Receipt image downloaded (384px). Open Fun Print and tap "Print Image" to print via Bluetooth.'
        );
      } else if (res.action === 'failed') {
        setStatusMessage(
          'Could not export receipt image. Please tap "Download Receipt Image" directly.'
        );
      }
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      console.error('Fun Print workflow error:', err);
      setStatusMessage('Sharing unavailable. Tap "Download Receipt Image" instead.');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadImage = async () => {
    try {
      setDownloading(true);
      await downloadReceiptImage(bill, { scale: 1, isReprint });
      setStatusMessage(
        'Receipt image saved (384px). Open the Fun Print app, select "Print Image", and print via Bluetooth.'
      );
    } catch (err) {
      console.error('Download error:', err);
      setStatusMessage('Failed to download image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyImage = async () => {
    try {
      setCopying(true);
      const success = await copyReceiptImage(bill, { scale: 1, isReprint });
      if (success) {
        setCopied(true);
        setStatusMessage('Receipt image copied to clipboard (384px).');
        setTimeout(() => setCopied(false), 3000);
      } else {
        setStatusMessage('Clipboard image copy not supported in this browser. Use Download instead.');
      }
    } catch {
      setStatusMessage('Clipboard copy failed. Please use Download Receipt Image.');
    } finally {
      setCopying(false);
    }
  };

  const subtotal = bill.subtotal_paise ?? 0;
  const tax = bill.tax_paise ?? 0;
  const total = bill.total_paise ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Bill #${bill.bill_number}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !processing) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 60,
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div
        className="card"
        style={{
          width: 'min(100%, 460px)',
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: 20,
          display: 'grid',
          gap: 16,
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ color: 'var(--accent)', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              {isReprint ? 'Duplicate Bill' : 'Customer Bill'}
            </span>
            <h2 style={{ fontFamily: 'Georgia, serif', margin: '4px 0 0', fontSize: '1.4rem' }}>
              #{bill.bill_number}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="chip"
            style={{ padding: '6px 12px', fontSize: 12 }}
            aria-label="Close bill preview"
          >
            ✕ Close
          </button>
        </div>

        {/* Status Callout */}
        {statusMessage && (
          <div
            role="status"
            style={{
              padding: 12,
              borderRadius: 8,
              background: '#ffffff10',
              borderLeft: '3px solid var(--accent)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {statusMessage}
          </div>
        )}

        {/* 384px Thermal Paper Preview */}
        <div
          style={{
            background: '#ffffff',
            color: '#000000',
            borderRadius: 6,
            padding: '20px 14px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 11,
            lineHeight: 1.45,
            boxShadow: 'inset 0 0 10px rgba(0,0,0,0.08)',
            maxHeight: '44vh',
            overflowY: 'auto',
            border: '1px dashed #d1d5db',
          }}
        >
          {/* Receipt Header */}
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 13, display: 'block', letterSpacing: '.04em' }}>
              {(biz.legal_name || 'URBANIA CAFE AND JUICE BAR').toUpperCase()}
            </strong>
            {biz.cafe_name && biz.cafe_name !== biz.legal_name && (
              <div style={{ fontStyle: 'italic', fontSize: 11 }}>({biz.cafe_name})</div>
            )}
            <div style={{ fontSize: 10, marginTop: 4, color: '#374151' }}>
              {biz.address_line1 || '17/456, Chopasni Housing Board'}, {biz.city || 'Jodhpur'}, PIN: {biz.pincode || '342008'}
            </div>
            {biz.phone && <div style={{ fontSize: 10, color: '#374151' }}>Tel: {biz.phone}</div>}
            {biz.fssai_number && (
              <div style={{ fontSize: 10, fontWeight: 700, marginTop: 4 }}>
                FSSAI Lic No: {biz.fssai_number}
              </div>
            )}
            {biz.gst_status === 'registered' && biz.gstin ? (
              <div style={{ fontSize: 10, fontWeight: 700 }}>GSTIN: {biz.gstin}</div>
            ) : biz.gst_status === 'not_registered' ? (
              <div style={{ fontSize: 9, color: '#4b5563', marginTop: 2 }}>
                GST: Not Registered (Not a Tax Invoice)
              </div>
            ) : (
              <div style={{ fontSize: 9, color: '#4b5563', marginTop: 2 }}>
                GST: Pending Registration (Not a Tax Invoice)
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

          <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 12, letterSpacing: '.06em' }}>
            {bill.document_type === 'tax_invoice' && biz.gst_status === 'registered'
              ? 'TAX INVOICE'
              : 'BILL / CASH RECEIPT'}
          </div>
          {isReprint && (
            <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, marginTop: 2 }}>
              *** DUPLICATE / REPRINT ***
            </div>
          )}

          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

          {/* Metadata */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10 }}>
            <div>Bill No: {bill.bill_number}</div>
            <div style={{ textAlign: 'right' }}>Order: #{bill.order_number}</div>
            <div>Date: {formattedDate}</div>
            <div style={{ textAlign: 'right' }}>Time: {formattedTime}</div>
            <div>Table: {bill.table_label || `Table ${bill.table_number}`}</div>
            <div style={{ textAlign: 'right' }}>Dine-in</div>
          </div>

          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

          {/* Items Table */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) 0.5fr 0.8fr 0.9fr', fontWeight: 700, fontSize: 10, paddingBottom: 4 }}>
            <div>ITEM</div>
            <div style={{ textAlign: 'center' }}>QTY</div>
            <div style={{ textAlign: 'right' }}>RATE</div>
            <div style={{ textAlign: 'right' }}>AMT</div>
          </div>
          <div style={{ borderTop: '1px dashed #000', marginBottom: 6 }} />

          <div style={{ display: 'grid', gap: 6 }}>
            {bill.items_snapshot.map((item, idx) => {
              const unitPaise = item.unit_price_paise ?? (item as unknown as { unit_price_cents: number }).unit_price_cents ?? 0;
              const linePaise = item.line_total_paise ?? (item as unknown as { line_total_cents: number }).line_total_cents ?? (unitPaise * item.quantity);
              return (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) 0.5fr 0.8fr 0.9fr', fontSize: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{item.name}</div>
                    {item.selected_options && item.selected_options.length > 0 && (
                      <div style={{ fontStyle: 'italic', fontSize: 9, color: '#4b5563' }}>
                        + {item.selected_options.map((o) => o.name).join(', ')}
                      </div>
                    )}
                    {item.note && (
                      <div style={{ fontStyle: 'italic', fontSize: 9, color: '#4b5563' }}>
                        Note: {item.note}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'center' }}>{item.quantity}</div>
                  <div style={{ textAlign: 'right' }}>{(unitPaise / 100).toFixed(2)}</div>
                  <div style={{ textAlign: 'right' }}>{(linePaise / 100).toFixed(2)}</div>
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

          {/* Totals */}
          <div style={{ display: 'grid', gap: 4, fontSize: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal:</span>
              <span>₹{(subtotal / 100).toFixed(2)}</span>
            </div>
            {tax > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>GST:</span>
                <span>₹{(tax / 100).toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 12, marginTop: 4 }}>
              <span>TOTAL AMOUNT:</span>
              <span>₹{(total / 100).toFixed(2)}</span>
            </div>
          </div>

          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

          <div style={{ textAlign: 'center', fontSize: 10, fontStyle: 'italic' }}>
            {biz.bill_footer_text || 'Thank you for visiting Urbania Café!'}
          </div>
          <div style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, marginTop: 4 }}>
            FSSAI LICENCE NO. {biz.fssai_number || '12226032000212'}
          </div>
        </div>

        {/* Hardware & App Guidance Banner */}
        <div style={{ background: '#ffffff0a', borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <span className="muted">Target: <b>58 mm / MX11 Mini Printer (384px)</b></span>
            <a
              href={launchInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="chip"
              style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}
              title="Deliberate tap opens Fun Print or app store. Note: hardware intent launch is pending physical device verification."
            >
              ↗ {launchInfo.label}
            </a>
          </div>
          <small className="muted" style={{ display: 'block', marginTop: 4 }}>
            * Note: Sending to Fun Print shares or downloads the 384px receipt image. Actual Bluetooth printing is performed inside the Fun Print app.
          </small>
        </div>

        {/* Primary & Fallback Actions */}
        <div style={{ display: 'grid', gap: 8 }}>
          <button
            className="btn"
            onClick={handlePrintWithFunPrint}
            disabled={processing || downloading}
            style={{ width: '100%', padding: '14px', fontSize: 14 }}
          >
            {processing ? 'Preparing Receipt…' : isReprint ? 'Reprint with Fun Print' : 'Print Bill with Fun Print'}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              className="chip"
              onClick={handleDownloadImage}
              disabled={downloading || processing}
              style={{ padding: 10, textAlign: 'center' }}
            >
              {downloading ? 'Saving…' : 'Download Receipt Image'}
            </button>
            <button
              className="chip"
              onClick={handleCopyImage}
              disabled={copying || processing}
              style={{ padding: 10, textAlign: 'center' }}
            >
              {copying ? 'Copying…' : copied ? '✓ Copied' : 'Copy Image'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
