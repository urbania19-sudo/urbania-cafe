'use client';

import { useState, useEffect } from 'react';
import type { Bill } from '@/lib/billing';
import { renderReceiptToCanvas } from '@/lib/thermal-canvas';

export default function ReceiptPrintView({
  bill,
  isReprint = false,
}: {
  bill: Bill;
  isReprint?: boolean;
}) {
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
      {/* 58mm Thermal Printer CSS: 0mm margins, pure white, hide any .no-print elements, suppress Vercel toolbar */}
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
          cursor: 'pointer',
        }}
      >
        {receiptMeta && (
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
        )}
      </main>
    </div>
  );
}
