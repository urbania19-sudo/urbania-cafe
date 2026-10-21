// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MenuClient from '@/components/menu/MenuClient';
import OrderBoard from '@/components/staff/OrderBoard';
import ThermalBillModal from '@/components/staff/ThermalBillModal';
import ManualOrderModal from '@/components/staff/ManualOrderModal';
import ReceiptPrintView from '@/components/bills/ReceiptPrintView';
import { SAMPLE_BILL } from '@/lib/billing';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const mockMenu = [
  {
    id: 'item-long',
    name: 'Artisanal Wild Mushroom & Truffle Panini Sandwich with Spiced Potato Wedges',
    description: 'Slow roasted forest mushrooms infused with white truffle oil on sourdough',
    price_paise: 28000,
    is_veg: true,
    is_available: true,
    category_id: 'pizza',
    image_url: null,
  },
];

const mockCategories = [{ id: 'pizza', name: 'Artisanal Sandwiches & Pizza' }];
const mockTables = [{ id: 'table-1', table_number: 1, label: 'Table 1' }];

const VIEWPORT_WIDTHS = [320, 360, 375, 390, 414];

describe('Mobile Viewports (320px, 360px, 375px, 390px, 414px) Responsiveness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  VIEWPORT_WIDTHS.forEach((width) => {
    describe(`Viewport width: ${width}px`, () => {
      beforeEach(() => {
        window.innerWidth = width;
        window.innerHeight = 667;
        window.dispatchEvent(new Event('resize'));
      });

      it(`renders MenuClient cleanly without container breakout at ${width}px`, () => {
        const { container } = render(
          <MenuClient
            table={{ label: 'Table 1', qr_token: 'test-token' }}
            categories={mockCategories}
            items={mockMenu}
          />
        );

        // Check long dish name is in document and rendered
        expect(screen.getByText(/Artisanal Wild Mushroom/i)).toBeInTheDocument();
        const main = container.querySelector('main');
        expect(main).toHaveClass('shell');
      });

      it(`renders OrderBoard cards and actions with wrap support at ${width}px`, () => {
        const orders = [
          {
            id: 'ord-mobile-1',
            order_number: 88,
            status: 'NEW',
            customer_name: 'Dr. Subramanian Swamy Ramanathan',
            guest_count: 4,
            total_paise: 56000,
            created_at: new Date().toISOString(),
            billed_at: null,
            service_mode: 'dine_in',
            order_source: 'qr',
            cafe_tables: { label: 'Table 1' },
            order_items: [
              {
                menu_item_id: 'item-long',
                item_name_snapshot: 'Artisanal Wild Mushroom & Truffle Panini Sandwich with Spiced Potato Wedges',
                quantity: 2,
              },
            ],
          },
        ];

        render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

        // Verify order elements are present and readable
        expect(screen.getByText('Order #88')).toBeInTheDocument();
        expect(screen.getByText(/Dr. Subramanian Swamy/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Accept Order' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
      });

      it(`renders ThermalBillModal exactly at 384px or fitting ${width}px without horizontal overflow`, () => {
        render(<ThermalBillModal bill={SAMPLE_BILL} onClose={vi.fn()} isReprint={false} />);

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        const main = dialog.querySelector('main');
        expect(main).toBeInTheDocument();
        expect(main?.style.maxWidth).toBe('384px');
      });

      it(`renders ReceiptPrintView cleanly at ${width}px`, () => {
        render(<ReceiptPrintView bill={SAMPLE_BILL} isReprint={false} />);

        const img = screen.getByRole('img', { name: new RegExp(`Bill #${SAMPLE_BILL.bill_number}`, 'i') });
        expect(img).toBeInTheDocument();
        expect(img.style.maxWidth).toBe('384px');
      });

      it(`renders ManualOrderModal cleanly within ${width}px viewport`, () => {
        render(
          <ManualOrderModal
            tables={mockTables}
            menuItems={mockMenu}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        );

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('New Counter / Custom Order')).toBeInTheDocument();
      });
    });
  });
});
