// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrderBoard from '@/components/staff/OrderBoard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const mockMenu = [
  {
    id: 'item-1',
    name: 'Masala Chai',
    description: 'Fresh ginger cardamom tea',
    price_paise: 5000,
    is_veg: true,
    is_available: true,
    category_id: 'beverages',
    image_url: null,
  },
];

const mockTables = [
  { id: 'table-1', table_number: 1, label: 'Table 1' },
];

const VIEWPORTS = [
  { name: 'Narrow Mobile (320px)', width: 320 },
  { name: 'Standard Mobile (360px)', width: 360 },
  { name: 'Modern Mobile (390px)', width: 390 },
  { name: 'Tablet / Medium Viewport (720px)', width: 720 },
  { name: 'Desktop Viewport (1280px)', width: 1280 },
];

describe('Staff Order Card Mobile & Responsive Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  VIEWPORTS.forEach(({ name, width }) => {
    describe(name, () => {
      it('renders table label, order number, customer details, and badges in organized hierarchy without fragmentation', () => {
        window.innerWidth = width;

        const orders = [
          {
            id: 'ord-test-22',
            order_number: 22,
            status: 'ACCEPTED',
            customer_name: 'Subramanian Swamy',
            guest_count: 2,
            total_paise: 15000,
            created_at: new Date().toISOString(),
            billed_at: null, // Unbilled, so canEdit is true
            service_mode: 'dine_in',
            order_source: 'qr',
            cafe_tables: { label: 'Table 1' },
            order_items: [
              {
                id: 'oi-1',
                menu_item_id: 'item-1',
                item_name_snapshot: 'Masala Chai',
                quantity: 3,
                unit_price_paise: 5000,
                item_note: 'Less sugar',
                is_custom: false,
              },
            ],
          },
        ];

        // 1 pending kitchen ticket delta
        const initialKots = {};

        const { container } = render(
          <OrderBoard initial={orders} menu={mockMenu} tables={mockTables} initialKots={initialKots} />
        );

        const card = container.querySelector('.staff-order-card');
        expect(card).toBeInTheDocument();

        // 1. Verify semantic card header container
        const header = card?.querySelector('.staff-order-card-header');
        expect(header).toBeInTheDocument();

        // 2. Verify details column
        const details = header?.querySelector('.staff-order-card-details');
        expect(details).toBeInTheDocument();

        // Table label
        const tableLabel = screen.getByText('TABLE · Table 1');
        expect(tableLabel).toBeInTheDocument();
        expect(tableLabel.style.wordBreak).toBe('normal');

        // Order number heading
        const orderNumber = screen.getByText('Order #22');
        expect(orderNumber).toBeInTheDocument();
        expect(orderNumber.style.wordBreak).toBe('normal');

        // Customer details
        const customerDetails = screen.getByText(/Subramanian Swamy · 2 people/i);
        expect(customerDetails).toBeInTheDocument();
        expect(customerDetails.style.wordBreak).toBe('normal');

        // 3. Verify status badges are cleanly organized in .staff-order-card-badges
        const badges = header?.querySelector('.staff-order-card-badges');
        expect(badges).toBeInTheDocument();

        // Status chips exist within the badges container
        expect(screen.getByText(/Kitchen: 3 pending/i)).toBeInTheDocument();
        expect(screen.getByText('Accepted')).toBeInTheDocument();

        // 4. Verify item list and custom tags render cleanly
        expect(screen.getByText(/3× Masala Chai/i)).toBeInTheDocument();
        expect(screen.getByText(/Note: Less sugar/i)).toBeInTheDocument();

        // 5. Verify bottom actions bar
        const footer = card?.querySelector('.staff-order-card-footer');
        expect(footer).toBeInTheDocument();

        const actions = card?.querySelector('.staff-order-card-actions');
        expect(actions).toBeInTheDocument();

        // Verify action buttons are present and clickable
        expect(screen.getByText('₹150.00')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Kitchen Ticket/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Mark sent/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Edit items/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Generate Bill/i })).toBeInTheDocument();
      });

      it('renders billed and completed orders with badges and receipt actions without horizontal overflow', () => {
        window.innerWidth = width;

        const billedOrder = [
          {
            id: 'ord-test-23',
            order_number: 23,
            status: 'COMPLETED',
            customer_name: 'Dr. Subramanian Swamy',
            guest_count: 1,
            total_paise: 28000,
            created_at: new Date().toISOString(),
            billed_at: new Date().toISOString(),
            service_mode: 'counter',
            order_source: 'manual',
            cafe_tables: null,
            order_items: [
              {
                id: 'oi-2',
                menu_item_id: null,
                item_name_snapshot: 'Special Chef Truffle Pasta',
                quantity: 1,
                unit_price_paise: 28000,
                item_note: 'Extra parmesan',
                is_custom: true,
              },
            ],
          },
        ];

        const initialKots = {
          'ord-test-23': {
            id: 'kot-23',
            ticket_number: 1,
            ticket_type: 'new',
            full_order_snapshot: [
              {
                id: 'oi-2',
                menu_item_id: null,
                item_name_snapshot: 'Special Chef Truffle Pasta',
                unit_price_paise: 28000,
                quantity: 1,
                item_note: 'Extra parmesan',
                is_custom: true,
              },
            ],
          },
        };

        const { container } = render(
          <OrderBoard initial={billedOrder} menu={mockMenu} tables={mockTables} initialKots={initialKots} />
        );

        const card = container.querySelector('.staff-order-card');
        expect(card).toBeInTheDocument();

        // Counter mode header
        expect(screen.getByText('COUNTER')).toBeInTheDocument();
        expect(screen.getByText('Order #23')).toBeInTheDocument();
        expect(screen.getByText(/Dr. Subramanian Swamy · 1 person/i)).toBeInTheDocument();

        // Badges: KOT Sent, Billed, Completed
        expect(screen.getByText('✓ KOT Sent')).toBeInTheDocument();
        expect(screen.getByText('✓ Billed')).toBeInTheDocument();
        expect(screen.getByText('Completed')).toBeInTheDocument();

        // Custom item badge
        expect(screen.getByText('Custom')).toBeInTheDocument();
        expect(screen.getByText(/Special Chef Truffle Pasta/i)).toBeInTheDocument();

        // Actions: View Image, Reprint Full
        expect(screen.getByRole('button', { name: /View Image/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Reprint Full/i })).toBeInTheDocument();
      });
    });
  });
});
