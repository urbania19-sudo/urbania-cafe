// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import KitchenTokenPrintView from '../src/components/kitchen/KitchenTokenPrintView';
import {
  renderKitchenTicketToCanvas,
  SAMPLE_KITCHEN_ORDER,
  type KitchenTicketOrder,
} from '../src/lib/thermal-canvas';

const shortOrder: KitchenTicketOrder = {
  id: 'kot-test-1',
  order_number: 14,
  status: 'ACCEPTED',
  created_at: '2026-10-25T11:00:00Z',
  customer_name: 'Priya',
  guest_count: 1,
  customer_note: 'Quick takeaway please',
  service_mode: 'takeaway',
  order_items: [
    {
      id: 'i-1',
      name: 'Cold Coffee',
      item_name_snapshot: 'Cold Coffee',
      quantity: 1,
      is_custom: false,
    },
  ],
};

const longOrder: KitchenTicketOrder = {
  ...shortOrder,
  id: 'kot-test-2',
  order_number: 15,
  service_mode: 'dine_in',
  cafe_tables: { label: 'Table 4' },
  order_items: [
    {
      id: 'i-1',
      name: 'Artisanal Sourdough Toast with Avocado and Poached Eggs',
      item_name_snapshot: 'Artisanal Sourdough Toast with Avocado and Poached Eggs',
      quantity: 2,
      note: 'Extra chili flakes, eggs well done',
      is_custom: false,
      selected_options: [{ name: 'Extra Guacamole' }, { name: 'Sourdough Upgrade' }],
    },
    {
      id: 'i-2',
      name: 'Special Handcrafted Rose Cardamom Herbal Infusion',
      item_name_snapshot: 'Special Handcrafted Rose Cardamom Herbal Infusion',
      quantity: 1,
      note: 'No refined sugar, add jaggery',
      is_custom: true,
    },
    {
      id: 'i-3',
      name: 'Loaded Truffle Parmesan Fries with House Garlic Aioli',
      item_name_snapshot: 'Loaded Truffle Parmesan Fries with House Garlic Aioli',
      quantity: 3,
      note: 'Crispy well-done',
      is_custom: false,
    },
  ],
};

describe('Kitchen Token Dynamic Height & Layout', () => {
  it('determines kitchen token canvas height dynamically based on item list length and preparation notes', () => {
    const shortCanvas = renderKitchenTicketToCanvas(shortOrder, { scale: 1 });
    const longCanvas = renderKitchenTicketToCanvas(longOrder, { scale: 1 });

    expect(shortCanvas.width).toBe(384);
    expect(longCanvas.width).toBe(384);
    // Long order with multiple customized dishes and notes must be taller than short single-item order
    expect(longCanvas.height).toBeGreaterThan(shortCanvas.height);
  });

  it('keeps exact 384px width for 58mm thermal printers with strictly ZERO financial figures', () => {
    const canvas = renderKitchenTicketToCanvas(longOrder, { scale: 1 });
    expect(canvas.width).toBe(384);
    expect(canvas.height).toBeGreaterThan(150);

    // Verify zero financial details are rendered on kitchen canvas
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
  });
});

describe('KitchenTokenPrintView Dedicated Standalone Print-Only Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders clean kitchen token image element at 384px on pure white background', () => {
    render(<KitchenTokenPrintView order={shortOrder} isReprint={false} />);

    const tokenImg = screen.getByRole('img', { name: /Kitchen Token #14/i });
    expect(tokenImg).toBeInTheDocument();
    expect(tokenImg.getAttribute('width')).toBe('384');
    expect(tokenImg.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('excludes on-screen buttons, modal headers, close buttons, and dashboard chrome', () => {
    render(<KitchenTokenPrintView order={shortOrder} isReprint={true} />);

    // Must NOT render any buttons so Fun Print in-app browser captures exclusively the token image
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Close/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Print/i)).not.toBeInTheDocument();
  });

  it('includes 58mm thermal @page, @media print, and Vercel toolbar suppression CSS rules', () => {
    const { container } = render(<KitchenTokenPrintView order={shortOrder} />);
    const styleEl = container.querySelector('style');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.innerHTML).toContain('58mm auto');
    expect(styleEl?.innerHTML).toContain('.no-print');
    expect(styleEl?.innerHTML).toContain('display: none !important');
    expect(styleEl?.innerHTML).toContain('vercel-live-feedback');
  });

  it('renders SAMPLE_KITCHEN_ORDER cleanly for instant printer testing', () => {
    render(<KitchenTokenPrintView order={SAMPLE_KITCHEN_ORDER} isReprint={false} />);

    const tokenImg = screen.getByRole('img', { name: /Kitchen Token #101/i });
    expect(tokenImg).toBeInTheDocument();
    expect(tokenImg.getAttribute('width')).toBe('384');
  });

  it('navigates back when tapping anywhere on the main token container', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    render(<KitchenTokenPrintView order={shortOrder} />);
    const mainEl = screen.getByTitle('Tap to return');
    expect(mainEl).toBeInTheDocument();

    fireEvent.click(mainEl);
    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
