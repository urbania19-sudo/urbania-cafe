import React from 'react';

/**
 * PreviewDemoBanner
 *
 * Prominent sticky banner displayed across all admin and staff pages
 * when the application is running in Vercel Preview Demo Mode.
 */
export default function PreviewDemoBanner() {
  return (
    <>
      <style>{`
        @media print {
          .preview-demo-banner {
            display: none !important;
          }
        }
      `}</style>
      <aside
        role="status"
        aria-label="Preview Demo Mode"
        className="preview-demo-banner"
        style={{
          position: 'sticky',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          width: '100%',
          backgroundColor: '#78350f',
          color: '#fef3c7',
          borderBottom: '2px solid #f59e0b',
          padding: '10px 16px',
          textAlign: 'center',
          fontWeight: 600,
          fontSize: '13px',
          letterSpacing: '0.04em',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
        }}
      >
        <div
          style={{
            maxWidth: 1060,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: '#fbbf24',
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
          <span>PREVIEW DEMO — Sample data only. Changes are not saved.</span>
        </div>
      </aside>
    </>
  );
}
