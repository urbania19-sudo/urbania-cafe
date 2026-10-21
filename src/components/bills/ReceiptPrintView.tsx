'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Bill } from '@/lib/billing';
import { renderReceiptToCanvas } from '@/lib/thermal-canvas';

export default function ReceiptPrintView({
  bill,
  isReprint = false,
}: {
  bill: Bill;
  isReprint?: boolean;
}) {
  const receiptMeta = useMemo(() => {
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
  }, [bill, isReprint]);

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
          <div style={{ padding: 40, color: '#6b7280', fontSize: 14 }}>
            Rendering receipt…
          </div>
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
