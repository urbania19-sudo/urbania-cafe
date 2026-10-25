// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrderBoard from '@/components/staff/OrderBoard';

// Mock useRouter
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

// Mock fetch
const globalFetch = vi.fn();
global.fetch = globalFetch;

const mockMenu = [
  { id: 'item-1', name: 'Cold Coffee Frappe', price_paise: 16000, is_available: true },
  { id: 'item-2', name: 'Grilled Sandwich', price_paise: 12000, is_available: true },
];

const mockTables = [
  { id: 'table-1', table_number: 1, label: 'Table 1' },
];

describe('OrderBoard Simplified Workflow & Clean Interface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  it('never renders "Test Print" or "🖨️ Test Thermal Print" in the empty state', () => {
    render(<OrderBoard initial={[]} menu={mockMenu} tables={mockTables} />);
    expect(screen.queryByText(/Test Print/i)).toBeNull();
    expect(screen.queryByText(/Test Thermal Print/i)).toBeNull();
    expect(screen.getByText('Waiting for orders')).toBeInTheDocument();
  });

  it('never renders "Test Print" in the active orders queue', () => {
    const orders = [
      {
        id: 'ord-1',
        order_number: 101,
        status: 'NEW',
        customer_name: 'Aman',
        guest_count: 2,
        total_paise: 16000,
        created_at: new Date().toISOString(),
        billed_at: null,
        service_mode: 'dine_in',
        order_source: 'qr',
        cafe_tables: { label: 'Table 1' },
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);
    expect(screen.queryByText(/Test Print/i)).toBeNull();
    expect(screen.queryByText(/Test Thermal Print/i)).toBeNull();
  });

  it('renders "Order Placed" badge, "Accept Order" as primary action, and "Reject" for NEW orders', async () => {
    const orders = [
      {
        id: 'ord-1',
        order_number: 101,
        status: 'NEW',
        customer_name: 'Aman',
        guest_count: 2,
        total_paise: 16000,
        created_at: new Date().toISOString(),
        billed_at: null,
        service_mode: 'dine_in',
        order_source: 'qr',
        cafe_tables: { label: 'Table 1' },
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    expect(screen.getByText('Order Placed')).toBeInTheDocument();
    const acceptBtn = screen.getByRole('button', { name: 'Accept Order' });
    expect(acceptBtn).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();

    // Intermediate states must NOT be present
    expect(screen.queryByText('Start preparing')).toBeNull();
    expect(screen.queryByText('Mark ready')).toBeNull();

    // Clicking Accept Order sends transition to ACCEPTED
    globalFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(globalFetch).toHaveBeenCalledWith('/api/staff/orders/ord-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'ACCEPTED' }),
      }));
    });
  });

  it('renders "Accepted" badge, "Completed" as primary action, and NO intermediate preparation buttons for ACCEPTED orders', async () => {
    const orders = [
      {
        id: 'ord-2',
        order_number: 102,
        status: 'ACCEPTED',
        customer_name: 'Priya',
        guest_count: 1,
        total_paise: 28000,
        created_at: new Date().toISOString(),
        billed_at: null,
        service_mode: 'dine_in',
        order_source: 'qr',
        cafe_tables: { label: 'Table 2' },
        order_items: [{ menu_item_id: 'item-2', item_name_snapshot: 'Grilled Sandwich', quantity: 2 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    expect(screen.getByText('Accepted')).toBeInTheDocument();
    const completedBtn = screen.getByRole('button', { name: 'Completed' });
    expect(completedBtn).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit items' })).toBeInTheDocument();

    // Absolutely NO intermediate stages
    expect(screen.queryByText(/Preparing/i)).toBeNull();
    expect(screen.queryByText(/Ready/i)).toBeNull();
    expect(screen.queryByText(/Start preparing/i)).toBeNull();
    expect(screen.queryByText(/Mark ready/i)).toBeNull();

    // Clicking Completed advances to COMPLETED
    globalFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    fireEvent.click(completedBtn);

    await waitFor(() => {
      expect(globalFetch).toHaveBeenCalledWith('/api/staff/orders/ord-2', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      }));
    });
  });

  it('renders "Completed" badge and the single receipt action "View Image" for COMPLETED orders', async () => {
    const orders = [
      {
        id: 'ord-3',
        order_number: 103,
        status: 'COMPLETED',
        customer_name: 'Rahul',
        guest_count: 2,
        total_paise: 32000,
        created_at: new Date().toISOString(),
        billed_at: '2026-10-21T12:00:00Z',
        service_mode: 'takeaway',
        order_source: 'manual',
        cafe_tables: null,
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee Frappe', quantity: 2 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    
    // Exactly one receipt action: "View Image"
    const viewImageBtn = screen.getByRole('button', { name: 'View Image' });
    expect(viewImageBtn).toBeInTheDocument();

    // Obsolete printing buttons must NOT be present
    expect(screen.queryByText(/Print with Fun Print/i)).toBeNull();
    expect(screen.queryByText(/Download Receipt/i)).toBeNull();
    expect(screen.queryByText(/View Full PNG/i)).toBeNull();
    expect(screen.queryByText(/Test Print/i)).toBeNull();

    // Clicking "View Image" loads existing bill
    globalFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        bill: {
          id: 'bill-103',
          bill_number: 'UB-103',
          order_id: 'ord-3',
          order_number: 103,
          customer_name: 'Rahul',
          guest_count: 2,
          total_paise: 32000,
          subtotal_paise: 32000,
          tax_paise: 0,
          issued_at: new Date().toISOString(),
          status: 'issued',
          items_snapshot: [{ name: 'Cold Coffee Frappe', quantity: 2, unit_price_paise: 16000, line_total_paise: 32000 }],
        },
      }),
    });

    fireEvent.click(viewImageBtn);

    await waitFor(() => {
      expect(globalFetch).toHaveBeenCalledWith('/api/staff/orders/ord-3/bill');
      expect(screen.getByRole('dialog', { name: /Receipt Bill #UB-103/i })).toBeInTheDocument();
    });
  });

  it('allows filtering by All, Active, and Completed tabs', () => {
    const orders = [
      {
        id: 'ord-new',
        order_number: 101,
        status: 'NEW',
        customer_name: 'Aman',
        guest_count: 1,
        total_paise: 10000,
        created_at: new Date().toISOString(),
        cafe_tables: { label: 'T1' },
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee', quantity: 1 }],
      },
      {
        id: 'ord-done',
        order_number: 102,
        status: 'COMPLETED',
        customer_name: 'Simran',
        guest_count: 1,
        total_paise: 10000,
        created_at: new Date().toISOString(),
        cafe_tables: { label: 'T2' },
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee', quantity: 1 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    // Default: All tab shows both
    expect(screen.getByText('Order #101')).toBeInTheDocument();
    expect(screen.getByText('Order #102')).toBeInTheDocument();

    // Switch to Active tab
    fireEvent.click(screen.getByRole('button', { name: /Active \(1\)/i }));
    expect(screen.getByText('Order #101')).toBeInTheDocument();
    expect(screen.queryByText('Order #102')).toBeNull();

    // Switch to Completed tab
    fireEvent.click(screen.getByRole('button', { name: /Completed \(1\)/i }));
    expect(screen.queryByText('Order #101')).toBeNull();
    expect(screen.getByText('Order #102')).toBeInTheDocument();
  });

  it('renders high-contrast dropdown selector with dark brown text on white options and light color-scheme', () => {
    const orders = [
      {
        id: 'ord-edit-test',
        order_number: 105,
        status: 'ACCEPTED',
        customer_name: 'Priya',
        guest_count: 2,
        total_paise: 16000,
        created_at: new Date().toISOString(),
        billed_at: null,
        service_mode: 'dine_in',
        order_source: 'qr',
        cafe_tables: { label: 'Table 1' },
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    // Click "Edit items" to show item editor
    fireEvent.click(screen.getByRole('button', { name: 'Edit items' }));

    // Select element exists with accessible label
    const select = screen.getByRole('combobox', { name: 'Add an item to order' });
    expect(select).toBeInTheDocument();

    // Verify select styles: dark-brown and gold theme with light color-scheme
    expect(select.style.colorScheme).toBe('light');
    expect(select.style.width).toBe('100%');

    // Verify options: high-contrast dark brown text (#2b1b16) on white background (#ffffff)
    const options = select.querySelectorAll('option');
    expect(options.length).toBeGreaterThanOrEqual(2); // placeholder + available item-2

    // Placeholder option
    expect(options[0].textContent).toBe('+ Add an item…');
    expect(options[0].style.color).toBe('rgb(109, 84, 69)'); // #6d5445
    expect(options[0].style.backgroundColor).toBe('rgb(251, 248, 242)'); // #fbf8f2

    // Menu item option (Grilled Sandwich · ₹120.00)
    expect(options[1].textContent).toContain('Grilled Sandwich · ₹120.00');
    expect(options[1].style.color).toBe('rgb(43, 27, 22)'); // #2b1b16
    expect(options[1].style.backgroundColor).toBe('rgb(255, 255, 255)'); // #ffffff

    // Add item by selecting it
    fireEvent.change(select, { target: { value: 'item-2' } });

    // Item-2 is now in Selected Items list
    expect(screen.getByText('Grilled Sandwich')).toBeInTheDocument();
  });

  it('surfaces meaningful backend error when order completion fails', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Order #106 has an active bill and cannot be transitioned' }),
    });

    const orders = [
      {
        id: 'ord-fail',
        order_number: 106,
        status: 'ACCEPTED',
        customer_name: 'Priya',
        guest_count: 2,
        total_paise: 16000,
        created_at: new Date().toISOString(),
        billed_at: null,
        service_mode: 'dine_in',
        order_source: 'qr',
        cafe_tables: { label: 'Table 1' },
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));

    await waitFor(() => {
      expect(screen.getByText('Order #106 has an active bill and cannot be transitioned')).toBeInTheDocument();
    });
  });

  it('handles network errors gracefully in a finally block without leaving buttons stuck in busy state', async () => {
    globalFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const orders = [
      {
        id: 'ord-net-fail',
        order_number: 107,
        status: 'ACCEPTED',
        customer_name: 'Priya',
        guest_count: 2,
        total_paise: 16000,
        created_at: new Date().toISOString(),
        billed_at: null,
        service_mode: 'dine_in',
        order_source: 'qr',
        cafe_tables: { label: 'Table 1' },
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    const completedBtn = screen.getByRole('button', { name: 'Completed' });
    fireEvent.click(completedBtn);

    await waitFor(() => {
      expect(screen.getByText(/Network connection error/i)).toBeInTheDocument();
    });

    // Button must NOT be stuck in "Updating…" or disabled
    expect(screen.getByRole('button', { name: 'Completed' })).not.toBeDisabled();
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it('allows staff to edit items, adjust quantities, add catalogue dishes, and add custom dishes on eligible unbilled orders', async () => {
    const orders = [
      {
        id: 'ord-edit-1',
        order_number: 109,
        status: 'ACCEPTED',
        customer_name: 'Vikram',
        guest_count: 2,
        total_paise: 16000,
        created_at: new Date().toISOString(),
        billed_at: null,
        service_mode: 'dine_in',
        order_source: 'manual',
        cafe_tables: { label: 'Table 3' },
        order_items: [
          {
            id: 'oi-1',
            menu_item_id: 'item-1',
            item_name_snapshot: 'Cold Coffee Frappe',
            quantity: 1,
            unit_price_paise: 16000,
          },
        ],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    // "Edit items" button is available on unbilled ACCEPTED order
    const editBtn = screen.getByRole('button', { name: 'Edit items' });
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);

    // Edit interface opens with order items
    expect(screen.getByText('Edit Order Items:')).toBeInTheDocument();
    expect(screen.getByText('New Order Total:')).toBeInTheDocument();

    // Increase quantity using '+'
    const plusBtn = screen.getByRole('button', { name: 'More' });
    fireEvent.click(plusBtn);

    // Add a custom non-catalogue dish
    const customToggleBtn = screen.getByRole('button', { name: /\+ Add Custom Dish/i });
    fireEvent.click(customToggleBtn);

    const customNameInput = screen.getByPlaceholderText(/Dish name/i);
    const customPriceInput = screen.getByPlaceholderText(/Price \(₹\)/i);
    const customNoteInput = screen.getByPlaceholderText(/Special instructions/i);

    fireEvent.change(customNameInput, { target: { value: 'Extra Garlic Toast' } });
    fireEvent.change(customPriceInput, { target: { value: '80' } });
    fireEvent.change(customNoteInput, { target: { value: 'Crispy' } });

    fireEvent.click(screen.getByRole('button', { name: '+ Add to Order' }));

    // Verify custom item added
    expect(screen.getByText('Extra Garlic Toast')).toBeInTheDocument();
    expect(screen.getByText('Note: Crispy')).toBeInTheDocument();

    // Click Save changes
    globalFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const saveBtn = screen.getByRole('button', { name: 'Save changes' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(globalFetch).toHaveBeenCalledWith(
        '/api/staff/orders/ord-edit-1/items',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            items: [
              {
                isCustom: false,
                menuItemId: 'item-1',
                quantity: 2,
                note: null,
              },
              {
                isCustom: true,
                name: 'Extra Garlic Toast',
                unitPricePaise: 8000,
                quantity: 1,
                note: 'Crispy',
              },
            ],
          }),
        })
      );
    });
  });

  it('strictly preserves immutability by hiding Edit Items for billed, completed, or cancelled orders', () => {
    const orders = [
      {
        id: 'ord-billed',
        order_number: 110,
        status: 'ACCEPTED',
        customer_name: 'Ananya',
        guest_count: 1,
        total_paise: 16000,
        created_at: new Date().toISOString(),
        billed_at: '2026-10-25T10:00:00Z',
        service_mode: 'counter',
        order_source: 'manual',
        cafe_tables: null,
        order_items: [{ menu_item_id: 'item-1', item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
      },
      {
        id: 'ord-comp',
        order_number: 111,
        status: 'COMPLETED',
        customer_name: 'Karan',
        guest_count: 2,
        total_paise: 12000,
        created_at: new Date().toISOString(),
        billed_at: '2026-10-25T10:30:00Z',
        service_mode: 'dine_in',
        order_source: 'qr',
        cafe_tables: { label: 'Table 1' },
        order_items: [{ menu_item_id: 'item-2', item_name_snapshot: 'Grilled Sandwich', quantity: 1 }],
      },
      {
        id: 'ord-canc',
        order_number: 112,
        status: 'CANCELLED',
        customer_name: 'Dev',
        guest_count: 1,
        total_paise: 12000,
        created_at: new Date().toISOString(),
        billed_at: null,
        service_mode: 'takeaway',
        order_source: 'manual',
        cafe_tables: null,
        order_items: [{ menu_item_id: 'item-2', item_name_snapshot: 'Grilled Sandwich', quantity: 1 }],
      },
    ];

    render(<OrderBoard initial={orders} menu={mockMenu} tables={mockTables} />);

    // None of the orders should render an "Edit items" button
    expect(screen.queryByRole('button', { name: 'Edit items' })).toBeNull();
  });
});
