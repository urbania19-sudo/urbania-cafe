// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextRequest } from 'next/server';
import ReportsManager from '@/components/admin/ReportsManager';

// Mock dependencies
vi.mock('@/lib/owner', () => ({
  owner: vi.fn(),
  staffDb: vi.fn(),
}));

vi.mock('@/lib/reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports')>();
  return {
    ...actual,
    getDailyServiceMetrics: vi.fn().mockResolvedValue({
      netSalesPaise: 50000,
      completedOrderCount: 5,
      grossSalesPaise: 50000,
      discountsPaise: 0,
      collectedPaise: 50000,
      cashCollectedPaise: 30000,
      onlineCollectedPaise: 20000,
      customerCollectedPaise: 50000,
      customerOutstandingPaise: 0,
      customerRefundsPaise: 0,
      historicalRefundClassifiedPaise: 0,
      adminCreditSettledTodayPaise: 0,
      externalPlatformCount: 0,
      externalPlatformValuePaise: 0,
      adminCreditCount: 0,
      adminCreditTotalPaise: 0,
      adminCreditOutstandingPaise: 0,
    }),
  };
});

import { owner } from '@/lib/owner';
import { GET as getBillsReport } from '@/app/api/admin/reports/bills/route';

describe('Audit & Reports Usability & Search Regression Suite', () => {
  const mockBills = [
    {
      id: 'bill-1',
      bill_number: 'UB-01001',
      order_number: 123,
      customer_name: 'Priya Sharma',
      total_paise: 35000,
      status: 'issued',
      order_source: 'qr',
      service_mode: 'dine_in',
      issued_at: '2026-10-29T10:00:00.000Z',
      orders: {
        customer_name: 'Priya Sharma',
        guest_count: 2,
        service_mode: 'dine_in',
        order_source: 'qr',
      },
    },
    {
      id: 'bill-2',
      bill_number: 'UB-01002',
      order_number: 12,
      customer_name: 'Anand Kumar',
      total_paise: 15000,
      status: 'issued',
      order_source: 'manual',
      service_mode: 'takeaway',
      issued_at: '2026-10-29T11:00:00.000Z',
      orders: {
        customer_name: 'Anand Kumar',
        guest_count: 1,
        service_mode: 'takeaway',
        order_source: 'manual',
      },
    },
    {
      id: 'bill-3',
      bill_number: 'UB-01003',
      order_number: 456,
      customer_name: 'Rohit Verma',
      total_paise: 22000,
      status: 'cancelled',
      order_source: 'manual',
      service_mode: 'dine_in',
      issued_at: '2026-10-29T12:00:00.000Z',
      orders: {
        customer_name: 'Rohit Verma',
        guest_count: 3,
        service_mode: 'dine_in',
        order_source: 'manual',
      },
    },
  ];

  let capturedQueries: { orFilter?: string }[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    capturedQueries = [];

    // Mock authorized administrator database client
    (owner as any).mockResolvedValue({
      from: (table: string) => {
        if (table === 'bills') {
          const queryBuilder: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            or: vi.fn(function (filter: string) {
              capturedQueries.push({ orFilter: filter });
              return queryBuilder;
            }),
            range: vi.fn(async () => {
              // Extract orFilter
              const lastOr = capturedQueries[capturedQueries.length - 1]?.orFilter;
              let filtered = [...mockBills];

              if (lastOr) {
                // Check if searching for exact order number
                const exactOrderMatch = /order_number\.eq\.(\d+)/.exec(lastOr);
                const billIlikeMatch = /bill_number\.ilike\.%([^%]+)%/.exec(lastOr);
                const nameIlikeMatch = /customer_name\.ilike\.%([^%]+)%/.exec(lastOr);

                filtered = filtered.filter((b) => {
                  let matches = false;
                  if (exactOrderMatch && b.order_number === parseInt(exactOrderMatch[1], 10)) {
                    matches = true;
                  }
                  if (billIlikeMatch && b.bill_number.toLowerCase().includes(billIlikeMatch[1].toLowerCase())) {
                    matches = true;
                  }
                  if (nameIlikeMatch && b.customer_name?.toLowerCase().includes(nameIlikeMatch[1].toLowerCase())) {
                    matches = true;
                  }
                  return matches;
                });
              }

              return {
                data: filtered,
                count: filtered.length,
                error: null,
              };
            }),
          };
          return queryBuilder;
        }

        if (table === 'orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col: string, val: any) => ({
              maybeSingle: vi.fn(async () => {
                // Simulate order 789 exists in orders table but has NO bill
                if (col === 'order_number' && val === 789) {
                  return {
                    data: {
                      id: 'ord-unbilled-789',
                      order_number: 789,
                      status: 'ACCEPTED',
                      customer_name: 'Walk-in Guest',
                      created_at: '2026-10-29T09:30:00.000Z',
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              }),
            })),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      },
    });
  });

  describe('API Route: GET /api/admin/reports/bills Search Functionality', () => {
    it('1. Searches by plain numeric order number "123" with exact matching', async () => {
      const req = new NextRequest('http://localhost/api/admin/reports/bills?search=123');
      const res = await getBillsReport(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.bills).toHaveLength(1);
      expect(json.bills[0].order_number).toBe(123);
      expect(json.bills[0].bill_number).toBe('UB-01001');

      // Verify exact equality filter was generated for order_number
      const lastOr = capturedQueries[capturedQueries.length - 1]?.orFilter;
      expect(lastOr).toContain('order_number.eq.123');
    });

    it('2. Searches by "Order #123" with casing and hash prefix', async () => {
      const req = new NextRequest('http://localhost/api/admin/reports/bills?search=Order%20%23123');
      const res = await getBillsReport(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.bills).toHaveLength(1);
      expect(json.bills[0].order_number).toBe(123);

      const lastOr = capturedQueries[capturedQueries.length - 1]?.orFilter;
      expect(lastOr).toContain('order_number.eq.123');
    });

    it('3. Searches by "#123" with optional hash prefix', async () => {
      const req = new NextRequest('http://localhost/api/admin/reports/bills?search=%23123');
      const res = await getBillsReport(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.bills).toHaveLength(1);
      expect(json.bills[0].order_number).toBe(123);

      const lastOr = capturedQueries[capturedQueries.length - 1]?.orFilter;
      expect(lastOr).toContain('order_number.eq.123');
    });

    it('4. Searches by bill number "UB-01002" preserving secondary bill search', async () => {
      const req = new NextRequest('http://localhost/api/admin/reports/bills?search=UB-01002');
      const res = await getBillsReport(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.bills).toHaveLength(1);
      expect(json.bills[0].bill_number).toBe('UB-01002');
      expect(json.bills[0].order_number).toBe(12);
    });

    it('5. Searches by customer name "Rohit Verma" preserving secondary customer name search', async () => {
      const req = new NextRequest('http://localhost/api/admin/reports/bills?search=Rohit%20Verma');
      const res = await getBillsReport(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.bills).toHaveLength(1);
      expect(json.bills[0].customer_name).toBe('Rohit Verma');
      expect(json.bills[0].bill_number).toBe('UB-01003');
    });

    it('6. Ensures exact numeric order-number matching: searching 123 NEVER matches order 12', async () => {
      // Searching for 123
      const req123 = new NextRequest('http://localhost/api/admin/reports/bills?search=123');
      const res123 = await getBillsReport(req123);
      const json123 = await res123.json();

      expect(json123.bills).toHaveLength(1);
      expect(json123.bills[0].order_number).toBe(123);
      // Ensure order 12 is NOT in the result
      expect(json123.bills.some((b: any) => b.order_number === 12)).toBe(false);

      // Searching for 12
      const req12 = new NextRequest('http://localhost/api/admin/reports/bills?search=12');
      const res12 = await getBillsReport(req12);
      const json12 = await res12.json();

      expect(json12.bills).toHaveLength(1);
      expect(json12.bills[0].order_number).toBe(12);
      // Ensure order 123 is NOT in the result
      expect(json12.bills.some((b: any) => b.order_number === 123)).toBe(false);
    });

    it('7. Detects active unbilled order (order with no matching bill) and returns unbilledOrder object', async () => {
      // Order 789 exists in orders table, but has NO bill in bills table
      const req = new NextRequest('http://localhost/api/admin/reports/bills?search=Order%20%23789');
      const res = await getBillsReport(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.bills).toHaveLength(0);
      expect(json.unbilledOrder).toBeDefined();
      expect(json.unbilledOrder?.orderNumber).toBe(789);
      expect(json.unbilledOrder?.status).toBe('ACCEPTED');
      expect(json.searchedOrderNumber).toBe(789);
    });

    it('8. Returns searchedOrderNumber when order number has no bill and no active order', async () => {
      // Order 999 does not exist anywhere
      const req = new NextRequest('http://localhost/api/admin/reports/bills?search=%23999');
      const res = await getBillsReport(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.bills).toHaveLength(0);
      expect(json.unbilledOrder).toBeNull();
      expect(json.searchedOrderNumber).toBe(999);
    });

    it('9. Strictly enforces administrator authentication (fails closed with 401 for unauthorized callers)', async () => {
      (owner as any).mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost/api/admin/reports/bills?search=123');
      const res = await getBillsReport(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });
  });

  describe('UI Component: ReportsManager Search Usability & Empty States', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);

        if (urlStr.includes('search=123') || urlStr.includes('search=Order+%23123')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              bills: [mockBills[0]],
              totalCount: 1,
              summary: {
                totalCount: 1,
                issuedCount: 1,
                cancelledCount: 0,
                totalSalesPaise: 35000,
                totalTaxPaise: 1750,
                todaySalesPaise: 35000,
                todayBillCount: 1,
              },
            }),
          });
        }

        if (urlStr.includes('search=789')) {
          // Unbilled order in active queue
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              bills: [],
              totalCount: 0,
              unbilledOrder: {
                id: 'ord-unbilled-789',
                orderNumber: 789,
                status: 'ACCEPTED',
              },
              searchedOrderNumber: 789,
              summary: null,
            }),
          });
        }

        if (urlStr.includes('search=999')) {
          // Non-existent bill for order 999
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              bills: [],
              totalCount: 0,
              unbilledOrder: null,
              searchedOrderNumber: 999,
              summary: null,
            }),
          });
        }

        // Default initial load
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            bills: mockBills,
            totalCount: 3,
            summary: {
              totalCount: 3,
              issuedCount: 2,
              cancelledCount: 1,
              totalSalesPaise: 50000,
              totalTaxPaise: 2500,
              todaySalesPaise: 50000,
              todayBillCount: 2,
            },
          }),
        });
      });
    });

    it('renders "Search by Order Number" as the primary, clearly labelled search option with help text', async () => {
      render(<ReportsManager />);

      // Verify primary label
      const label = screen.getByText('Search by Order Number');
      expect(label).toBeInTheDocument();
      expect(label.style.fontWeight).toBe('700');

      // Verify placeholder
      const searchInput = screen.getByPlaceholderText(/e\.g\. 123 or Order #123/i);
      expect(searchInput).toBeInTheDocument();

      // Verify help text explicitly warning about displayed order number vs internal UUID
      expect(
        screen.getByText(/Enter displayed order number \(e\.g\. 123 or Order #123\), bill number, or customer name — not internal UUID\./i)
      ).toBeInTheDocument();
    });

    it('displays helpful empty state explaining unbilled active order instead of silently saying not found', async () => {
      render(<ReportsManager />);

      const searchInput = screen.getByPlaceholderText(/e\.g\. 123 or Order #123/i);
      fireEvent.change(searchInput, { target: { value: '789' } });

      await waitFor(() => {
        // Must explain that order exists but has no bill generated yet
        expect(screen.getByText('Order #789 has no bill generated yet')).toBeInTheDocument();
        expect(
          screen.getByText(/Order #789 exists in the active service queue/i)
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Audit & Reports lists only finalized billing records/i)
        ).toBeInTheDocument();
        // Provides link to open staff queue to bill order
        expect(screen.getByRole('link', { name: /Open Staff Queue to Bill Order →/i })).toBeInTheDocument();
      });
    });

    it('displays helpful empty state when order number has no bill and no active order', async () => {
      render(<ReportsManager />);

      const searchInput = screen.getByPlaceholderText(/e\.g\. 123 or Order #123/i);
      fireEvent.change(searchInput, { target: { value: '999' } });

      await waitFor(() => {
        expect(screen.getByText('No billed records found for Order #999')).toBeInTheDocument();
        expect(
          screen.getByText(/Audit & Reports lists finalized billing records\. If Order #999 is currently in service or awaiting payment, it will appear in the Staff Queue\./i)
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Check Staff Queue →/i })).toBeInTheDocument();
      });
    });

    it('clears search input via clear button and resets view', async () => {
      render(<ReportsManager />);

      const searchInput = screen.getByPlaceholderText(/e\.g\. 123 or Order #123/i);
      fireEvent.change(searchInput, { target: { value: '123' } });

      await waitFor(() => {
        expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText('Clear search'));
      expect(searchInput).toHaveValue('');
    });
  });
});
