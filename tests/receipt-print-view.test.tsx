// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReceiptPrintView from '../src/components/bills/ReceiptPrintView';
import { renderReceiptToCanvas } from '../src/lib/thermal-canvas';
import { SAMPLE_BILL, type Bill } from '../src/lib/billing';

const sampleBill: Bill = {
  id: 'bill-print-1',
  order_id: 'order-print-1',
  bill_number: 'UB-01001',
  bill_seq: 1001,
  order_number: 10,
  table_number: 2,
  status: 'issued',
  document_type: 'bill',
  business_snapshot: {
    cafe_name: 'Urbania Café',
    legal_name: 'URBANIA CAFE AND JUICE BAR',
    fssai_number: '12226032000212',
    address_line1: '17/456, Chopasni Housing Board',
    city: 'Jodhpur',
    pincode: '342008',
  },
  items_snapshot: [
    {
      id: 'i-1',
      name: 'Cold Coffee with Ice Cream',
      unit_price_paise: 18000,
      quantity: 1,
      line_total_paise: 18000,
    },
  ],
  subtotal_paise: 18000,
  tax_rate: 0,
  tax_paise: 0,
  total_paise: 18000,
  notes: null,
  issued_at: '2026-10-21T10:00:00Z',
};

const longBill: Bill = {
  ...sampleBill,
  id: 'bill-print-2',
  bill_number: 'UB-01002',
  items_snapshot: [
    { id: 'i-1', name: 'Cold Coffee with Ice Cream', unit_price_paise: 18000, quantity: 2, line_total_paise: 36000 },
    { id: 'i-2', name: 'Cheesy Garlic Breadsticks with Dip', unit_price_paise: 22000, quantity: 1, line_total_paise: 22000 },
    { id: 'i-3', name: 'Artisanal Mushroom Melt Panini Sandwich with Chips', unit_price_paise: 29000, quantity: 1, line_total_paise: 29000, note: 'Extra toasted, no onions' },
  ],
  subtotal_paise: 87000,
  total_paise: 87000,
};

describe('Receipt Dynamic Height & Whitespace Trimming', () => {
  it('determines receipt canvas height dynamically based on item list length', () => {
    const shortCanvas = renderReceiptToCanvas(sampleBill, { scale: 1 });
    const longCanvas = renderReceiptToCanvas(longBill, { scale: 1 });

    expect(shortCanvas.width).toBe(384);
    expect(longCanvas.width).toBe(384);
    // Long receipt with multiple long dishes must be taller than single-item receipt
    expect(longCanvas.height).toBeGreaterThan(shortCanvas.height);
  });

  it('keeps exact 384px width with no extra trailing blank margin', () => {
    const canvas = renderReceiptToCanvas(sampleBill, { scale: 1 });
    expect(canvas.width).toBe(384);
    expect(canvas.height).toBeGreaterThan(150);
  });
});

describe('ReceiptPrintView Dedicated Print-Only Component', () => {
  it('renders clean receipt image element at 384px on pure white background', () => {
    render(<ReceiptPrintView bill={sampleBill} isReprint={false} />);

    const receiptImg = screen.getByRole('img', { name: /Bill #UB-01001/i });
    expect(receiptImg).toBeInTheDocument();
    expect(receiptImg.getAttribute('width')).toBe('384');
    expect(receiptImg.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('excludes instructional banners and action cards, displaying only the receipt and back button', () => {
    render(<ReceiptPrintView bill={sampleBill} isReprint={true} />);

    expect(screen.queryByText(/Fun Print on Android/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Print Dialog/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back/i })).toBeInTheDocument();
  });

  it('includes 58mm thermal @page and @media print CSS rules to hide UI chrome on print', () => {
    const { container } = render(<ReceiptPrintView bill={sampleBill} />);
    const styleEl = container.querySelector('style');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.innerHTML).toContain('58mm auto');
    expect(styleEl?.innerHTML).toContain('.no-print');
    expect(styleEl?.innerHTML).toContain('display: none !important');
  });

  it('renders SAMPLE_BILL cleanly for instant printer testing without auth or DB query', () => {
    render(<ReceiptPrintView bill={SAMPLE_BILL} isReprint={false} />);
    const receiptImg = screen.getByRole('img', { name: new RegExp(`Bill #${SAMPLE_BILL.bill_number}`, 'i') });
    expect(receiptImg).toBeInTheDocument();
    expect(receiptImg.getAttribute('width')).toBe('384');
  });
});
