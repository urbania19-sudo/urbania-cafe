// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ThermalBillModal from '../src/components/staff/ThermalBillModal';
import type { Bill } from '../src/lib/billing';

const mockBill: Bill = {
  id: 'bill-123',
  order_id: 'order-456',
  bill_number: 'UB-01050',
  bill_seq: 1050,
  order_number: 105,
  table_number: 4,
  table_label: 'Table 4',
  status: 'issued',
  document_type: 'bill',
  business_snapshot: {
    cafe_name: 'Urbania Café',
    legal_name: 'URBANIA CAFE AND JUICE BAR',
    fssai_number: '12226032000212',
    address_line1: '17/456, Chopasni Housing Board',
    city: 'Jodhpur',
    state: 'Rajasthan',
    pincode: '342008',
    phone: null,
    gst_status: 'unconfirmed',
    bill_footer_text: 'Thank you for visiting Urbania Café!',
  },
  items_snapshot: [
    {
      id: 'item-1',
      name: 'Cold Brew Tonic',
      unit_price_paise: 26000,
      quantity: 2,
      line_total_paise: 52000,
    },
  ],
  subtotal_paise: 52000,
  tax_rate: 0,
  tax_paise: 0,
  total_paise: 52000,
  notes: null,
  issued_at: '2026-10-20T10:00:00Z',
  issued_by: 'staff-1',
};

describe('ThermalBillModal Clean Receipt Viewer (View Image Action)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders clean 384px thermal receipt image on pure white background', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    const receiptImg = screen.getByRole('img', { name: /Receipt Bill #UB-01050/i });
    expect(receiptImg).toBeInTheDocument();
    expect(receiptImg.getAttribute('width')).toBe('384');
    expect(receiptImg.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('excludes duplicate buttons, toolbars, and extraneous printing UI', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    // Zero duplicate printing buttons
    expect(screen.queryByRole('button', { name: /Print with Fun Print|Print Bill/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download Receipt Image|Save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View Full PNG/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy Image/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open Fun Print/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/POS Driver/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/A4/i)).not.toBeInTheDocument();

    // Must have NO on-screen buttons so Fun Print capture contains purely the receipt
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('closes the view when user taps anywhere on the receipt or screen', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    const dialog = screen.getByRole('dialog', { name: /Receipt Bill #UB-01050/i });
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('records audit reprint event when isReprint is true', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={true} />);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/staff/bills/bill-123/reprint',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    );
  });

  it('suppresses Vercel preview toolbar via CSS rules in the print modal', () => {
    const onClose = vi.fn();
    const { container } = render(<ThermalBillModal bill={mockBill} onClose={onClose} />);

    const styleEl = container.querySelector('style');
    expect(styleEl?.innerHTML).toContain('vercel-live-feedback');
    expect(styleEl?.innerHTML).toContain('58mm auto');
  });
});
