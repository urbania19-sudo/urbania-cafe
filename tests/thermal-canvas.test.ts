// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  renderReceiptToCanvas,
  renderKitchenTicketToCanvas,
  exportKitchenTicketDataUrl,
  getFunPrintLaunchInfo,
  isAbortError,
  shareOrDownloadReceipt,
  exportReceiptDataUrl,
  getSharingCapabilities,
  FUN_PRINT_PACKAGE_ID,
  FUN_PRINT_ANDROID_INTENT,
  type KitchenTicketOrder,
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

  it('conditionally renders GST info ONLY when registered with GSTIN and suppresses GST text for unconfirmed or unregistered', () => {
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

    // 1. Not registered: must NOT render any GST message or reserve space
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      business_snapshot: { ...mockBill.business_snapshot, gst_status: 'not_registered' },
    });
    expect(filledTexts.some((t) => t.includes('GST'))).toBe(false);

    // 2. Unconfirmed / Pending Registration: must NOT render any GST message or reserve space
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      business_snapshot: { ...mockBill.business_snapshot, gst_status: 'unconfirmed' },
    });
    expect(filledTexts.some((t) => t.includes('GST'))).toBe(false);

    // 3. Registered with GSTIN: renders exact GSTIN line
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

  it('renders receipt with single FSSAI in top header and removes duplicate in footer', () => {
    const calls: { text: string; font: string; textAlign: string }[] = [];
    const origGetContext = HTMLCanvasElement.prototype.getContext;

    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
      const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
      let currentFont = '';
      let currentAlign = 'left';
      return {
        ...ctx,
        set font(f: string) {
          currentFont = f;
        },
        get font() {
          return currentFont;
        },
        set textAlign(a: string) {
          currentAlign = a;
        },
        get textAlign() {
          return currentAlign;
        },
        fillText: (text: string) => {
          calls.push({ text, font: currentFont, textAlign: currentAlign });
        },
      };
    };

    renderReceiptToCanvas(mockBill, { scale: 1 });
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

    // Single FSSAI line in top header
    const fssaiCalls = calls.filter((c) => c.text.toLowerCase().includes('fssai'));
    expect(fssaiCalls.length).toBe(1);
    expect(fssaiCalls[0]?.text).toBe('FSSAI Lic No: 12226032000212');
    expect(fssaiCalls[0]?.font).toContain('14px');

    // Duplicate footer FSSAI is NOT present
    expect(calls.some((c) => c.text.includes('FSSAI LICENCE NO.'))).toBe(false);
  });

  it('renders receipt with substantially enlarged typography (20-30%) and multi-line item layout', () => {
    interface TextCall {
      text: string;
      x: number;
      y: number;
      font: string;
      textAlign: string;
    }
    const calls: TextCall[] = [];
    const origGetContext = HTMLCanvasElement.prototype.getContext;

    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
      const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
      let currentFont = '';
      let currentAlign = 'left';
      return {
        ...ctx,
        set font(f: string) {
          currentFont = f;
        },
        get font() {
          return currentFont;
        },
        set textAlign(a: string) {
          currentAlign = a;
        },
        get textAlign() {
          return currentAlign;
        },
        fillText: (text: string, x: number, y: number) => {
          calls.push({ text, x, y, font: currentFont, textAlign: currentAlign });
        },
      };
    };

    const canvas = renderReceiptToCanvas(mockBill, { scale: 1 });
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

    // 1. Verify Cafe name uses 22px bold font
    const legalNameCall = calls.find((c) => c.text.includes('URBANIA CAFE AND JUICE BAR'));
    expect(legalNameCall).toBeDefined();
    expect(legalNameCall?.font).toContain('22px');
    expect(legalNameCall?.textAlign).toBe('center');

    // 2. Verify Document title uses prominent 21px bold font
    const docTitleCall = calls.find((c) => c.text === 'BILL / CASH RECEIPT');
    expect(docTitleCall).toBeDefined();
    expect(docTitleCall?.font).toContain('21px');

    // 3. Verify Metadata rows use 15px mono
    const billNoCall = calls.find((c) => c.text.includes('Bill No:'));
    expect(billNoCall).toBeDefined();
    expect(billNoCall?.font).toContain('15px');
    expect(billNoCall?.x).toBe(14);

    // 4. Verify Column headers alignment (15px bold mono)
    const itemHeader = calls.find((c) => c.text === 'ITEM');
    const qtyHeader = calls.find((c) => c.text === 'QTY');
    const rateHeader = calls.find((c) => c.text === 'RATE');
    const amtHeader = calls.find((c) => c.text === 'AMOUNT');

    expect(itemHeader).toBeDefined();
    expect(itemHeader?.x).toBe(14);
    expect(itemHeader?.font).toContain('15px');

    expect(qtyHeader).toBeDefined();
    expect(qtyHeader?.x).toBe(150);
    expect(qtyHeader?.textAlign).toBe('center');

    expect(rateHeader).toBeDefined();
    expect(rateHeader?.x).toBe(260);
    expect(rateHeader?.textAlign).toBe('right');

    expect(amtHeader).toBeDefined();
    expect(amtHeader?.x).toBe(370);
    expect(amtHeader?.textAlign).toBe('right');

    // 5. Verify Multi-line item layout: dish name is 18px bold mono, pricing row is 16px mono
    const latteCall = calls.find((c) => c.text.includes('Iced Spanish Latte'));
    expect(latteCall).toBeDefined();
    expect(latteCall?.font).toContain('18px');
    expect(latteCall?.x).toBe(14);

    const rateCall = calls.find((c) => c.text === '240.00' && c.x === 260);
    expect(rateCall).toBeDefined();
    expect(rateCall?.font).toContain('16px');

    // 6. Verify Subtotal (17px) and prominent 22px bold TOTAL AMOUNT
    const subtotalCall = calls.find((c) => c.text === 'Subtotal:');
    expect(subtotalCall).toBeDefined();
    expect(subtotalCall?.font).toContain('17px');

    const totalCall = calls.find((c) => c.text === 'TOTAL AMOUNT:');
    expect(totalCall).toBeDefined();
    expect(totalCall?.font).toContain('22px');
    expect(totalCall?.x).toBe(14);

    // 7. Verify single top header FSSAI licence
    const fssaiCall = calls.find((c) => c.text.includes('FSSAI Lic No:'));
    expect(fssaiCall).toBeDefined();

    // 8. Verify canvas height accommodates all text plus bottom margin
    const maxTextY = Math.max(...calls.map((c) => c.y));
    expect(canvas.height).toBeGreaterThanOrEqual(maxTextY);
  });

  it('correctly suppresses GST row for unconfirmed status and formats inclusive GST when registered', () => {
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

    // Case 1: Unconfirmed GST status must NEVER print GST row even if tax_paise > 0
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      tax_rate: 0.05,
      tax_paise: 2800,
      business_snapshot: {
        ...mockBill.business_snapshot,
        gst_status: 'unconfirmed',
      },
    });
    expect(filledTexts.some((t) => t.includes('GST (5%):') || t.includes('Incl. GST'))).toBe(false);
    expect(filledTexts).toContain('Subtotal:');
    expect(filledTexts).toContain('TOTAL AMOUNT:');

    // Case 2: Registered GST status with inclusive tax prints "Incl. GST (5%):"
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      tax_rate: 0.05,
      tax_paise: 2800,
      business_snapshot: {
        ...mockBill.business_snapshot,
        gst_status: 'registered',
        gstin: '08AAAAA0000A1Z5',
        tax_treatment: 'inclusive',
      },
    });
    expect(filledTexts.some((t) => t.includes('Incl. GST (5%):'))).toBe(true);

    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;
  });

  it('suppresses placeholder taglines like "Your Café" and renders genuine taglines only', () => {
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

    // 1. With placeholder "Your Café"
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      business_snapshot: {
        ...mockBill.business_snapshot,
        cafe_name: 'Your Café',
      },
    });
    expect(filledTexts.some((t) => t.toLowerCase().includes('your café') || t.toLowerCase().includes('your cafe'))).toBe(false);

    // 2. With redundant "Urbania Café" (when legal name is URBANIA CAFE AND JUICE BAR)
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      business_snapshot: {
        ...mockBill.business_snapshot,
        cafe_name: 'Urbania Café',
      },
    });
    expect(filledTexts.some((t) => t === '(Urbania Café)')).toBe(false);

    // 3. With meaningful distinct tagline
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      business_snapshot: {
        ...mockBill.business_snapshot,
        cafe_name: 'Artisan Roastery & Bakehouse',
      },
    });
    expect(filledTexts).toContain('(Artisan Roastery & Bakehouse)');

    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;
  });

  it('renders discount row and BILL TOTAL ONLY when discount is active, otherwise keeps pristine layout', () => {
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

    // Case 1: No discount applied -> NO discount row, NO "BILL TOTAL", uses "Subtotal:" and "TOTAL AMOUNT:"
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      discount_type: null,
      discount_value: null,
      discount_paise: 0,
    });
    expect(filledTexts.some((t) => t.toLowerCase().includes('discount'))).toBe(false);
    expect(filledTexts).toContain('Subtotal:');
    expect(filledTexts).toContain('TOTAL AMOUNT:');
    expect(filledTexts.some((t) => t === 'AMOUNT TO PAY:')).toBe(false);

    // Case 2: Fixed discount applied -> renders BILL TOTAL, Discount row, and AMOUNT TO PAY
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      subtotal_before_discount_paise: 56000,
      discount_type: 'fixed',
      discount_value: 50,
      discount_paise: 5000,
      total_paise: 51000,
    });
    expect(filledTexts).toContain('BILL TOTAL:');
    expect(filledTexts).toContain('Discount (₹50):');
    expect(filledTexts).toContain('-₹50.00');
    expect(filledTexts).toContain('AMOUNT TO PAY:');
    expect(filledTexts).toContain('₹510.00');

    // Case 3: Percentage discount applied -> renders percentage in discount label
    filledTexts.length = 0;
    renderReceiptToCanvas({
      ...mockBill,
      subtotal_before_discount_paise: 56000,
      discount_type: 'percentage',
      discount_value: 10,
      discount_paise: 5600,
      total_paise: 50400,
    });
    expect(filledTexts).toContain('BILL TOTAL:');
    expect(filledTexts).toContain('Discount (10%):');
    expect(filledTexts).toContain('-₹56.00');
    expect(filledTexts).toContain('AMOUNT TO PAY:');
    expect(filledTexts).toContain('₹504.00');

    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;
  });

  it('renders Kitchen Order Ticket (KOT) with items, notes, order number and NO financial info', () => {
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

    const mockKitchenOrder: KitchenTicketOrder = {
      id: 'ord-kot-1',
      order_number: 108,
      status: 'ACCEPTED',
      created_at: '2026-10-25T12:00:00Z',
      customer_name: 'Namit',
      guest_count: 3,
      customer_note: 'No spicy sauce',
      service_mode: 'dine_in',
      table_label: 'Table 4',
      order_items: [
        {
          item_name_snapshot: 'Paneer Tikka Sandwich',
          quantity: 2,
          item_note: 'Extra crispy',
          selected_options: [{ name: 'Extra Cheese' }],
          is_custom: false,
        },
        {
          item_name_snapshot: 'Ginger Chai with mint',
          quantity: 1,
          item_note: 'Very hot',
          is_custom: true,
        },
      ],
    };

    const canvas = renderKitchenTicketToCanvas(mockKitchenOrder, { scale: 1 });
    expect(canvas.width).toBe(384);
    expect(canvas.height).toBeGreaterThan(150);

    // Order number and token
    expect(filledTexts).toContain('URBANIA CAFE — KITCHEN TOKEN');
    expect(filledTexts).toContain('ORDER #108');
    expect(filledTexts).toContain('TABLE 4');
    expect(filledTexts.some((t) => t.includes('Namit'))).toBe(true);
    expect(filledTexts.some((t) => t.includes('No spicy sauce'))).toBe(true);

    // Section header
    expect(filledTexts).toContain('ITEMS TO PREPARE');

    // Items
    expect(filledTexts).toContain('2× Paneer Tikka Sandwich');
    expect(filledTexts.some((t) => t.includes('Extra Cheese'))).toBe(true);
    expect(filledTexts.some((t) => t.includes('Extra crispy'))).toBe(true);

    // Custom dish
    expect(filledTexts).toContain('1× [CUSTOM] Ginger Chai with mint');
    expect(filledTexts.some((t) => t.includes('Very hot'))).toBe(true);

    // Kitchen copy footer
    expect(filledTexts).toContain('*** KITCHEN COPY — NOT A BILL ***');

    // EXCLUDE all financial information
    expect(filledTexts.some((t) => t.includes('₹'))).toBe(false);
    expect(filledTexts.some((t) => t.toLowerCase().includes('subtotal'))).toBe(false);
    expect(filledTexts.some((t) => t.toLowerCase().includes('total amount'))).toBe(false);
    expect(filledTexts.some((t) => t.toLowerCase().includes('gst'))).toBe(false);
    expect(filledTexts.some((t) => t.toLowerCase().includes('fssai'))).toBe(false);

    const dataUrl = exportKitchenTicketDataUrl(mockKitchenOrder, { scale: 1 });
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);

    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;
  });

  it('wraps long dish names across multiple lines with full printable width', () => {
    interface TextCall {
      text: string;
      x: number;
      y: number;
    }
    const calls: TextCall[] = [];
    const origGetContext = HTMLCanvasElement.prototype.getContext;

    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
      const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
      return {
        ...ctx,
        measureText: (text: string) => ({ width: text.length * 10 }),
        fillText: (text: string, x: number, y: number) => {
          calls.push({ text, x, y });
        },
      };
    };

    const longBill: Bill = {
      ...mockBill,
      items_snapshot: [
        {
          id: 'long-item-1',
          name: 'Artisanal Multigrain Sourdough with Wild Truffle Mushroom and Poached Organic Egg',
          unit_price_paise: 45000,
          quantity: 2,
          line_total_paise: 90000,
          selected_options: [
            { name: 'Extra Truffle Oil', price_delta_paise: 5000 },
            { name: 'Gluten-Free', price_delta_paise: 3000 },
          ],
          note: 'Crispy edges please',
        },
      ],
      subtotal_paise: 90000,
      total_paise: 90000,
    };

    renderReceiptToCanvas(longBill, { scale: 1 });
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

    // Check that multiple lines were produced for the dish name
    const itemCalls = calls.filter(
      (c) =>
        c.text.includes('Artisanal') ||
        c.text.includes('Multigrain') ||
        c.text.includes('Sourdough') ||
        c.text.includes('Truffle') ||
        c.text.includes('Organic')
    );
    expect(itemCalls.length).toBeGreaterThan(1);

    // First line starts at leftX = 14
    expect(itemCalls[0]?.x).toBe(14);

    // Wrapped lines must be indented at leftX + 8 = 22
    const wrappedLine = itemCalls.find((c) => c.x === 22);
    expect(wrappedLine).toBeDefined();

    // Modifiers and notes must be rendered indented beneath the item
    const optionCall = calls.find((c) => c.text.includes('Extra Truffle Oil'));
    expect(optionCall).toBeDefined();
    expect(optionCall?.x).toBe(22);

    const noteCall = calls.find((c) => c.text.includes('Crispy edges please'));
    expect(noteCall).toBeDefined();
    expect(noteCall?.x).toBe(22);

    // Quantity (2) is centered at 150 on the pricing row
    const qtyCall = calls.find((c) => c.text === '2');
    expect(qtyCall).toBeDefined();
    expect(qtyCall?.x).toBe(150);
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

  it('generates a valid PNG data URL starting with data:image/png;base64,', () => {
    const dataUrl = exportReceiptDataUrl(mockBill, { scale: 1 });
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('detects iOS platform and insecure context in getSharingCapabilities', () => {
    const origUA = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', {
      value: false,
      configurable: true,
    });

    const cap = getSharingCapabilities();
    expect(cap.isIOS).toBe(true);
    expect(cap.isSecureContext).toBe(false);

    Object.defineProperty(navigator, 'userAgent', {
      value: origUA,
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    });
  });

  it('falls back to download when navigator.share rejects with a network or unexpected error', async () => {
    const networkErr = new Error('Failed to share file');
    const shareMock = vi.fn().mockRejectedValue(networkErr);
    Object.defineProperty(navigator, 'canShare', {
      writable: true,
      value: vi.fn().mockReturnValue(true),
    });
    Object.defineProperty(navigator, 'share', {
      writable: true,
      value: shareMock,
    });

    const result = await shareOrDownloadReceipt(mockBill, { scale: 1 });
    expect(result.action).toBe('downloaded');
    expect(shareMock).toHaveBeenCalledTimes(1);
  });

  it('downloads receipt image without target="_blank" to prevent Android OS app chooser dialog', async () => {
    let createdAnchor: HTMLAnchorElement | null = null;
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        createdAnchor = el as HTMLAnchorElement;
      }
      return el;
    });

    const { downloadReceiptImage } = await import('../src/lib/thermal-canvas');
    await downloadReceiptImage(mockBill, { scale: 1 });

    expect(createdAnchor as HTMLAnchorElement | null).not.toBeNull();
    expect((createdAnchor as unknown as HTMLAnchorElement)?.getAttribute('download')).toBe('Bill-UB-01001-384px.png');
    expect((createdAnchor as unknown as HTMLAnchorElement)?.getAttribute('target')).toBeNull();
  });
});
