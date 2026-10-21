// @vitest-environment jsdom
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ThermalBillModal from '../src/components/staff/ThermalBillModal';
import type { Bill } from '../src/lib/billing';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

const mockBill: Bill = {
  id: 'b-999',
  order_id: 'ord-888',
  bill_number: 'UB-01050',
  bill_seq: 1050,
  order_number: 15,
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
    phone: '9876543210',
    gst_status: 'unconfirmed',
    bill_footer_text: 'Thank you for visiting Urbania Café!',
  },
  items_snapshot: [
    {
      id: 'i-1',
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
  issued_at: '2026-10-20T12:00:00Z',
  issued_by: 'staff-1',
};

describe('ThermalBillModal Component (Mobile Fun Print Workflow)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders receipt preview with FSSAI licence and order details', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    expect(screen.getByText('#UB-01050')).toBeInTheDocument();
    expect(screen.getAllByText(/12226032000212/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/URBANIA CAFE AND JUICE BAR/i)).toBeInTheDocument();
    expect(screen.getByText('Cold Brew Tonic')).toBeInTheDocument();
    expect(screen.getAllByText('₹520.00').length).toBeGreaterThanOrEqual(1);
  });

  it('distinguishes not_registered from unconfirmed GST statuses', () => {
    const onClose = vi.fn();
    const notRegBill: Bill = {
      ...mockBill,
      business_snapshot: { ...mockBill.business_snapshot, gst_status: 'not_registered' },
    };
    const { rerender } = render(
      <ThermalBillModal bill={notRegBill} onClose={onClose} isReprint={false} />
    );
    expect(screen.getByText('GST: Not Registered (Not a Tax Invoice)')).toBeInTheDocument();

    const unconfBill: Bill = {
      ...mockBill,
      business_snapshot: { ...mockBill.business_snapshot, gst_status: 'unconfirmed' },
    };
    rerender(<ThermalBillModal bill={unconfBill} onClose={onClose} isReprint={false} />);
    expect(screen.getByText('GST: Pending Registration (Not a Tax Invoice)')).toBeInTheDocument();
  });

  it('renders duplicate indicator when isReprint=true', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={true} />);

    expect(screen.getByText(/DUPLICATE BILL/i)).toBeInTheDocument();
    expect(screen.getByText(/\*\*\* DUPLICATE \/ REPRINT \*\*\*/i)).toBeInTheDocument();
  });

  it('provides Print Bill with Fun Print as primary action and Download as fallback', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    expect(screen.getByRole('button', { name: /Print Bill with Fun Print/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Receipt Image/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy Image/i })).toBeInTheDocument();
  });

  it('provides a deliberate Open Fun Print link targeting com.fun.mxw', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    const link = screen.getByRole('link', { name: /Open Fun Print|Fun Print App/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('com.fun.mxw');
  });

  it('confirms POS Driver button and A4 toggle are completely absent', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    expect(screen.queryByText(/POS Driver/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/A4/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Windows Spooler/i)).not.toBeInTheDocument();
  });

  it('does not download an image when user cancels the share sheet', async () => {
    const abortErr = new DOMException('The share operation was canceled.', 'AbortError');
    Object.defineProperty(navigator, 'canShare', {
      writable: true,
      value: vi.fn().mockReturnValue(true),
    });
    Object.defineProperty(navigator, 'share', {
      writable: true,
      value: vi.fn().mockRejectedValue(abortErr),
    });

    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    const primaryBtn = screen.getByRole('button', { name: /Print Bill with Fun Print/i });
    await act(async () => {
      fireEvent.click(primaryBtn);
    });

    // Should remain in bill preview without triggering download message
    expect(screen.queryByText(/Receipt image downloaded/i)).not.toBeInTheDocument();
  });

  it('renders the 384px receipt image element ready for native tap-and-hold saving', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    const receiptImg = screen.getByRole('img', { name: /Receipt Bill #UB-01050/i });
    expect(receiptImg).toBeInTheDocument();
    expect(receiptImg.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('renders the View Full PNG action button for direct browser preview', () => {
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    expect(screen.getByRole('button', { name: /View Full PNG/i })).toBeInTheDocument();
  });

  it('displays iPhone guidance card when on iOS user agent', () => {
    const origUA = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
      configurable: true,
    });

    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    expect(screen.getByText(/iPhone \(Chrome for iOS\) Print Guide/i)).toBeInTheDocument();
    expect(screen.getByText(/Save to Photos/i)).toBeInTheDocument();

    Object.defineProperty(navigator, 'userAgent', {
      value: origUA,
      configurable: true,
    });
  });

  it('navigates in same tab without window.open or target="_blank" when clicking View Full PNG or image', () => {
    const windowOpenSpy = vi.spyOn(window, 'open');
    const onClose = vi.fn();
    render(<ThermalBillModal bill={mockBill} onClose={onClose} isReprint={false} />);

    // View Full PNG button
    const viewBtn = screen.getByRole('button', { name: /View Full PNG/i });
    fireEvent.click(viewBtn);
    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/staff/bills/b-999/print');

    // Image preview click
    mockPush.mockClear();
    const receiptImg = screen.getByRole('img', { name: /Receipt Bill #UB-01050/i });
    fireEvent.click(receiptImg);
    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/staff/bills/b-999/print');

    // Fun Print link must NOT use target="_blank"
    const link = screen.getByRole('link', { name: /Open Fun Print|Fun Print App/i });
    expect(link.getAttribute('target')).toBeNull();

    windowOpenSpy.mockRestore();
  });
});
