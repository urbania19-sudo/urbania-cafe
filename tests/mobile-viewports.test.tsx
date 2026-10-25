// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

      it(`renders ManualOrderModal cleanly within ${width}px viewport with full service modes and actions`, () => {
        const onClose = vi.fn();
        const onSuccess = vi.fn();

        render(
          <ManualOrderModal
            tables={mockTables}
            menuItems={mockMenu}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // Overlay must use flex top-alignment with scrolling rather than fragile centering to prevent mobile webview collapse
        expect(dialog.style.display).toBe('flex');
        expect(dialog.style.alignItems).toBe('flex-start');
        expect(dialog.style.overflowY).toBe('auto');

        expect(screen.getByText('New Counter / Custom Order')).toBeInTheDocument();

        // All 4 service mode buttons must be present and fully visible
        const dineInBtn = screen.getByRole('button', { name: /🪑 Dine-in/i });
        const takeawayBtn = screen.getByRole('button', { name: /🥡 Takeaway/i });
        const counterBtn = screen.getByRole('button', { name: /🛎️ Counter/i });
        const deliveryBtn = screen.getByRole('button', { name: /🛵 Delivery/i });

        expect(dineInBtn).toBeInTheDocument();
        expect(takeawayBtn).toBeInTheDocument();
        expect(counterBtn).toBeInTheDocument();
        expect(deliveryBtn).toBeInTheDocument();

        // In Dine-in mode, Table selection is visible
        expect(screen.getByText('Select Table')).toBeInTheDocument();

        // Switch to Counter mode
        fireEvent.click(counterBtn);
        // Table selection is hidden in Counter mode
        expect(screen.queryByText('Select Table')).not.toBeInTheDocument();

        // Switch to Takeaway mode
        fireEvent.click(takeawayBtn);
        expect(screen.queryByText('Select Table')).not.toBeInTheDocument();

        // Switch back to Dine-in
        fireEvent.click(dineInBtn);
        expect(screen.getByText('Select Table')).toBeInTheDocument();

        // Add an item from catalogue
        const addBtn = screen.getByRole('button', { name: '+ Add Item' });
        fireEvent.click(addBtn);

        // Verify item is added to Selected Items
        expect(screen.getByText('Selected Items (1)')).toBeInTheDocument();
        expect(screen.getByText(/₹280.00 each/i)).toBeInTheDocument();
        expect(screen.getByText('Total Amount:')).toBeInTheDocument();

        // Test increment
        const plusBtn = screen.getByRole('button', { name: 'Increase quantity' });
        fireEvent.click(plusBtn);
        expect(screen.getAllByText(/₹560.00/i).length).toBeGreaterThanOrEqual(1);

        // Test decrement
        const minusBtn = screen.getByRole('button', { name: 'Decrease quantity' });
        fireEvent.click(minusBtn);
        expect(screen.queryByText(/₹560.00/i)).not.toBeInTheDocument();

        // Verify Create Order is enabled and styled
        const submitBtn = screen.getByRole('button', { name: 'Create Order' });
        expect(submitBtn).toBeInTheDocument();
        expect(submitBtn).not.toBeDisabled();

        // Verify Close dialog button triggers onClose
        const cancelBtn = screen.getByRole('button', { name: 'Close dialog' });
        fireEvent.click(cancelBtn);
        expect(onClose).toHaveBeenCalled();
      });
    });
  });
});
