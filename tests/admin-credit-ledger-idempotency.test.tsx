// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminCreditLedger from '@/components/admin/AdminCreditLedger';

const mockMenuItems = [
  {
    id: 'item-101',
    name: 'Espresso Romano',
    price_paise: 15000,
    is_available: true,
  },
  {
    id: 'item-102',
    name: 'Croissant',
    price_paise: 18000,
    is_available: true,
  },
];

const mockAdmins = [
  {
    user_id: 'admin-uuid-1',
    email: 'owner@urbaniacafe.com',
    role: 'owner',
    display_name: 'Lead Owner',
  },
];

describe('AdminCreditLedger Frontend Idempotency Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    // Mock initial fetch calls for admins and orders list
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/credit-orders/admins')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, admins: mockAdmins }),
        });
      }
      if (urlStr.includes('/api/admin/credit-orders') && !urlStr.includes('POST')) {
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
      return Promise.reject(new Error(`Unhandled fetch mock: ${urlStr}`));
    });
  });

  it('generates an idempotency key, preserves it across network retries of the same payload, and generates a new key if payload changes', async () => {
    render(<AdminCreditLedger menuItems={mockMenuItems} />);

    // Wait for admins to load
    await waitFor(() => {
      expect(screen.getByText('+ New Admin Order')).toBeDefined();
    });

    // Open modal
    fireEvent.click(screen.getByText('+ New Admin Order'));
    expect(screen.getByText('New Admin Credit Order')).toBeDefined();

    // Select first menu item (Espresso Romano)
    const itemButtons = screen.getAllByText('Espresso Romano');
    fireEvent.click(itemButtons[0]);

    // Check Place Credit Order button is now active
    const submitBtn = screen.getByRole('button', { name: /Place Credit Order/i });
    expect(submitBtn).toBeDefined();

    // -------------------------------------------------------------------------
    // 1. First submission attempt: Simulate Network Error
    // -------------------------------------------------------------------------
    let capturedKeys: string[] = [];
    (global.fetch as any).mockImplementationOnce((url: string, opts: any) => {
      if (url.includes('/api/admin/credit-orders') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        capturedKeys.push(body.idempotencyKey);
        return Promise.reject(new Error('Network error: connection reset'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedKeys).toHaveLength(1);
    });

    const firstKey = capturedKeys[0];
    expect(firstKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // -------------------------------------------------------------------------
    // 2. Retry exact same payload: Must REUSE the same idempotency key
    // -------------------------------------------------------------------------
    (global.fetch as any).mockImplementationOnce((url: string, opts: any) => {
      if (url.includes('/api/admin/credit-orders') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        capturedKeys.push(body.idempotencyKey);
        return Promise.reject(new Error('Second network failure'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedKeys).toHaveLength(2);
    });

    expect(capturedKeys[1]).toBe(firstKey);

    // -------------------------------------------------------------------------
    // 3. Modify payload (add note): Must generate a NEW idempotency key
    // -------------------------------------------------------------------------
    const noteInput = screen.getByPlaceholderText(/Tasting note or internal memo/i);
    fireEvent.change(noteInput, { target: { value: 'Modified note: Urgent' } });

    (global.fetch as any).mockImplementationOnce((url: string, opts: any) => {
      if (url.includes('/api/admin/credit-orders') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        capturedKeys.push(body.idempotencyKey);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            order_id: 'order-123',
            order_number: 999,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedKeys).toHaveLength(3);
    });

    const modifiedPayloadKey = capturedKeys[2];
    expect(modifiedPayloadKey).not.toBe(firstKey);
    expect(modifiedPayloadKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // -------------------------------------------------------------------------
    // 4. Modal closed upon success. Open new modal for a fresh order.
    // Must receive a fresh idempotency key rather than the old one.
    // -------------------------------------------------------------------------
    await waitFor(() => {
      expect(screen.queryByText('New Admin Credit Order')).toBeNull();
    });

    fireEvent.click(screen.getByText('+ New Admin Order'));
    const itemButtons2 = screen.getAllByText('Croissant');
    fireEvent.click(itemButtons2[0]);

    (global.fetch as any).mockImplementationOnce((url: string, opts: any) => {
      if (url.includes('/api/admin/credit-orders') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        capturedKeys.push(body.idempotencyKey);
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, order_id: 'order-456', order_number: 1000 }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });

    const submitBtn2 = screen.getByRole('button', { name: /Place Credit Order/i });
    fireEvent.click(submitBtn2);

    await waitFor(() => {
      expect(capturedKeys).toHaveLength(4);
    });

    const freshOrderKey = capturedKeys[3];
    expect(freshOrderKey).not.toBe(firstKey);
    expect(freshOrderKey).not.toBe(modifiedPayloadKey);
    expect(freshOrderKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
