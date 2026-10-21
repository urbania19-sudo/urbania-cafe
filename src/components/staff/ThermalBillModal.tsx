'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Bill } from '@/lib/billing';
import {
  renderReceiptToCanvas,
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
  const router = useRouter();
  const [inPagePrintView, setInPagePrintView] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const biz = bill.business_snapshot;
  const launchInfo = useMemo(() => getFunPrintLaunchInfo(), []);
  const capabilities = useMemo(() => getSharingCapabilities(), []);
  const meaningfulTagline = useMemo(() => getMeaningfulTagline(biz), [biz]);

  // Pre-render the 384px dot-pitch PNG data URL and exact dimensions for <img> display
  const [receiptMeta, setReceiptMeta] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    try {
      const canvas = renderReceiptToCanvas(bill, { scale: 1, isReprint });
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      };
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let isMounted = true;
    requestAnimationFrame(() => {
      if (!isMounted) return;
      try {
        const canvas = renderReceiptToCanvas(bill, { scale: 1, isReprint });
        setReceiptMeta({
          dataUrl: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height,
        });
      } catch (err) {
        console.error('Error rendering receipt canvas:', err);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [bill, isReprint]);

  const receiptDataUrl = receiptMeta?.dataUrl ?? null;

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

  const printViewUrl = `/staff/bills/${bill.id}/print${isReprint ? '?reprint=true' : ''}`;

  const handlePrintWithFunPrint = () => {
    recordReprint('open_fun_print_view');
    // Open full-screen print view directly in-page to avoid any Android WebView URL intercepts or "Open with" dialogue
    setInPagePrintView(true);
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
          `Receipt image saved (Bill-${bill.bill_number}-384px.png). You can print it via Fun Print app > "Print Image", or use "Print Bill with Fun Print" directly.`
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
    recordReprint('view_full_png');
    // Open in-page clean print view directly to prevent Android OS "Open with" dialogue
    setInPagePrintView(true);
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

  if (inPagePrintView) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Print Receipt Bill #${bill.bill_number}`}
        onClick={() => setInPagePrintView(false)}
        title="Tap receipt to return"
        style={{
          position: 'fixed',
          inset: 0,
          background: '#ffffff',
          color: '#000000',
          zIndex: 9999,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
        }}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @page {
                size: 58mm auto;
                margin: 0mm;
              }
              html, body {
                background: #ffffff !important;
                color: #000000 !important;
                margin: 0 !important;
                padding: 0 !important;
                width: 100% !important;
              }
              @media print {
                .no-print {
                  display: none !important;
                }
              }
              /* Exclude Vercel Preview Toolbar and overlay widgets from print and view */
              vercel-live-feedback,
              [data-vercel-toolbar],
              [class*="vercel-toolbar"],
              #vercel-live-feedback,
              #vercel-toolbar,
              #vercel-toolbar-container {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
                width: 0 !important;
                height: 0 !important;
                overflow: hidden !important;
              }
            `,
          }}
        />

        {/* Clean Receipt Container: ONLY the genuine 384px PNG receipt on pure white */}
        <main
          style={{
            width: '100%',
            maxWidth: 384,
            margin: '0 auto',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: 0,
          }}
        >
          {receiptMeta && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={receiptMeta.dataUrl}
              width={receiptMeta.width}
              height={receiptMeta.height}
              alt={`Receipt Bill #${bill.bill_number}`}
              style={{
                width: '100%',
                maxWidth: 384,
                height: 'auto',
                display: 'block',
                margin: '0 auto',
                background: '#ffffff',
              }}
            />
          )}
        </main>
      </div>
    );
  }

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

        {/* Android Fun Print Guide Banner */}
        {!capabilities.isIOS && (
          <div
            style={{
              background: 'rgba(213, 168, 75, 0.12)',
              borderLeft: '3px solid var(--accent)',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: 'var(--accent)', display: 'block', marginBottom: 2 }}>
              🖨️ Fun Print on Android (MX11 Printer):
            </strong>
            1. Tap <b>&ldquo;{isReprint ? 'Reprint with Fun Print' : 'Print Bill with Fun Print'}&rdquo;</b> below to open the clean receipt print view.<br />
            2. In Fun Print&rsquo;s browser, tap menu (<b>⋮</b>) &gt; <b>&ldquo;Print Current Page&rdquo;</b> to print directly to your MX11.
          </div>
        )}

        {/* Actual 384px Dot-Pitch PNG Image (Ready for Long-Press Save on iOS) */}
        {receiptMeta && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              padding: '12px 8px',
              textAlign: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              border: '1px solid var(--line)',
              maxHeight: '44vh',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receiptMeta.dataUrl}
              width={receiptMeta.width}
              height={receiptMeta.height}
              alt={`Receipt Bill #${bill.bill_number}`}
              onClick={handleViewFullImage}
              style={{
                width: '100%',
                maxWidth: 384,
                height: 'auto',
                display: 'block',
                margin: '0 auto',
                background: '#ffffff',
                cursor: 'pointer',
              }}
              title="Tap to open clean full receipt print view"
            />
            <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280', fontWeight: 500 }}>
              58 mm Thermal Printhead Preview (384 px) • Tap image to open full print view
            </div>
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
              {tax > 0 && biz.gst_status === 'registered' && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{biz.tax_treatment === 'inclusive' ? `Incl. GST (${((bill.tax_rate ?? 0) * 100).toFixed(0)}%):` : 'GST:'}</span>
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
              onClick={(e) => {
                e.preventDefault();
                setStatusMessage('You are already inside Fun Print. Tap "Print Bill with Fun Print", then use browser menu (⋮) > "Print Current Page".');
              }}
              className="chip"
              style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}
              title="Fun Print App info"
            >
              ↗ {launchInfo.label}
            </a>
          </div>
          <small className="muted" style={{ display: 'block', marginTop: 4 }}>
            * Note: To print on your MX11, tap &ldquo;{isReprint ? 'Reprint with Fun Print' : 'Print Bill with Fun Print'}&rdquo; below, then in Fun Print&rsquo;s browser menu (⋮), tap &ldquo;Print Current Page&rdquo;.
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
