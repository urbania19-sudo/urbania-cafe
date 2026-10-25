'use client';

import { useState, useEffect } from 'react';
import {
  renderKitchenTicketToCanvas,
  type KitchenTicketOrder,
} from '@/lib/thermal-canvas';

export default function KitchenTokenPrintView({
  order,
  isReprint = false,
}: {
  order: KitchenTicketOrder;
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

  return (
    <div
      style={{
        background: '#ffffff',
        width: '100%',
        maxWidth: 384,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 0,
        height: 'auto',
        minHeight: 0,
      }}
    >
      {/* 58mm Thermal Printer CSS: 0mm margins, pure white, content-height trimmed, suppress UI and portal overlays */}
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
              height: auto !important;
              min-height: 0 !important;
            }
            @media print {
              html, body {
                height: auto !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: visible !important;
              }
              .no-print {
                display: none !important;
              }
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
            /* Exclude Vercel Preview Toolbar, Next.js Dev tools, and overlay widgets from print and view */
            nextjs-portal,
            [data-nextjs-dev-tools-button],
            #next-logo,
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

      {/* Clean Kitchen Token Container: ONLY the genuine 384px PNG token on pure white */}
      <main
        onClick={() => window.history.back()}
        title="Tap to return"
        style={{
          width: '100%',
          maxWidth: 384,
          margin: '0 auto',
          background: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 0,
          height: 'auto',
          minHeight: 0,
          cursor: 'pointer',
        }}
      >
        {ticketMeta && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={ticketMeta.dataUrl}
            width={ticketMeta.width}
            height={ticketMeta.height}
            alt={`Kitchen Token #${order.order_number}`}
            style={{
              width: '100%',
              maxWidth: 384,
              height: 'auto',
              display: 'block',
              margin: '0 auto',
              background: '#ffffff',
              imageRendering: '-webkit-optimize-contrast',
            }}
          />
        )}
      </main>
    </div>
  );
}
