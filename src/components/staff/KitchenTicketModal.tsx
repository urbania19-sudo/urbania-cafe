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
      {/* 58mm Thermal Printer CSS */}
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

      {/* Floating Action Header (hidden in print) */}
      <div
        className="no-print"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'sticky',
          top: 0,
          width: '100%',
          maxWidth: 384,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid #e5e5e5',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          zIndex: 10,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: '#2b1b16' }}>
          Kitchen Token #{order.order_number}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handlePrint}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              background: '#2b1b16',
              color: '#f5ead9',
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
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              background: '#f1f1f1',
              color: '#333333',
              border: '1px solid #ddd',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Clean 384px Kitchen Ticket image */}
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
