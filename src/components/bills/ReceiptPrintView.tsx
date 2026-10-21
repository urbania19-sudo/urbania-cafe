'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { Bill } from '@/lib/billing';
import { renderReceiptToCanvas } from '@/lib/thermal-canvas';

const emptySubscribe = () => () => {};

export function HtmlReceipt({ bill, isReprint = false }: { bill: Bill; isReprint?: boolean }) {
  const biz = bill.business_snapshot;
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
  const subtotal = bill.subtotal_paise ?? 0;
  const tax = bill.tax_paise ?? 0;
  const total = bill.total_paise ?? 0;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 384,
        background: '#ffffff',
        color: '#000000',
        padding: '16px 14px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        margin: '0 auto',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 18, display: 'block', letterSpacing: '.03em', fontWeight: 900 }}>
          {(biz.legal_name || 'URBANIA CAFE AND JUICE BAR').toUpperCase()}
        </strong>
        <div style={{ fontSize: 12, marginTop: 4, color: '#374151' }}>
          {biz.address_line1 || '17/456, Chopasni Housing Board'}, {biz.city || 'Jodhpur'}, PIN: {biz.pincode || '342008'}
        </div>
        {biz.phone && <div style={{ fontSize: 12, color: '#374151' }}>Tel: {biz.phone}</div>}
        {biz.fssai_number && (
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>
            FSSAI Lic No: {biz.fssai_number}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 16 }}>
        {bill.document_type === 'tax_invoice' && biz.gst_status === 'registered'
          ? 'TAX INVOICE'
          : 'BILL / CASH RECEIPT'}
      </div>
      {isReprint && (
        <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, marginTop: 2 }}>
          *** DUPLICATE / REPRINT ***
        </div>
      )}

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 13 }}>
        <div>Bill: {bill.bill_number}</div>
        <div style={{ textAlign: 'right' }}>Order: #{bill.order_number}</div>
        <div>Date: {formattedDate}</div>
        <div style={{ textAlign: 'right' }}>Time: {formattedTime}</div>
        <div>Table: {bill.table_label || `Table ${bill.table_number}`}</div>
        <div style={{ textAlign: 'right' }}>{bill.service_mode ? bill.service_mode.toUpperCase() : 'Dine-in'}</div>
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.6fr 0.8fr 0.9fr', fontWeight: 700, fontSize: 13, paddingBottom: 2 }}>
        <div>ITEM</div>
        <div style={{ textAlign: 'center' }}>QTY</div>
        <div style={{ textAlign: 'right' }}>RATE</div>
        <div style={{ textAlign: 'right' }}>AMOUNT</div>
      </div>
      <div style={{ borderTop: '1px dashed #000', marginBottom: 6 }} />

      <div style={{ display: 'grid', gap: 8 }}>
        {bill.items_snapshot.map((item, idx) => {
          const unitPaise = item.unit_price_paise ?? (item as unknown as { unit_price_cents: number }).unit_price_cents ?? 0;
          const linePaise = item.line_total_paise ?? (item as unknown as { line_total_cents: number }).line_total_cents ?? (unitPaise * item.quantity);
          return (
            <div key={idx} style={{ display: 'grid', gap: 2 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.6fr 0.8fr 0.9fr', fontSize: 13 }}>
                <div />
                <div style={{ textAlign: 'center' }}>{item.quantity}</div>
                <div style={{ textAlign: 'right' }}>{(unitPaise / 100).toFixed(2)}</div>
                <div style={{ textAlign: 'right' }}>{(linePaise / 100).toFixed(2)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 16, marginTop: 4 }}>
          <span>TOTAL:</span>
          <span>₹{(total / 100).toFixed(2)}</span>
        </div>
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ textAlign: 'center', fontSize: 12, fontStyle: 'italic' }}>
        {biz.bill_footer_text || 'Thank you for visiting Urbania Café!'}
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, marginTop: 3 }}>
        FSSAI LICENCE NO. {biz.fssai_number || '12226032000212'}
      </div>
    </div>
  );
}

export default function ReceiptPrintView({
  bill,
  isReprint = false,
}: {
  bill: Bill;
  isReprint?: boolean;
}) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const receiptMeta = useMemo(() => {
    if (!isClient) return null;
    try {
      const canvas = renderReceiptToCanvas(bill, { scale: 1, isReprint });
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      };
    } catch (err) {
      console.error('Error rendering receipt canvas:', err);
      return null;
    }
  }, [bill, isReprint, isClient]);

  return (
    <div
      style={{
        background: '#ffffff',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 0,
        margin: 0,
      }}
    >
      {/* Print specific CSS styles for 58 mm thermal printers */}
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
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          `,
        }}
      />

      {/* Clean Receipt Container (384px for 58mm thermal printhead) */}
      <main
        style={{
          width: '100%',
          maxWidth: 384,
          margin: '0 auto',
          background: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingBottom: 80,
        }}
      >
        {receiptMeta ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={receiptMeta.dataUrl}
            width={receiptMeta.width}
            height={receiptMeta.height}
            alt={`Bill #${bill.bill_number}`}
            style={{
              width: '100%',
              maxWidth: 384,
              height: 'auto',
              display: 'block',
              margin: '0 auto',
              background: '#ffffff',
            }}
          />
        ) : (
          <HtmlReceipt bill={bill} isReprint={isReprint} />
        )}
      </main>

      {/* Floating Action & Guidance Bar (Hidden when printing) */}
      <footer
        className="no-print"
        style={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(92%, 420px)',
          background: '#18181b',
          color: '#ffffff',
          borderRadius: 12,
          padding: '12px 16px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 50,
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: '#f59e0b' }}>
            🖨️ Fun Print on Android:
          </span>
          <button
            onClick={() => window.print()}
            style={{
              background: '#f59e0b',
              color: '#000000',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Print Dialog
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.4 }}>
          In Fun Print&rsquo;s browser, tap menu (<b>⋮</b>) &gt; <b>&ldquo;Print Current Page&rdquo;</b> to print directly to your MX11.
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            borderTop: '1px solid #27272a',
            paddingTop: 8,
          }}
        >
          <button
            onClick={() => window.history.back()}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            ← Back
          </button>
          <Link
            href="/staff"
            style={{
              color: '#9ca3af',
              fontSize: 12,
              textDecoration: 'underline',
            }}
          >
            Staff Portal
          </Link>
        </div>
      </footer>
    </div>
  );
}
