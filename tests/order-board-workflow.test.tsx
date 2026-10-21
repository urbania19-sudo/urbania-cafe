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
});
