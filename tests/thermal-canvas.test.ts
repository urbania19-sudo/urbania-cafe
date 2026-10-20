// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  renderReceiptToCanvas,
  getFunPrintLaunchInfo,
  isAbortError,
  shareOrDownloadReceipt,
  FUN_PRINT_PACKAGE_ID,
  FUN_PRINT_ANDROID_INTENT,
} from '../src/lib/thermal-canvas';
import type { Bill } from '../src/lib/billing';

const mockBill: Bill = {
  id: 'bill-123',
  order_id: 'order-456',
  bill_number: 'UB-01001',
  bill_seq: 1001,
  order_number: 101,
  table_number: 3,
  table_label: 'Table 3',
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
      name: 'Iced Spanish Latte',
      unit_price_paise: 24000,
      quantity: 1,
      line_total_paise: 24000,
    },
    {
      id: 'i-2',
      name: 'Avocado Sourdough Toast',
      unit_price_paise: 32000,
      quantity: 1,
      line_total_paise: 32000,
    },
  ],
  subtotal_paise: 56000,
  tax_rate: 0,
  tax_paise: 0,
  total_paise: 56000,
  notes: null,
  issued_at: '2026-10-20T11:00:00Z',
  issued_by: 'staff-1',
};

describe('Thermal Canvas Receipt Generator (384px for Fun Print / MX11)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders canvas with exact 384px width for 1:1 hardware dot pitch', () => {
    const canvas = renderReceiptToCanvas(mockBill, { scale: 1 });
    expect(canvas.width).toBe(384);
    expect(canvas.height).toBeGreaterThan(200);
  });

  it('renders canvas with 768px width when scale=2 (high-res preview)', () => {
    const canvas = renderReceiptToCanvas(mockBill, { scale: 2 });
    expect(canvas.width).toBe(768);
    expect(canvas.height).toBeGreaterThan(400);
  });

  it('renders distinct GST text for not_registered, unconfirmed, and registered', () => {
    const filledTexts: string[] = [];
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
      const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
      return {
        ...ctx,
        fillText: (text: string) => {
          filledTexts.push(text);
        },
      };
    };

    // 1. Not registered
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      business_snapshot: { ...mockBill.business_snapshot, gst_status: 'not_registered' },
    });
    expect(filledTexts).toContain('GST: Not Registered (Not a Tax Invoice)');

    // 2. Unconfirmed / Pending Registration
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      business_snapshot: { ...mockBill.business_snapshot, gst_status: 'unconfirmed' },
    });
    expect(filledTexts).toContain('GST: Pending Registration (Not a Tax Invoice)');

    // 3. Registered with GSTIN
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      business_snapshot: {
        ...mockBill.business_snapshot,
        gst_status: 'registered',
        gstin: '08AAAAA0000A1Z5',
      },
    });
    expect(filledTexts).toContain('GSTIN: 08AAAAA0000A1Z5');

    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;
  });

  it('returns valid intent URL targeting com.fun.mxw package on Android', () => {
    const origUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile',
      configurable: true,
    });

    const info = getFunPrintLaunchInfo();
    expect(info.isAndroid).toBe(true);
    expect(info.url).toBe(FUN_PRINT_ANDROID_INTENT);
    expect(info.url).toContain(FUN_PRINT_PACKAGE_ID);
    expect(info.label).toContain('Android');

    Object.defineProperty(navigator, 'userAgent', {
      value: origUserAgent,
      configurable: true,
    });
  });

  it('detects AbortError as user cancellation', () => {
    const domAbort = new DOMException('The operation was aborted.', 'AbortError');
    expect(isAbortError(domAbort)).toBe(true);

    const genericCancel = new Error('User cancelled the share dialog');
    expect(isAbortError(genericCancel)).toBe(true);

    const networkErr = new Error('Failed to fetch');
    expect(isAbortError(networkErr)).toBe(false);
  });

  it('invokes Web Share API when supported with image file', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'canShare', {
      writable: true,
      value: vi.fn().mockReturnValue(true),
    });
    Object.defineProperty(navigator, 'share', {
      writable: true,
      value: shareMock,
    });

    const result = await shareOrDownloadReceipt(mockBill, { scale: 1 });
    expect(result.action).toBe('shared');
    expect(shareMock).toHaveBeenCalledTimes(1);
  });

  it('treats AbortError as user cancellation and does NOT trigger fallback download', async () => {
    const abortErr = new DOMException('The share operation was canceled.', 'AbortError');
    const shareMock = vi.fn().mockRejectedValue(abortErr);
    Object.defineProperty(navigator, 'canShare', {
      writable: true,
      value: vi.fn().mockReturnValue(true),
    });
    Object.defineProperty(navigator, 'share', {
      writable: true,
      value: shareMock,
    });

    const result = await shareOrDownloadReceipt(mockBill, { scale: 1 });
    expect(result.action).toBe('cancelled');
    expect(shareMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to downloading image when Web Share API is not supported', async () => {
    Object.defineProperty(navigator, 'canShare', {
      writable: true,
      value: vi.fn().mockReturnValue(false),
    });

    const result = await shareOrDownloadReceipt(mockBill, { scale: 1 });
    expect(result.action).toBe('downloaded');
  });
});
