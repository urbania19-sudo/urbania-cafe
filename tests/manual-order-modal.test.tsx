// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ManualOrderModal from '@/components/staff/ManualOrderModal';

const mockMenu = [
  {
    id: 'item-1',
    name: 'Espresso',
    price_paise: 15000,
    is_available: true,
    category_name: 'Coffee',
  },
  {
    id: 'item-2',
    name: 'Cappuccino',
    price_paise: 22000,
    is_available: true,
    category_name: 'Coffee',
  },
  {
    id: 'item-3',
    name: 'Masala Toastie',
    price_paise: 18000,
    is_available: true,
    category_name: 'Snacks',
  },
  {
    id: 'item-4',
    name: 'Chocolate Brownie',
    price_paise: 16000,
    is_available: true,
    category_name: 'Desserts',
  },
  {
    id: 'item-5',
    name: 'Sold Out Pastry',
    price_paise: 20000,
    is_available: false,
    category_name: 'Desserts',
  },
];

const mockTables = [
  { id: 'tbl-1', table_number: 1, label: 'Table 1' },
  { id: 'tbl-2', table_number: 2, label: 'Table 2' },
];

describe('ManualOrderModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes when pressing the Escape key', () => {
    const onClose = vi.fn();
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={onClose}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders modal heading as "New Order"', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { level: 2, name: 'New Order' })).toBeInTheDocument();
  });

  it('offers only Dine-in and Takeaway service modes (Counter and Delivery removed)', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Dine-in and Takeaway must be present
    expect(screen.getByRole('button', { name: /🪑 Dine-in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🥡 Takeaway/i })).toBeInTheDocument();

    // Counter and Delivery must be completely absent
    expect(screen.queryByRole('button', { name: /🛎️ Counter/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /🛵 Delivery/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Counter/i)).not.toBeInTheDocument();
  });

  it('retains Table selector for Dine-in and hides it for Takeaway', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Dine-in default: Table selector is displayed
    expect(screen.getByText('Select Table')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    // Switch to Takeaway mode: Table selector is omitted
    const takeawayBtn = screen.getByRole('button', { name: /🥡 Takeaway/i });
    fireEvent.click(takeawayBtn);
    expect(screen.queryByText('Select Table')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    // Switch back to Dine-in: Table selector reappears
    const dineInBtn = screen.getByRole('button', { name: /🪑 Dine-in/i });
    fireEvent.click(dineInBtn);
    expect(screen.getByText('Select Table')).toBeInTheDocument();
  });

  it('does not display Guest Name or Guest Count inputs', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    expect(screen.queryByText(/Guest Count/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Customer Name/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Walk-in Guest/i)).not.toBeInTheDocument();

    // Optional Order Note must remain
    expect(screen.getByText(/Order Note \(Optional\)/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Parcel box \/ Less ice/i)).toBeInTheDocument();
  });

  it('renders Menu Catalogue with search, category filter chips, and available dish count', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Shows 4 available dishes (item-5 is unavailable and excluded)
    expect(screen.getByText(/Menu Catalogue \(4 dishes available\)/i)).toBeInTheDocument();

    // Category chips: ALL, Coffee, Snacks, Desserts
    expect(screen.getByRole('button', { name: 'ALL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coffee' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snacks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desserts' })).toBeInTheDocument();

    // Search input is present
    const searchInput = screen.getByRole('textbox', { name: /Search menu dishes/i });
    expect(searchInput).toBeInTheDocument();

    // Unavailable dish must NOT be rendered
    expect(screen.queryByText(/Sold Out Pastry/i)).not.toBeInTheDocument();
  });

  it('filters dishes by category chips and allows clearing search', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Click "Coffee" category chip
    fireEvent.click(screen.getByRole('button', { name: 'Coffee' }));
    expect(screen.getByText(/🍽️ Espresso/i)).toBeInTheDocument();
    expect(screen.getByText(/🍽️ Cappuccino/i)).toBeInTheDocument();
    expect(screen.queryByText(/🍽️ Masala Toastie/i)).not.toBeInTheDocument();

    // Click "ALL"
    fireEvent.click(screen.getByRole('button', { name: 'ALL' }));
    expect(screen.getByText(/🍽️ Masala Toastie/i)).toBeInTheDocument();

    // Search for "Toastie"
    const searchInput = screen.getByRole('textbox', { name: /Search menu dishes/i });
    fireEvent.change(searchInput, { target: { value: 'Toastie' } });
    expect(screen.getByText(/🍽️ Masala Toastie/i)).toBeInTheDocument();
    expect(screen.queryByText(/🍽️ Espresso/i)).not.toBeInTheDocument();

    // Clear search
    const clearBtn = screen.getByRole('button', { name: /Clear search/i });
    fireEvent.click(clearBtn);
    expect(screen.getByText(/🍽️ Espresso/i)).toBeInTheDocument();
    expect(searchInput).toHaveValue('');
  });

  it('shows helpful empty state when search term has no match', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const searchInput = screen.getByRole('textbox', { name: /Search menu dishes/i });
    fireEvent.change(searchInput, { target: { value: 'Nonexistent Pizza' } });

    expect(screen.getByText(/No dishes match “Nonexistent Pizza”/i)).toBeInTheDocument();
  });

  it('adds dish to current order, increments quantity on repeat click without duplicate rows, and supports remove control', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Initial state: 0 items
    expect(screen.getByText('Selected Items (0)')).toBeInTheDocument();

    // Add Espresso
    const addEspressoBtn = screen.getByRole('button', { name: 'Add Espresso to order' });
    fireEvent.click(addEspressoBtn);

    // Should have 1 item in Selected Items
    expect(screen.getByText('Selected Items (1)')).toBeInTheDocument();
    expect(screen.getByText('Espresso')).toBeInTheDocument();
    expect(screen.getByText('1 in order')).toBeInTheDocument();
    expect(screen.getByText('Total Amount:')).toBeInTheDocument();
    expect(screen.getByTestId('manual-order-total-amount')).toHaveTextContent('₹150.00');

    // Click "+ Add Another"
    const addAnotherBtn = screen.getByRole('button', { name: 'Add Espresso to order' });
    fireEvent.click(addAnotherBtn);

    // Still exactly 1 row in Selected Items, but quantity is 2
    expect(screen.getByText('Selected Items (1)')).toBeInTheDocument();
    expect(screen.getByText('2 in order')).toBeInTheDocument();
    expect(screen.getByTestId('manual-order-total-amount')).toHaveTextContent('₹300.00');

    // Use decrement control
    const decBtn = screen.getByRole('button', { name: 'Decrease quantity' });
    fireEvent.click(decBtn);
    expect(screen.getByTestId('manual-order-total-amount')).toHaveTextContent('₹150.00');

    // Use remove control
    const removeBtn = screen.getByRole('button', { name: 'Remove Espresso' });
    fireEvent.click(removeBtn);
    expect(screen.getByText('Selected Items (0)')).toBeInTheDocument();
  });

  it('allows adding and removing custom line items with notes', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Open custom line item form
    const addCustomToggle = screen.getByRole('button', { name: /\+ Add Permitted Custom Line Item/i });
    fireEvent.click(addCustomToggle);

    // Fill in custom item fields
    const nameInput = screen.getByPlaceholderText('Custom Item Name');
    const priceInput = screen.getByPlaceholderText('Price (₹)');
    const noteInput = screen.getByPlaceholderText('Optional Note for custom item');

    fireEvent.change(nameInput, { target: { value: 'Special Masala Chai' } });
    fireEvent.change(priceInput, { target: { value: '60' } });
    fireEvent.change(noteInput, { target: { value: 'Less sugar, ginger' } });

    // Click Add Custom Item
    fireEvent.click(screen.getByRole('button', { name: 'Add Custom Item' }));

    // Verify it is in Selected Items list
    expect(screen.getByText('Special Masala Chai')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('Note: Less sugar, ginger')).toBeInTheDocument();
    expect(screen.getByText(/₹60.00 each/i)).toBeInTheDocument();
  });

  it('submits manual order to /api/staff/orders with safe backend defaults and calls onSuccess', async () => {
    const onSuccess = vi.fn();
    const mockOrderResponse = {
      ok: true,
      order_id: 'ord-new-123',
      order_number: 99,
      total_paise: 15000,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOrderResponse,
    });

    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    );

    // Add Espresso
    fireEvent.click(screen.getByRole('button', { name: 'Add Espresso to order' }));

    // Add optional note
    const noteInput = screen.getByPlaceholderText(/Parcel box \/ Less ice/i);
    fireEvent.change(noteInput, { target: { value: 'Extra hot please' } });

    // Submit order
    const submitBtn = screen.getByRole('button', { name: 'Create Order' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/staff/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceMode: 'dine_in',
          tableId: 'tbl-1',
          customerNote: 'Extra hot please',
          guestCount: 1,
          items: [
            {
              menuItemId: 'item-1',
              quantity: 1,
              unitPricePaise: 15000,
              isCustom: false,
            },
          ],
        }),
      });
    });

    expect(onSuccess).toHaveBeenCalledWith(mockOrderResponse);
  });

  it('ensures discount controls are not displayed during order creation', () => {
    render(
      <ManualOrderModal
        tables={mockTables}
        menuItems={mockMenu}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    expect(screen.queryByText(/Apply bill discount/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Percentage \(%\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fixed Amount/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Discount/i)).not.toBeInTheDocument();
  });
});
