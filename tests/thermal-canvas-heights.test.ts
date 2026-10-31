// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  renderReceiptToCanvas,
  renderKitchenTicketToCanvas,
  type KitchenTicketOrder,
} from '../src/lib/thermal-canvas';
import type { Bill } from '../src/lib/billing';

const baseBusinessSnapshot = {
  cafe_name: 'Urbania Café',
  legal_name: 'URBANIA CAFE AND JUICE BAR',
  fssai_number: '12226032000212',
  address_line1: '17/456, Chopasni Housing Board',
  city: 'Jodhpur',
  state: 'Rajasthan',
  pincode: '342008',
  phone: '9876543210',
  gst_status: 'unconfirmed' as const,
  bill_footer_text: 'Thank you for visiting Urbania Café!',
};

const shortBill: Bill = {
  id: 'bill-short-1',
  order_id: 'order-short-1',
  bill_number: 'UB-01001',
  bill_seq: 1001,
  order_number: 101,
  table_number: 2,
  table_label: 'Table 2',
  status: 'issued',
  document_type: 'bill',
  business_snapshot: baseBusinessSnapshot,
  items_snapshot: [
    {
      id: 'i-1',
      name: 'Espresso',
      unit_price_paise: 12000,
      quantity: 1,
      line_total_paise: 12000,
    },
  ],
  subtotal_paise: 12000,
  tax_rate: 0,
  tax_paise: 0,
  total_paise: 12000,
  notes: null,
  issued_at: '2026-10-25T11:00:00Z',
  issued_by: 'staff-1',
};

const multiItemBill: Bill = {
  id: 'bill-multi-1',
  order_id: 'order-multi-1',
  bill_number: 'UB-01002',
  bill_seq: 1002,
  order_number: 102,
  table_number: 5,
  table_label: 'Table 5',
  status: 'issued',
  document_type: 'bill',
  business_snapshot: baseBusinessSnapshot,
  items_snapshot: [
    {
      id: 'i-1',
      name: 'Iced Spanish Latte',
      unit_price_paise: 24000,
      quantity: 2,
      line_total_paise: 48000,
    },
    {
      id: 'i-2',
      name: 'Avocado Sourdough Toast',
      unit_price_paise: 32000,
      quantity: 1,
      line_total_paise: 32000,
    },
    {
      id: 'i-3',
      name: 'Nutella Croissant',
      unit_price_paise: 18000,
      quantity: 2,
      line_total_paise: 36000,
    },
    {
      id: 'i-4',
      name: 'Cold Brew Citrus',
      unit_price_paise: 22000,
      quantity: 1,
      line_total_paise: 22000,
    },
  ],
  subtotal_paise: 138000,
  tax_rate: 0,
  tax_paise: 0,
  total_paise: 138000,
  notes: null,
  issued_at: '2026-10-25T11:30:00Z',
  issued_by: 'staff-1',
};

const discountedBill: Bill = {
  ...multiItemBill,
  id: 'bill-discounted-1',
  bill_number: 'UB-01003',
  subtotal_before_discount_paise: 138000,
  discount_type: 'fixed',
  discount_value: 100,
  discount_paise: 10000,
  total_paise: 128000,
};

const longItemBill: Bill = {
  ...shortBill,
  id: 'bill-long-item-1',
  bill_number: 'UB-01004',
  items_snapshot: [
    {
      id: 'long-1',
      name: 'Artisanal Multigrain Sourdough with Wild Truffle Mushroom and Poached Organic Egg',
      unit_price_paise: 45000,
      quantity: 1,
      line_total_paise: 45000,
      note: 'Extra crispy sourdough base please',
      selected_options: [{ name: 'Extra Truffle Glaze', price_delta_paise: 0 }],
    },
  ],
  subtotal_paise: 45000,
  total_paise: 45000,
};

const mockOrder: KitchenTicketOrder = {
  id: 'ord-kot-large',
  order_number: 42,
  status: 'ACCEPTED',
  created_at: '2026-10-25T14:30:00Z',
  customer_name: 'Rahul Sharma',
  guest_count: 4,
  customer_note: 'Food allergy: No nuts anywhere',
  service_mode: 'dine_in',
  table_label: 'Table 9',
  order_items: [
    {
      item_name_snapshot: 'Spicy Peri Peri Paneer Pizza (Thin Crust)',
      quantity: 3,
      item_note: 'Well done crust',
      selected_options: [{ name: 'Extra Jalapenos' }],
      is_custom: false,
    },
    {
      item_name_snapshot: 'Cold Coffee with Ice Cream',
      quantity: 2,
      item_note: 'Less sweet',
      is_custom: true,
    },
  ],
};

