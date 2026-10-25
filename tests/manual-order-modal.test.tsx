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
  },
  {
    id: 'item-2',
    name: 'Cappuccino',
    price_paise: 22000,
    is_available: true,
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

  it('submits manual order to /api/staff/orders and calls onSuccess', async () => {
    const onSuccess = vi.fn();
    const mockOrderResponse = {
      ok: true,
      order_id: 'ord-new-123',
      order_number: 99,
      total_paise: 22000,
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

    // Add item 1
    fireEvent.click(screen.getByRole('button', { name: '+ Add Item' }));

    // Enter customer details
    const nameInput = screen.getByPlaceholderText(/e.g. Walk-in Guest/i);
    fireEvent.change(nameInput, { target: { value: 'Rohan Sharma' } });

    // Submit order
    const submitBtn = screen.getByRole('button', { name: 'Create Order' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/staff/orders', expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }));
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

    // Verify discount controls do not exist during initial order creation
    expect(screen.queryByText(/Apply bill discount/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Percentage \(%\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fixed Amount/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Discount/i)).not.toBeInTheDocument();
  });
});
