// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MenuPage from '../src/app/menu/[tableToken]/page';

const mockMaybeSingle = vi.fn();
const mockEqQrToken = vi.fn(() => ({
  maybeSingle: mockMaybeSingle,
}));
const mockSelect = vi.fn(() => ({
  eq: mockEqQrToken,
}));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
}));

vi.mock('@/lib/supabase/server', () => ({
  adminDb: () => ({
    from: mockFrom,
  }),
}));

vi.mock('@/lib/menu-catalog', () => ({
  getMenuCatalog: vi.fn(async () => ({
    categories: [{ id: 'coffee', name: 'Coffee' }],
    items: [
      {
        id: 'i-1',
        name: 'Cappuccino',
        description: 'Hot cappuccino',
        price_paise: 18000,
        is_veg: true,
        is_available: true,
        category_id: 'coffee',
        image_url: null,
      },
    ],
  })),
}));

describe('MenuPage Server Component — Table Token Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
  });

  it('renders demo menu for demo-table-1 without querying database', async () => {
    const jsx = await MenuPage({ params: Promise.resolve({ tableToken: 'demo-table-1' }) });
    render(jsx);

    expect(screen.getByText(/Table 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Sandwiches/i)).toBeInTheDocument();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('loads customer menu and catalog items for active table token', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        label: 'Table 1',
        qr_token: '1ea49749-1919-4fcd-b606-0293b512ef7c',
        is_active: true,
      },
      error: null,
    });

    const jsx = await MenuPage({
      params: Promise.resolve({ tableToken: '1ea49749-1919-4fcd-b606-0293b512ef7c' }),
    });
    render(jsx);

    expect(screen.getByText(/Table 1/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Cappuccino/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('₹180.00')).toBeInTheDocument();
  });

  it('rejects an inactive table with explicit inactive message', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        label: 'Table 4',
        qr_token: '221a75ff-d6dd-4840-ac26-64a0d79f5ecd',
        is_active: false,
      },
      error: null,
    });

    const jsx = await MenuPage({
      params: Promise.resolve({ tableToken: '221a75ff-d6dd-4840-ac26-64a0d79f5ecd' }),
    });
    render(jsx);

    expect(screen.getByText('This table is not active')).toBeInTheDocument();
    expect(
      screen.getByText('This table is currently inactive. Please ask a staff member for the current table code.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Cappuccino')).not.toBeInTheDocument();
  });

  it('shows not active message when token is unknown in database', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const jsx = await MenuPage({
      params: Promise.resolve({ tableToken: '00000000-0000-0000-0000-000000000000' }),
    });
    render(jsx);

    expect(screen.getByText('This QR code is not active')).toBeInTheDocument();
    expect(
      screen.getByText('Please ask a staff member for the current table code.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Cappuccino')).not.toBeInTheDocument();
  });

  it('distinguishes malformed UUID tokens (Postgres code 22P02) with invalid format message', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' },
    });

    const jsx = await MenuPage({
      params: Promise.resolve({ tableToken: 'not-a-uuid' }),
    });
    render(jsx);

    expect(screen.getByText('Invalid QR code')).toBeInTheDocument();
    expect(
      screen.getByText('This QR code format is not recognised. Please ask a staff member for the current table code.')
    ).toBeInTheDocument();
  });

  it('distinguishes database connection errors from invalid QR codes', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '57P01', message: 'terminating connection due to administrator command' },
    });

    const jsx = await MenuPage({
      params: Promise.resolve({ tableToken: '1ea49749-1919-4fcd-b606-0293b512ef7c' }),
    });
    render(jsx);

    expect(screen.getByText('Service temporarily unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/Could not verify table status due to a connection error/i)
    ).toBeInTheDocument();
    expect(screen.queryByText('This QR code is not active')).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('handles thrown connection exceptions safely', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockMaybeSingle.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:54321'));

    const jsx = await MenuPage({
      params: Promise.resolve({ tableToken: '1ea49749-1919-4fcd-b606-0293b512ef7c' }),
    });
    render(jsx);

    expect(screen.getByText('Service temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText('This QR code is not active')).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
