'use client';

import { useState, useEffect } from 'react';
import {
  renderKitchenTicketToCanvas,
  type KitchenTicketOrder,
} from '@/lib/thermal-canvas';

export default function KitchenTicketModal({
  order,
  onClose,
  isReprint = false,
}: {
  order: KitchenTicketOrder;
  onClose: () => void;
  isReprint?: boolean;
}) {
  const [ticketMeta, setTicketMeta] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    try {
      const canvas = renderKitchenTicketToCanvas(order, { scale: 1, isReprint });
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
        const canvas = renderKitchenTicketToCanvas(order, { scale: 1, isReprint });
        setTicketMeta({
          dataUrl: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height,
        });
      } catch (err) {
        console.error('Error rendering kitchen ticket canvas:', err);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [order, isReprint]);

  function handlePrint(e: React.MouseEvent) {
    e.stopPropagation();
    if (!ticketMeta) return;

    // Use dedicated hidden iframe print for 100% reliable print isolation
    let printIframe = document.getElementById('kot-print-frame') as HTMLIFrameElement;
    if (!printIframe) {
      printIframe = document.createElement('iframe');
      printIframe.id = 'kot-print-frame';
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      document.body.appendChild(printIframe);
    }

    const doc = printIframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Kitchen Token #${order.order_number}</title>
          <style>
            @page {
              size: 58mm auto;
              margin: 0mm;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              width: 100% !important;
              overflow: hidden !important;
            }
            img {
              display: block !important;
              width: 100% !important;
              max-width: 384px !important;
              margin: 0 auto !important;
              padding: 0 !important;
            }
          </style>
        </head>
        <body>
          <img src="${ticketMeta.dataUrl}" alt="Kitchen Token #${order.order_number}" />
        </body>
        </html>
      `);
      doc.close();

      setTimeout(() => {
        try {
          printIframe.contentWindow?.focus();
          printIframe.contentWindow?.print();
        } catch {
          window.print();
        }
      }, 100);
      return;
    }

    window.print();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Kitchen Ticket Order #${order.order_number}`}
      onClick={onClose}
      title="Tap anywhere to return"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 14, 12, 0.85)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        color: '#000000',
        zIndex: 9999,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px 12px 48px',
        margin: 0,
        cursor: 'pointer',
      }}
    >
      {/* 58mm Thermal Printer CSS with Print Isolation for direct window print */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page {
              size: 58mm auto;
              margin: 0mm;
            }
            @media print {
              html, body {
                background: #ffffff !important;
                color: #000000 !important;
                margin: 0 !important;
                padding: 0 !important;
                width: 100% !important;
              }
              body * {
                visibility: hidden !important;
              }
              .no-print,
              .no-print *,
              header,
              nav,
              aside,
              footer,
              button {
                display: none !important;
                visibility: hidden !important;
                height: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
              }
              #kitchen-ticket-printable-root,
              #kitchen-ticket-printable-root * {
                visibility: visible !important;
              }
              #kitchen-ticket-printable-root {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                max-width: 384px !important;
                margin: 0 auto !important;
                padding: 0 !important;
                display: block !important;
                background: #ffffff !important;
                box-shadow: none !important;
                border-radius: 0 !important;
              }
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
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

      {/* Floating Action Header (visible on screen only, completely excluded in print) */}
      <div
        className="no-print"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'sticky',
          top: 0,
          width: '100%',
          maxWidth: 384,
          background: 'var(--card, #2b1b16)',
          border: '1px solid var(--line, #4d3327)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          marginBottom: 16,
          zIndex: 10,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink, #f5ead9)' }}>
          Kitchen Token #{order.order_number}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handlePrint}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              background: 'var(--accent, #c89f65)',
              color: '#2b1b16',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            🖨️ Print
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'rgba(255,255,255,0.1)',
              color: 'var(--ink, #f5ead9)',
              border: '1px solid var(--line, #4d3327)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Clean 384px Kitchen Ticket printable container */}
      <main
        id="kitchen-ticket-printable-root"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 384,
          margin: '0 auto',
          background: '#ffffff',
          borderRadius: 4,
          boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 0,
          cursor: 'default',
        }}
      >
        {ticketMeta && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={ticketMeta.dataUrl}
            width={ticketMeta.width}
            height={ticketMeta.height}
            alt={`Kitchen Ticket Order #${order.order_number}`}
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
