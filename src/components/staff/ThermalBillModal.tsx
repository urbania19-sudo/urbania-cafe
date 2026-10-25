'use client';

import { useState, useEffect } from 'react';
import type { Bill } from '@/lib/billing';
import { renderReceiptToCanvas } from '@/lib/thermal-canvas';

export default function ThermalBillModal({
  bill,
  onClose,
  isReprint = false,
}: {
  bill: Bill;
  onClose: () => void;
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

  useEffect(() => {
    if (isReprint && bill.id && bill.id !== 'sample' && bill.id !== '00000000-0000-0000-0000-000000000000') {
      fetch(`/api/staff/bills/${bill.id}/reprint`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'view_image', source: 'view_image_action' }),
      }).catch(() => {});
    }
  }, [isReprint, bill.id]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    document.body.classList.add('thermal-bill-modal-active');
    return () => {
      document.body.classList.remove('thermal-bill-modal-active');
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Receipt Bill #${bill.bill_number}`}
      onClick={onClose}
      title="Tap anywhere to return"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 384,
        margin: '0 auto',
        background: '#ffffff',
        color: '#000000',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 0,
        height: 'auto',
        minHeight: 0,
        cursor: 'pointer',
      }}
    >
      {/* 58mm Thermal Printer CSS: 0mm margins, pure white, print isolation matching KitchenTicketModal, suppress Vercel toolbar */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page {
              size: 58mm auto;
              margin: 0mm;
            }
            body.thermal-bill-modal-active {
              background: #ffffff !important;
              color: #000000 !important;
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              height: auto !important;
              min-height: 0 !important;
            }
            /* Hide background OrderBoard cards and dashboard shell so FunPrint webview height strictly matches the receipt */
            body.thermal-bill-modal-active .shell > *:not([role="dialog"]) {
              display: none !important;
            }
            body.thermal-bill-modal-active .shell {
              padding: 0 !important;
              margin: 0 auto !important;
              max-width: 384px !important;
              height: auto !important;
              min-height: 0 !important;
              background: #ffffff !important;
            }
            [role="dialog"] {
              position: static !important;
              width: 100% !important;
              max-width: 384px !important;
              margin: 0 auto !important;
              padding: 0 !important;
              height: auto !important;
              min-height: 0 !important;
              background: #ffffff !important;
            }
            @media print {
              html, body {
                background: #ffffff !important;
                color: #000000 !important;
                margin: 0 !important;
                padding: 0 !important;
                width: 100% !important;
                height: auto !important;
                min-height: 0 !important;
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
              #bill-receipt-printable-root,
              #bill-receipt-printable-root * {
                visibility: visible !important;
              }
              #bill-receipt-printable-root {
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

      {/* Clean Receipt Container: ONLY the genuine 384px PNG receipt on pure white */}
      <main
        id="bill-receipt-printable-root"
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
              imageRendering: '-webkit-optimize-contrast',
            }}
          />
        )}
      </main>
    </div>
  );
}
