// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BillDiscountModal from '@/components/staff/BillDiscountModal';
import AdminCreditLedger from '@/components/admin/AdminCreditLedger';

const mockMenuItems = [
  { id: 'item-1', name: 'Classic Cappuccino', price_paise: 18000, is_available: true },
  { id: 'item-2', name: 'Chocolate Brownie', price_paise: 15000, is_available: true },
  { id: 'item-3', name: 'Crispy Fries', price_paise: 16000, is_available: true },
];

const mockAdmins = [
  { user_id: 'adm-1', email: 'owner@urbaniacafe.com', role: 'owner', display_name: 'Rumble Owner' },
  { user_id: 'adm-2', email: 'manager@urbaniacafe.com', role: 'manager', display_name: 'Store Manager' },
];

const VIEWPORTS = [
  { name: 'Standard Android Mobile', width: 360, height: 640 },
  { name: 'Modern iPhone Mobile', width: 390, height: 844 },
  { name: 'Medium / Tablet Viewport', width: 720, height: 1024 },
  { name: 'Desktop Viewport', width: 1280, height: 800 },
];

describe('Mobile Modal Content Clipping & Responsive Architecture Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/credit-orders/admins')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, admins: mockAdmins }),
        });
      }
      if (urlStr.includes('/api/admin/credit-orders')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            orders: [],
            summary: {
              totalOrders: 0,
              overallTotalPaise: 0,
              overallPaidPaise: 0,
              overallOutstandingPaise: 0,
              byAdmin: {},
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true }),
      });
    });
  });

  VIEWPORTS.forEach(({ name, width, height }) => {
    describe(`${name} (${width}x${height})`, () => {
      beforeEach(() => {
        window.innerWidth = width;
        window.innerHeight = height;
        window.dispatchEvent(new Event('resize'));
      });

      // -----------------------------------------------------------------------
      // 1. BillDiscountModal Tests
      // -----------------------------------------------------------------------
      it(`renders BillDiscountModal without content clipping at ${width}px`, () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn().mockResolvedValue(undefined);

        const { container } = render(
          <BillDiscountModal
            orderNumber={13}
            subtotalPaise={18000}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        );

        // A. Dialog Overlay Architecture
        const dialog = screen.getByRole('dialog', { name: /Generate Bill for Order #13/i });
        expect(dialog).toBeInTheDocument();
        expect(dialog.style.position).toBe('fixed');
        expect(dialog.style.display).toBe('flex');
        expect(dialog.style.overflowY).toBe('auto');

        // B. Card Architecture
        const card = container.querySelector('.card') as HTMLElement;
        expect(card).toBeInTheDocument();
        expect(card.style.display).toBe('flex');
        expect(card.style.flexDirection).toBe('column');
        expect(card.style.overflow).toBe('hidden');

        // C. Fixed Header
        const heading = screen.getByRole('heading', { level: 2, name: /Issue Bill · Order #13/i });
        expect(heading).toBeInTheDocument();
        const closeBtn = screen.getByRole('button', { name: /Close dialog/i });
        expect(closeBtn).toBeInTheDocument();

        // D. Scrollable Body Elements
        expect(screen.getByText('Order Amount:')).toBeInTheDocument();
        expect(screen.getAllByText('₹180.00').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByLabelText(/Apply Bill Discount/i)).toBeInTheDocument();
        expect(screen.getByText(/PAYMENT METHOD/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Cash/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Online \/ UPI/i })).toBeInTheDocument();

        // E. Fixed Action Footer
        const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
        expect(cancelBtn).toBeInTheDocument();
        const submitBtn = screen.getByRole('button', { name: /Collect ₹180.00 & Issue Bill/i });
        expect(submitBtn).toBeInTheDocument();
      });

      it(`handles interactive discount calculation and payment toggle at ${width}px`, async () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn().mockResolvedValue(undefined);

        render(
          <BillDiscountModal
            orderNumber={13}
            subtotalPaise={18000}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        );

        // Toggle discount on
        const discountCheckbox = screen.getByLabelText(/Apply Bill Discount/i);
        fireEvent.click(discountCheckbox);

        // Fill discount input
        const discountInput = screen.getByPlaceholderText(/Discount amount in ₹/i);
        fireEvent.change(discountInput, { target: { value: '30' } });

        // Calculation should update
        expect(screen.getByText('Payable Total:')).toBeInTheDocument();
        expect(screen.getAllByText('₹150.00').length).toBeGreaterThanOrEqual(1);

        // Submit button text should update with new total
        const submitBtn = screen.getByRole('button', { name: /Collect ₹150.00 & Issue Bill/i });
        expect(submitBtn).toBeInTheDocument();

        // Switch to UPI payment method
        const upiBtn = screen.getByRole('button', { name: /Online \/ UPI/i });
        fireEvent.click(upiBtn);

        // Click submit
        fireEvent.click(submitBtn);

        await waitFor(() => {
          expect(onConfirm).toHaveBeenCalledTimes(1);
          expect(onConfirm).toHaveBeenCalledWith(
            expect.objectContaining({
              discount: { type: 'fixed', value: 30 },
              paymentMethod: 'upi',
              confirmPayment: true,
              paidAmountRupees: 150,
            })
          );
        });
      });

      // -----------------------------------------------------------------------
      // 2. AdminCreditLedger "New Admin Credit Order" Modal Tests
      // -----------------------------------------------------------------------
      it(`renders New Admin Credit Order dialog without clipping at ${width}px`, async () => {
        render(<AdminCreditLedger menuItems={mockMenuItems} />);

        // Wait for admins to load and open modal
        await waitFor(() => {
          expect(screen.getByText('+ New Admin Order')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('+ New Admin Order'));

        // A. Dialog Overlay Architecture
        const dialog = screen.getByRole('dialog', { name: 'New Admin Credit Order' });
        expect(dialog).toBeInTheDocument();
        expect(dialog.style.position).toBe('fixed');
        expect(dialog.style.display).toBe('flex');
        expect(dialog.style.overflowY).toBe('auto');

        // B. Card Architecture
        const card = dialog.querySelector('.card') as HTMLElement;
        expect(card).toBeInTheDocument();
        expect(card.style.display).toBe('flex');
        expect(card.style.flexDirection).toBe('column');
        expect(card.style.overflow).toBe('hidden');

        // C. Fixed Header
        const heading = within(dialog).getByRole('heading', { level: 3, name: 'New Admin Credit Order' });
        expect(heading).toBeInTheDocument();
        const closeBtn = within(dialog).getByRole('button', { name: /Close dialog/i });
        expect(closeBtn).toBeInTheDocument();

        // D. Form & Body
        const form = dialog.querySelector('form') as HTMLFormElement;
        expect(form).toBeInTheDocument();
        expect(form.style.display).toBe('flex');
        expect(form.style.flexDirection).toBe('column');

        // Administrator select inside dialog
        expect(within(dialog).getByText('Select Administrator')).toBeInTheDocument();
        const select = within(dialog).getByRole('combobox');
        expect(select).toBeInTheDocument();

        // Dish Selector
        expect(within(dialog).getByText('Add Menu Dishes')).toBeInTheDocument();
        expect(within(dialog).getByText('Classic Cappuccino')).toBeInTheDocument();
        expect(within(dialog).getByText('Chocolate Brownie')).toBeInTheDocument();

        // Custom Dish button
        expect(within(dialog).getByText('+ Add Custom Dish / Item')).toBeInTheDocument();

        // Empty cart message initially
        expect(within(dialog).getByText(/No items selected yet/i)).toBeInTheDocument();

        // Footer buttons
        const cancelBtn = within(dialog).getByRole('button', { name: 'Cancel' });
        expect(cancelBtn).toBeInTheDocument();
        const submitBtn = within(dialog).getByRole('button', { name: /Place Credit Order/i });
        expect(submitBtn).toBeInTheDocument();
        expect(submitBtn).toBeDisabled(); // Disabled until dishes selected
      });

      it(`handles dish selection, cart quantity updates, and form dismissal at ${width}px`, async () => {
        render(<AdminCreditLedger menuItems={mockMenuItems} />);

        await waitFor(() => {
          expect(screen.getByText('+ New Admin Order')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('+ New Admin Order'));

        const dialog = screen.getByRole('dialog', { name: 'New Admin Credit Order' });

        // Add Classic Cappuccino to cart
        const capBtn = within(dialog).getByText('Classic Cappuccino');
        fireEvent.click(capBtn);

        // Cart should now show 1 item and total ₹180.00
        expect(within(dialog).getByText('Selected Items (1)')).toBeInTheDocument();
        expect(within(dialog).getByText('Order Total:')).toBeInTheDocument();
        expect(within(dialog).getAllByText('₹180.00').length).toBeGreaterThanOrEqual(1);

        // Place Credit Order button is now enabled
        const submitBtn = within(dialog).getByRole('button', { name: /Place Credit Order \(₹180\.00\)/i });
        expect(submitBtn).not.toBeDisabled();

        // Increment quantity via '+' button
        const plusBtn = within(dialog).getByRole('button', { name: '+', exact: true });
        fireEvent.click(plusBtn);
        expect(within(dialog).getAllByText('₹360.00').length).toBeGreaterThanOrEqual(1);

        // Decrement quantity via '-' button
        const minusBtn = within(dialog).getByRole('button', { name: '-', exact: true });
        fireEvent.click(minusBtn);
        expect(within(dialog).getAllByText('₹180.00').length).toBeGreaterThanOrEqual(1);

        // Close dialog via Close dialog (✕) button
        const closeBtn = within(dialog).getByRole('button', { name: /Close dialog/i });
        fireEvent.click(closeBtn);
        expect(screen.queryByRole('dialog', { name: 'New Admin Credit Order' })).not.toBeInTheDocument();
      });

      // -----------------------------------------------------------------------
      // 3. Escape Key Accessibility Tests
      // -----------------------------------------------------------------------
      it(`closes dialogs when Escape key is pressed at ${width}px`, async () => {
        const onClose = vi.fn();
        const { unmount } = render(
          <BillDiscountModal
            orderNumber={13}
            subtotalPaise={18000}
            onClose={onClose}
            onConfirm={vi.fn()}
          />
        );

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);

        unmount();

        // Test AdminCreditLedger Escape dismissal
        render(<AdminCreditLedger menuItems={mockMenuItems} />);
        await waitFor(() => {
          expect(screen.getByText('+ New Admin Order')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('+ New Admin Order'));
        expect(screen.getByRole('dialog', { name: 'New Admin Credit Order' })).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'New Admin Credit Order' })).not.toBeInTheDocument();
      });
    });
  });
});
