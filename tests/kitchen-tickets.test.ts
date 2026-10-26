// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeItemSignature,
  computeKitchenTicketDelta,
  createFullReprintTicket,
} from '@/lib/kitchen-tickets';
import { renderKitchenTicketToCanvas, type KitchenTicketOrderItem } from '@/lib/thermal-canvas';

describe('Kitchen Ticket Delta Calculation & Signatures', () => {
  it('normalizes catalogue item signatures consistently regardless of modifier order', () => {
    const itemA: KitchenTicketOrderItem = {
      menu_item_id: 'item-101',
      name: 'Cappuccino',
      quantity: 1,
      selected_options: [{ name: 'Extra Shot' }, { name: 'Oat Milk' }],
      note: 'Very hot',
    };

    const itemB: KitchenTicketOrderItem = {
      menu_item_id: 'item-101',
      item_name_snapshot: 'Cappuccino',
      quantity: 2,
      selected_options_snapshot: [{ name: 'Oat Milk' }, { name: 'Extra Shot' }],
      item_note: 'VERY HOT ',
    };

    expect(normalizeItemSignature(itemA)).toBe(normalizeItemSignature(itemB));
  });

  it('distinguishes items with different modifiers or notes', () => {
    const itemHot: KitchenTicketOrderItem = {
      menu_item_id: 'item-101',
      quantity: 1,
      note: 'Extra hot',
    };

    const itemMild: KitchenTicketOrderItem = {
      menu_item_id: 'item-101',
      quantity: 1,
      note: 'Less hot',
    };

    expect(normalizeItemSignature(itemHot)).not.toBe(normalizeItemSignature(itemMild));
  });

  it('normalizes custom item signatures correctly', () => {
    const customA: KitchenTicketOrderItem = {
      is_custom: true,
      name: 'Custom Waffle',
      unit_price_paise: 15000,
      quantity: 1,
      note: 'Extra maple syrup',
    };

    const customB: KitchenTicketOrderItem = {
      is_custom: true,
      item_name_snapshot: ' custom waffle ',
      unit_price_paise: 15000,
      quantity: 2,
      item_note: 'EXTRA MAPLE SYRUP',
    };

    expect(normalizeItemSignature(customA)).toBe(normalizeItemSignature(customB));
  });

  it('generates a complete NEW ticket when no acknowledged snapshot exists', () => {
    const initialItems: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 1 },
      { menu_item_id: 'i2', name: 'Masala Chai', quantity: 2 },
    ];

    const result = computeKitchenTicketDelta(initialItems, null);

    expect(result.ticketType).toBe('new');
    expect(result.hasAdditions).toBe(true);
    expect(result.deltaItems).toHaveLength(2);
    expect(result.deltaItems[0]?.name).toBe('Paneer Sandwich');
    expect(result.deltaItems[0]?.quantity_display).toBe('1×');
    expect(result.deltaItems[1]?.name).toBe('Masala Chai');
    expect(result.deltaItems[1]?.quantity_display).toBe('2×');
  });

  it('generates an ADD-ON ticket containing ONLY new items added to an existing order', () => {
    const acknowledgedSnapshot: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 1 },
      { menu_item_id: 'i2', name: 'Masala Chai', quantity: 2 },
    ];

    const updatedCurrentItems: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 1 },
      { menu_item_id: 'i2', name: 'Masala Chai', quantity: 2 },
      { menu_item_id: 'i3', name: 'French Fries', quantity: 1 },
      { menu_item_id: 'i4', name: 'Cold Coffee', quantity: 1 },
    ];

    const result = computeKitchenTicketDelta(updatedCurrentItems, acknowledgedSnapshot);

    expect(result.ticketType).toBe('addon');
    expect(result.hasAdditions).toBe(true);
    expect(result.deltaItems).toHaveLength(2);
    expect(result.deltaItems.map((d) => d.name)).toEqual(['French Fries', 'Cold Coffee']);
    expect(result.deltaItems[0]?.quantity_display).toBe('1×');
    expect(result.deltaItems[1]?.quantity_display).toBe('1×');
  });

  it('generates an ADD-ON ticket with +delta when an existing dish quantity is increased', () => {
    const acknowledgedSnapshot: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 1 },
      { menu_item_id: 'i2', name: 'Masala Chai', quantity: 2 },
    ];

    // Customer increases Masala Chai from 2 to 4
    const updatedCurrentItems: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 1 },
      { menu_item_id: 'i2', name: 'Masala Chai', quantity: 4 },
    ];

    const result = computeKitchenTicketDelta(updatedCurrentItems, acknowledgedSnapshot);

    expect(result.ticketType).toBe('addon');
    expect(result.hasAdditions).toBe(true);
    expect(result.deltaItems).toHaveLength(1);
    expect(result.deltaItems[0]?.name).toBe('Masala Chai');
    expect(result.deltaItems[0]?.quantity).toBe(2);
    expect(result.deltaItems[0]?.quantity_display).toBe('+2×');
    expect(result.deltaItems[0]?.is_addition_increase).toBe(true);
  });

  it('never treats decreases or removals as additions', () => {
    const acknowledgedSnapshot: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 2 },
      { menu_item_id: 'i2', name: 'Masala Chai', quantity: 2 },
    ];

    // Customer removes sandwich and reduces chai to 1
    const updatedCurrentItems: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i2', name: 'Masala Chai', quantity: 1 },
    ];

    const result = computeKitchenTicketDelta(updatedCurrentItems, acknowledgedSnapshot);

    expect(result.ticketType).toBe('none');
    expect(result.hasAdditions).toBe(false);
    expect(result.deltaItems).toHaveLength(0);
  });

  it('reports ticketType none when no changes were made', () => {
    const acknowledgedSnapshot: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 1 },
    ];

    const currentItems: KitchenTicketOrderItem[] = [
      { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 1 },
    ];

    const result = computeKitchenTicketDelta(currentItems, acknowledgedSnapshot);

    expect(result.ticketType).toBe('none');
    expect(result.hasAdditions).toBe(false);
    expect(result.deltaItems).toHaveLength(0);
  });

  it('generates a full reprint ticket with all current items intact', () => {
    const order = {
      id: 'ord-101',
      order_number: 101,
      order_items: [
        { menu_item_id: 'i1', name: 'Paneer Sandwich', quantity: 1 },
        { menu_item_id: 'i2', name: 'Masala Chai', quantity: 4 },
      ],
    };

    const reprint = createFullReprintTicket(order);

    expect(reprint.ticket_type).toBe('reprint');
    expect(reprint.order_items).toHaveLength(2);
    expect(reprint.order_items[0]?.quantity_display).toBe('1×');
    expect(reprint.order_items[1]?.quantity_display).toBe('4×');
  });

  it('renders appropriate titles and banners on thermal canvas for new, addon, and reprint tickets', () => {
    const filledTexts: string[] = [];
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName.toLowerCase() === 'canvas') {
        const mockCtx = {
          scale: vi.fn(),
          measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
          fillText: vi.fn((text: string) => filledTexts.push(text)),
          fillRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          setLineDash: vi.fn(),
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({
            data: new Uint8ClampedArray(384 * 100 * 4).fill(255),
          })),
        };
        (el as unknown as { getContext: () => typeof mockCtx }).getContext = () => mockCtx;
      }
      return el;
    });

    // 1. New Order
    filledTexts.length = 0;
    renderKitchenTicketToCanvas({
      id: 'o-new',
      order_number: 101,
      ticket_type: 'new',
      order_items: [{ name: 'Paneer Sandwich', quantity: 1 }],
    });
    expect(filledTexts).toContain('NEW ORDER — ORDER #101');

    // 2. Add-on Order
    filledTexts.length = 0;
    renderKitchenTicketToCanvas({
      id: 'o-addon',
      order_number: 101,
      ticket_type: 'addon',
      order_items: [{ name: 'French Fries', quantity: 1 }],
    });
    expect(filledTexts).toContain('ADD-ON ORDER #101');
    expect(filledTexts).toContain('*** ADD-ON ITEMS ONLY ***');

    // 3. Full Reprint
    filledTexts.length = 0;
    renderKitchenTicketToCanvas({
      id: 'o-reprint',
      order_number: 101,
      ticket_type: 'reprint',
      order_items: [{ name: 'Paneer Sandwich', quantity: 1 }, { name: 'French Fries', quantity: 1 }],
    });
    expect(filledTexts).toContain('ORDER #101');
    expect(filledTexts).toContain('*** DUPLICATE KITCHEN TICKET — FULL ORDER ***');
  });
});
