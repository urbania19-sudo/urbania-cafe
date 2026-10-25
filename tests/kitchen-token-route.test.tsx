// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KitchenTokenPrintPage from '../src/app/staff/orders/[orderId]/kitchen-token/print/page';

const mockRedirect = vi.fn();
const mockNotFound = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`REDIRECT: ${url}`);
  },
  notFound: () => {
    mockNotFound();
    throw new Error('NOT_FOUND');
  },
}));

const mockGetUser = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/auth-server', () => ({
  authDb: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}));

describe('KitchenTokenPrintPage Server Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sample kitchen token for orderId="sample" without requiring authentication', async () => {
    const jsx = await KitchenTokenPrintPage({
      params: Promise.resolve({ orderId: 'sample' }),
      searchParams: Promise.resolve({}),
    });

    render(jsx);

    const tokenImg = screen.getByRole('img', { name: /Kitchen Token #101/i });
    expect(tokenImg).toBeInTheDocument();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('triggers notFound() immediately if orderId is not a valid UUID', async () => {
    await expect(
      KitchenTokenPrintPage({
        params: Promise.resolve({ orderId: 'not-a-valid-uuid' }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('redirects unauthenticated users to /staff/login with return URL', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const validOrderId = 'a0000000-0000-4000-8000-000000000001';
    await expect(
      KitchenTokenPrintPage({
        params: Promise.resolve({ orderId: validOrderId }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('REDIRECT: /staff/login?next=/staff/orders/a0000000-0000-4000-8000-000000000001/kitchen-token/print');

    expect(mockRedirect).toHaveBeenCalledWith(
      '/staff/login?next=/staff/orders/a0000000-0000-4000-8000-000000000001/kitchen-token/print'
    );
  });

  it('redirects users without staff/admin profile to /staff/login', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user-no-profile' } } });
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    });

    const validOrderId = 'a0000000-0000-4000-8000-000000000001';
    await expect(
      KitchenTokenPrintPage({
        params: Promise.resolve({ orderId: validOrderId }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('REDIRECT: /staff/login');

    expect(mockRedirect).toHaveBeenCalledWith('/staff/login');
  });

  it('triggers notFound() when the requested order does not exist in the database', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'staff-user-1' } } });
    // Profile exists
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { role: 'staff' } }),
        }),
      }),
    });
    // Order does not exist
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    });

    const validOrderId = 'a0000000-0000-4000-8000-000000000099';
    await expect(
      KitchenTokenPrintPage({
        params: Promise.resolve({ orderId: validOrderId }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('fetches existing order and renders clean KitchenTokenPrintView for authorized staff', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'staff-user-1' } } });
    // Profile exists
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { role: 'staff' } }),
        }),
      }),
    });
    // Order exists
    const mockDbOrder = {
      id: 'a0000000-0000-4000-8000-000000000001',
      order_number: 77,
      status: 'ACCEPTED',
      customer_name: 'Vikram',
      customer_note: 'Extra ginger',
      guest_count: 2,
      total_paise: 24000,
      created_at: '2026-10-25T11:00:00Z',
      billed_at: null,
      service_mode: 'dine_in',
      order_source: 'manual',
      cafe_tables: { label: 'Table 5' },
      order_items: [
        {
          id: 'item-77-1',
          menu_item_id: 'menu-1',
          item_name_snapshot: 'Espresso',
          quantity: 2,
          unit_price_paise: 12000,
          item_note: 'Double shot',
          is_custom: false,
          selected_options_snapshot: [],
        },
      ],
    };
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mockDbOrder, error: null }),
        }),
      }),
    });

    const jsx = await KitchenTokenPrintPage({
      params: Promise.resolve({ orderId: 'a0000000-0000-4000-8000-000000000001' }),
      searchParams: Promise.resolve({}),
    });

    render(jsx);

    const tokenImg = screen.getByRole('img', { name: /Kitchen Token #77/i });
    expect(tokenImg).toBeInTheDocument();
    expect(tokenImg.getAttribute('width')).toBe('384');
  });
});