describe('Thermal Canvas Height & Typography Hierarchy Verification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Customer Bill Canvas Height & Cropping', () => {
    it('produces a shorter canvas height for a 1-item bill than for a multi-item bill', () => {
      const shortCanvas = renderReceiptToCanvas(shortBill, { scale: 1 });
      const multiCanvas = renderReceiptToCanvas(multiItemBill, { scale: 1 });

      expect(shortCanvas.width).toBe(384);
      expect(multiCanvas.width).toBe(384);
      expect(shortCanvas.height).toBeLessThan(multiCanvas.height);
      // Multi-item bill has 3 extra items (each taking at least 40px)
      expect(multiCanvas.height - shortCanvas.height).toBeGreaterThanOrEqual(120);
    });

    it('renders discounted bills with BILL TOTAL, Discount, and AMOUNT TO PAY rows and adjusts canvas height accordingly', () => {
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

      const discountedCanvas = renderReceiptToCanvas(discountedBill, { scale: 1 });
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

      expect(filledTexts).toContain('BILL TOTAL:');
      expect(filledTexts).toContain('Discount (₹100):');
      expect(filledTexts).toContain('-₹100.00');
      expect(filledTexts).toContain('AMOUNT TO PAY:');
      expect(filledTexts).toContain('₹1280.00');

      // Bill with discount section renders extra rows, so its height is greater than or equal to the undiscounted bill
      const regularCanvas = renderReceiptToCanvas(multiItemBill, { scale: 1 });
      expect(discountedCanvas.height).toBeGreaterThanOrEqual(regularCanvas.height);
    });

    it('accommodates wrapped long dish names and modifiers without clipping', () => {
      const shortCanvas = renderReceiptToCanvas(shortBill, { scale: 1 });
      const longItemCanvas = renderReceiptToCanvas(longItemBill, { scale: 1 });

      // The long item bill has wrapping text, options, and notes, so height must expand
      expect(longItemCanvas.height).toBeGreaterThan(shortCanvas.height);
      expect(longItemCanvas.width).toBe(384);
    });

    it('crops trailing blank space to the exact content boundary plus cutter margin', () => {
      const canvas = renderReceiptToCanvas(shortBill, { scale: 1 });
      expect(canvas.width).toBe(384);
      // In JSDOM without getImageData, it trims using contentHeight calculation
      expect(canvas.height).toBeGreaterThan(350);
      expect(canvas.height).toBeLessThan(550);
    });

    it('handles reprint bills with duplicate banner without excessive whitespace', () => {
      const regularCanvas = renderReceiptToCanvas(shortBill, { scale: 1, isReprint: false });
      const reprintCanvas = renderReceiptToCanvas(shortBill, { scale: 1, isReprint: true });

      expect(reprintCanvas.width).toBe(384);
      // Reprint canvas accommodates the duplicate banner
      expect(reprintCanvas.height).toBeGreaterThanOrEqual(regularCanvas.height);
      expect(reprintCanvas.height - regularCanvas.height).toBeLessThanOrEqual(30);
    });
  });

  describe('Kitchen Order Ticket Typography Hierarchy (58mm Thermal Printer Visibility)', () => {
    it('renders with enlarged typography hierarchy for far-view kitchen visibility', () => {
      interface FontCall {
        text: string;
        font: string;
        textAlign: string;
        y: number;
      }
      const calls: FontCall[] = [];
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
          fillText: (text: string, _x: number, y: number) => {
            calls.push({ text, font: currentFont, textAlign: currentAlign, y });
          },
        };
      };

      const canvas = renderKitchenTicketToCanvas(mockOrder, { scale: 1 });
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

      expect(canvas.width).toBe(384);

      // 1. Order Number: 34px bold prominent mono font
      const orderNoCall = calls.find((c) => c.text === 'ORDER #42');
      expect(orderNoCall).toBeDefined();
      expect(orderNoCall?.font).toContain('34px');
      expect(orderNoCall?.font).toContain('bold');

      // 2. Table / Service Mode: 19px bold mono font
      const tableCall = calls.find((c) => c.text === 'TABLE 9');
      expect(tableCall).toBeDefined();
      expect(tableCall?.font).toContain('19px');
      expect(tableCall?.font).toContain('bold');

      // 3. Kitchen ticket heading: 17px bold mono
      const headerCall = calls.find((c) => c.text === 'URBANIA CAFE — KITCHEN TOKEN');
      expect(headerCall).toBeDefined();
      expect(headerCall?.font).toContain('17px');
      expect(headerCall?.font).toContain('bold');

      // 4. Section header: 16px bold mono
      const sectionCall = calls.find((c) => c.text === 'ITEMS TO PREPARE');
      expect(sectionCall).toBeDefined();
      expect(sectionCall?.font).toContain('16px');
      expect(sectionCall?.font).toContain('bold');

      // 5. Dish Items: 22px bold font for clear visibility
      const pizzaCall = calls.find((c) => c.text.includes('Peri Peri Paneer Pizza'));
      expect(pizzaCall).toBeDefined();
      expect(pizzaCall?.font).toMatch(/2[12]px/);
      expect(pizzaCall?.font).toContain('bold');

      // 6. Item Quantity: bold font
      const qtyCall = calls.find((c) => c.text === '3×' || c.text.startsWith('3× '));
      expect(qtyCall).toBeDefined();

      // 7. Modifiers and Item notes: italic font
      const noteCall = calls.find((c) => c.text.includes('Well done crust'));
      expect(noteCall).toBeDefined();
      expect(noteCall?.font).toMatch(/1[56]px/);
      expect(noteCall?.font).toContain('italic');

      // 8. Custom Dish marked with [CUSTOM]
      const customCall = calls.find((c) => c.text.includes('[CUSTOM] Cold Coffee'));
      expect(customCall).toBeDefined();

      // 9. Kitchen Copy non-bill footer
      const footerCall = calls.find((c) => c.text === '*** KITCHEN COPY — NOT A BILL ***');
      expect(footerCall).toBeDefined();
      expect(footerCall?.font).toContain('13px');

      // 10. Canvas height accommodates all items + padding without clipping
      const maxY = Math.max(...calls.map((c) => c.y));
      expect(canvas.height).toBeGreaterThanOrEqual(maxY);
    });

    it('never prints financial data (prices, tax, total, discounts) on kitchen ticket', () => {
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

      renderKitchenTicketToCanvas(mockOrder, { scale: 1 });
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

      expect(filledTexts.some((t) => t.includes('₹'))).toBe(false);
      expect(filledTexts.some((t) => t.toLowerCase().includes('total'))).toBe(false);
      expect(filledTexts.some((t) => t.toLowerCase().includes('discount'))).toBe(false);
      expect(filledTexts.some((t) => t.toLowerCase().includes('gst'))).toBe(false);
      expect(filledTexts.some((t) => t.toLowerCase().includes('subtotal'))).toBe(false);
    });

    it('guarantees deliberate separation between dashed lines and text (no collisions or overlapping)', () => {
      const lineYs: number[] = [];
      const textCalls: { text: string; y: number; font: string }[] = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;

      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
        const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
        let currentFont = '';
        return {
          ...ctx,
          set font(f: string) {
            currentFont = f;
          },
          get font() {
            return currentFont;
          },
          moveTo: (_x: number, y: number) => {
            lineYs.push(y);
          },
          fillText: (text: string, _x: number, y: number) => {
            textCalls.push({ text, y, font: currentFont });
          },
        };
      };

      renderKitchenTicketToCanvas(mockOrder, { scale: 1 });
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

      // Locate the divider under ITEMS TO PREPARE
      const sectionCall = textCalls.find((c) => c.text === 'ITEMS TO PREPARE');
      expect(sectionCall).toBeDefined();

      const linesAfterSection = lineYs.filter((y) => y > (sectionCall?.y ?? 0));
      expect(linesAfterSection.length).toBeGreaterThanOrEqual(1);
      const dividerUnderSection = linesAfterSection[0];

      // First item dish name:
      const firstItemCall = textCalls.find((c) => c.text.includes('Peri Peri Paneer Pizza'));
      expect(firstItemCall).toBeDefined();

      // Top of 21px font is y - ~17px. The top must be strictly below the divider by at least 8px!
      const fontAscender = 17; // approx ascender for 21px font
      const firstItemTop = (firstItemCall?.y ?? 0) - fontAscender;
      expect(firstItemTop - dividerUnderSection).toBeGreaterThanOrEqual(8);
    });

    it('prevents vertical overlap between consecutive dish names (e.g. Burnt Basque Cheesecake & [CUSTOM] Kashmiri Kahwa)', () => {
      const orderWithConsecutiveSingleLineItems: KitchenTicketOrder = {
        id: 'ord-kot-overlap-check',
        order_number: 14,
        status: 'ACCEPTED',
        created_at: '2026-10-25T14:30:00Z',
        service_mode: 'dine_in',
        table_label: 'Table 2',
        order_items: [
          {
            item_name_snapshot: 'Burnt Basque Cheesecake',
            quantity: 1,
            is_custom: false,
          },
          {
            item_name_snapshot: 'Kashmiri Kahwa',
            quantity: 1,
            is_custom: true,
          },
        ],
      };

      const itemCalls: { text: string; y: number }[] = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;

      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
        const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
        return {
          ...ctx,
          fillText: (text: string, _x: number, y: number) => {
            if (text.includes('Burnt Basque Cheesecake') || text.includes('Kashmiri Kahwa')) {
              itemCalls.push({ text, y });
            }
          },
        };
      };

      const canvas = renderKitchenTicketToCanvas(orderWithConsecutiveSingleLineItems, { scale: 1 });
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

      expect(itemCalls).toHaveLength(2);
      const cheesecake = itemCalls.find((c) => c.text.includes('Burnt Basque Cheesecake'))!;
      const kahwa = itemCalls.find((c) => c.text.includes('Kashmiri Kahwa'))!;

      expect(cheesecake).toBeDefined();
      expect(kahwa).toBeDefined();

      // With 21px bold font (ascender ~17px, descender ~4px):
      // Bottom of cheesecake is cheesecake.y + 4.
      // Top of kahwa is kahwa.y - 17.
      // kahwa.y - cheesecake.y must be at least 32px to guarantee >= 11px clear whitespace.
      const baselineDelta = kahwa.y - cheesecake.y;
      expect(baselineDelta).toBeGreaterThanOrEqual(32);

      const cheesecakeBottom = cheesecake.y + 4;
      const kahwaTop = kahwa.y - 17;
      const verticalClearance = kahwaTop - cheesecakeBottom;
      expect(verticalClearance).toBeGreaterThanOrEqual(10);

      // Verify canvas height accommodates all items + footer without clipping
      expect(canvas.height).toBeGreaterThanOrEqual(kahwa.y + 30);
    });

    it('properly spaces wrapped dish names, options, and notes from subsequent items', () => {
      const orderWithComplexItems: KitchenTicketOrder = {
        id: 'ord-kot-complex-spacing',
        order_number: 15,
        status: 'ACCEPTED',
        created_at: '2026-10-25T14:35:00Z',
        service_mode: 'takeaway',
        order_items: [
          {
            item_name_snapshot: 'Spicy Artisanal Multigrain Sourdough with Wild Truffle Mushroom',
            quantity: 2,
            is_custom: false,
            selected_options: [{ name: 'Extra Truffle Glaze' }, { name: 'Vegan Butter' }],
            note: 'Crispy well done',
          },
          {
            item_name_snapshot: 'Iced Spanish Latte',
            quantity: 1,
            is_custom: false,
          },
        ],
      };

      const capturedCalls: { text: string; y: number }[] = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;

      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
        const ctx = origGetContext.call(this, '2d') as unknown as Record<string, unknown>;
        return {
          ...ctx,
          fillText: (text: string, _x: number, y: number) => {
            capturedCalls.push({ text, y });
          },
        };
      };

      const canvas = renderKitchenTicketToCanvas(orderWithComplexItems, { scale: 1 });
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

      const noteCall = capturedCalls.find((c) => c.text.includes('Crispy well done'))!;
      const latteCall = capturedCalls.find((c) => c.text.includes('Iced Spanish Latte'))!;

      expect(noteCall).toBeDefined();
      expect(latteCall).toBeDefined();

      // Note font is 15px (descender ~3px). Latte font is 21px bold (ascender ~17px).
      // Note bottom = noteCall.y + 3.
      // Latte top = latteCall.y - 17.
      // Baseline delta must be >= 32px, yielding >= 12px vertical whitespace.
      const baselineDelta = latteCall.y - noteCall.y;
      expect(baselineDelta).toBeGreaterThanOrEqual(32);

      const noteBottom = noteCall.y + 3;
      const latteTop = latteCall.y - 17;
      expect(latteTop - noteBottom).toBeGreaterThanOrEqual(10);

      // Verify canvas height encompasses the entire ticket
      expect(canvas.height).toBeGreaterThanOrEqual(latteCall.y + 30);
    });
  });
});
