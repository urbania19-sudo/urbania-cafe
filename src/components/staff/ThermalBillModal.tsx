'use client';

import { useState, useMemo } from 'react';
import type { Bill } from '@/lib/billing';
import {
  downloadReceiptImage,
  copyReceiptImage,
  shareOrDownloadReceipt,
  getFunPrintLaunchInfo,
  exportReceiptDataUrl,
  getSharingCapabilities,
  getMeaningfulTagline,
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
  const capabilities = useMemo(() => getSharingCapabilities(), []);
  const meaningfulTagline = useMemo(() => getMeaningfulTagline(biz), [biz]);

  // Pre-render the 384px dot-pitch PNG data URL for native <img> display
  const receiptDataUrl = useMemo(() => {
    try {
      return exportReceiptDataUrl(bill, { scale: 1, isReprint });
    } catch {
      return null;
    }
  }, [bill, isReprint]);

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

  const recordReprint = (actionType: string) => {
    if (!isReprint) return;
    fetch(`/api/staff/bills/${bill.id}/reprint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionType, source: 'thermal_modal' }),
    }).catch(() => {});
  };

  const handlePrintWithFunPrint = async () => {
    try {
      setProcessing(true);
      const res = await shareOrDownloadReceipt(bill, {
        scale: 1,
        isReprint,
      });

      if (res.action === 'shared') {
        recordReprint('share');
        setStatusMessage(
          'Receipt passed to your device’s share menu. If saving for Fun Print, choose "Save Image" (to Photos), then open Fun Print and tap "Print Image".'
        );
      } else if (res.action === 'cancelled') {
        // User dismissed the share sheet: leave preview intact without error
        return;
      } else if (res.action === 'downloaded') {
        recordReprint('download');
        if (capabilities.isIOS && !capabilities.isSecureContext) {
          setStatusMessage(
            'Native Web Share requires HTTPS. On this local HTTP connection, tap & hold the receipt image below to choose "Save to Photos", then open Fun Print.'
          );
        } else {
          setStatusMessage(
            'Receipt image downloaded (384px). Open Fun Print and tap "Print Image" to print via Bluetooth.'
          );
        }
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
      recordReprint('download');
      if (capabilities.isIOS) {
        setStatusMessage(
          'Receipt image ready (384px). On your iPhone, tap and hold the receipt image below to "Save to Photos", or tap "View Full PNG".'
        );
      } else {
        setStatusMessage(
          'Receipt image saved (384px). Open the Fun Print app, select "Print Image", and print via Bluetooth.'
        );
      }
    } catch (err) {
      console.error('Download error:', err);
      setStatusMessage('Failed to download image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleViewFullImage = () => {
    if (!receiptDataUrl) return;
    const win = window.open();
    if (win) {
      win.document.write(
        `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bill #${bill.bill_number}</title></head><body style="margin:0;padding:20px;background:#18181b;display:grid;place-items:center;min-height:100vh;"><p style="color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;font-size:14px;margin:0 0 16px;text-align:center;">📱 iPhone: <b>Tap &amp; hold</b> image below to <b>&ldquo;Save to Photos&rdquo;</b></p><img src="${receiptDataUrl}" alt="Receipt" style="background:#fff;max-width:384px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,0.6);border-radius:4px;display:block;"/></body></html>`
      );
      win.document.close();
    }
  };

  const handleCopyImage = async () => {
    try {
      setCopying(true);
      const success = await copyReceiptImage(bill, { scale: 1, isReprint });
      if (success) {
        recordReprint('clipboard_copy');
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

        {/* iPhone Save Guide Banner */}
        {capabilities.isIOS && (
          <div
            style={{
              background: 'rgba(217, 119, 6, 0.12)',
              borderLeft: '3px solid #f59e0b',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: '#d97706', display: 'block', marginBottom: 2 }}>
              📱 iPhone (Chrome for iOS) Print Guide:
            </strong>
            1. <b>Tap &amp; hold</b> the receipt image below to choose <b>&ldquo;Save to Photos&rdquo;</b>.<br />
            2. Open <b>Fun Print</b>, tap <b>&ldquo;Print Image&rdquo;</b>, and select the saved receipt.
          </div>
        )}

        {/* Actual 384px Dot-Pitch PNG Image (Ready for Long-Press Save on iOS) */}
        {receiptDataUrl && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              padding: '8px',
              textAlign: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              maxHeight: '38vh',
              overflowY: 'auto',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receiptDataUrl}
              alt={`Receipt Bill #${bill.bill_number}`}
              style={{
                width: 384,
                maxWidth: '100%',
                height: 'auto',
                display: 'block',
                margin: '0 auto',
                cursor: 'pointer',
              }}
              title="Tap and hold on iPhone to Save to Photos"
            />
          </div>
        )}

        {/* 384px Thermal Paper Preview & Accessible Detail Table */}
        <details
          style={{
            background: '#ffffff08',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 11,
            lineHeight: 1.45,
            border: '1px solid var(--line)',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--accent)' }}>
            View Full Receipt Text &amp; Breakdown
          </summary>

          <div
            style={{
              background: '#ffffff',
              color: '#000000',
              borderRadius: 6,
              padding: '16px 14px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
              marginTop: 10,
              border: '1px dashed #d1d5db',
            }}
          >
            {/* Receipt Header */}
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 18, display: 'block', letterSpacing: '.03em', fontWeight: 900 }}>
                {(biz.legal_name || 'URBANIA CAFE AND JUICE BAR').toUpperCase()}
              </strong>
              {meaningfulTagline && (
                <div style={{ fontStyle: 'italic', fontSize: 14, fontWeight: 700, marginTop: 3 }}>({meaningfulTagline})</div>
              )}
              <div style={{ fontSize: 13, marginTop: 6, color: '#374151', lineHeight: 1.4 }}>
                {biz.address_line1 || '17/456, Chopasni Housing Board'}, {biz.city || 'Jodhpur'}, PIN: {biz.pincode || '342008'}
              </div>
              {biz.phone && <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>Tel: {biz.phone}</div>}
              {biz.fssai_number && (
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                  FSSAI Lic No: {biz.fssai_number}
                </div>
              )}
              {biz.gst_status === 'registered' && biz.gstin ? (
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>GSTIN: {biz.gstin}</div>
              ) : biz.gst_status === 'not_registered' ? (
                <div style={{ fontSize: 13, color: '#4b5563', marginTop: 3 }}>
                  GST: Not Registered (Not a Tax Invoice)
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#4b5563', marginTop: 3 }}>
                  GST: Pending Registration (Not a Tax Invoice)
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '12px 0' }} />

            <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 18, letterSpacing: '.06em' }}>
              {bill.document_type === 'tax_invoice' && biz.gst_status === 'registered'
                ? 'TAX INVOICE'
                : 'BILL / CASH RECEIPT'}
            </div>
            {isReprint && (
              <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, marginTop: 3 }}>
                *** DUPLICATE / REPRINT ***
              </div>
            )}

            <div style={{ borderTop: '1px dashed #000', margin: '12px 0' }} />

            {/* Metadata */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 14 }}>
              <div>Bill No: {bill.bill_number}</div>
              <div style={{ textAlign: 'right' }}>Order: #{bill.order_number}</div>
              <div>Date: {formattedDate}</div>
              <div style={{ textAlign: 'right' }}>Time: {formattedTime}</div>
              <div>Table: {bill.table_label || `Table ${bill.table_number}`}</div>
              <div style={{ textAlign: 'right' }}>Dine-in</div>
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '12px 0' }} />

            {/* Items Table Headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.6fr 0.8fr 0.9fr', fontWeight: 700, fontSize: 14, paddingBottom: 4 }}>
              <div>ITEM</div>
              <div style={{ textAlign: 'center' }}>QTY</div>
              <div style={{ textAlign: 'right' }}>RATE</div>
              <div style={{ textAlign: 'right' }}>AMOUNT</div>
            </div>
            <div style={{ borderTop: '1px dashed #000', marginBottom: 10 }} />

            {/* Items List (Multi-line layout) */}
            <div style={{ display: 'grid', gap: 12 }}>
              {bill.items_snapshot.map((item, idx) => {
                const unitPaise = item.unit_price_paise ?? (item as unknown as { unit_price_cents: number }).unit_price_cents ?? 0;
                const linePaise = item.line_total_paise ?? (item as unknown as { line_total_cents: number }).line_total_cents ?? (unitPaise * item.quantity);
                return (
                  <div key={idx} style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{item.name}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.6fr 0.8fr 0.9fr', fontSize: 14 }}>
                      <div />
                      <div style={{ textAlign: 'center' }}>{item.quantity}</div>
                      <div style={{ textAlign: 'right' }}>{(unitPaise / 100).toFixed(2)}</div>
                      <div style={{ textAlign: 'right' }}>{(linePaise / 100).toFixed(2)}</div>
                    </div>
                    {item.selected_options && item.selected_options.length > 0 && (
                      <div style={{ fontStyle: 'italic', fontSize: 13, color: '#4b5563', paddingLeft: 8 }}>
                        + {item.selected_options.map((o) => o.name).join(', ')}
                      </div>
                    )}
                    {item.note && (
                      <div style={{ fontStyle: 'italic', fontSize: 13, color: '#4b5563', paddingLeft: 8 }}>
                        Note: {item.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '12px 0' }} />

            {/* Totals */}
            <div style={{ display: 'grid', gap: 6, fontSize: 15 }}>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 18, marginTop: 6 }}>
                <span>TOTAL AMOUNT:</span>
                <span>₹{(total / 100).toFixed(2)}</span>
              </div>
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '12px 0' }} />

            <div style={{ textAlign: 'center', fontSize: 13, fontStyle: 'italic' }}>
              {biz.bill_footer_text || 'Thank you for visiting Urbania Café!'}
            </div>
            <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, marginTop: 4 }}>
              FSSAI LICENCE NO. {biz.fssai_number || '12226032000212'}
            </div>
          </div>
        </details>

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
            * Note: Sending to Fun Print shares or saves the 384px receipt image. Actual Bluetooth printing is performed inside the Fun Print app.
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
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
              onClick={handleViewFullImage}
              disabled={processing || !receiptDataUrl}
              style={{ padding: 10, textAlign: 'center' }}
            >
              View Full PNG
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
