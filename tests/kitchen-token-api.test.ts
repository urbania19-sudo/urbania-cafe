import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/staff/orders/[orderId]/kitchen-token/route';
import { POST } from '@/app/api/staff/orders/[orderId]/kitchen-token/ack/route';
import { NextRequest } from 'next/server';

// Mock authDb
const mockAuthGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/auth-server', () => ({
  authDb: vi.fn(async () => ({
    auth: { getUser: mockAuthGetUser },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock('@/lib/preview-guard', () => ({
  enforcePreviewWriteGuard: vi.fn(() => null),
}));

describe('Kitchen Ticket API Routes', () => {
  const validOrderId = 'a0000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'staff-user-1' } },
    });
  });

  describe('GET /api/staff/orders/[orderId]/kitchen-token', () => {
    it('returns unauthorized when no user session', async () => {
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: null } });
      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/kitchen-token`);
      const res = await GET(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(401);
    });

    it('returns delta with ticketType new when no previous KOT acknowledged', async () => {
      // Mock admin_profiles
      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { role: 'staff' } }),
              }),
            }),
          };
        }
        if (table === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: validOrderId,
                    order_number: 101,
                    status: 'ACCEPTED',
                    customer_name: 'Ananya',
                    order_items: [
                      { menu_item_id: 'item-1', item_name_snapshot: 'Paneer Sandwich', quantity: 1 },
                      { menu_item_id: 'item-2', item_name_snapshot: 'Masala Chai', quantity: 2 },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'order_kitchen_tickets') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/kitchen-token`);
      const res = await GET(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.delta.ticketType).toBe('new');
      expect(json.delta.hasAdditions).toBe(true);
      expect(json.delta.deltaItems).toHaveLength(2);
      expect(json.delta.totalCurrentItemsCount).toBe(3);
    });

    it('returns delta with ticketType addon when items were added to acknowledged order', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { role: 'staff' } }),
              }),
            }),
          };
        }
        if (table === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: validOrderId,
                    order_number: 101,
                    status: 'ACCEPTED',
                    customer_name: 'Ananya',
                    order_items: [
                      { menu_item_id: 'item-1', item_name_snapshot: 'Paneer Sandwich', quantity: 1 },
                      { menu_item_id: 'item-2', item_name_snapshot: 'Masala Chai', quantity: 4 }, // increased +2
                      { menu_item_id: 'item-3', item_name_snapshot: 'French Fries', quantity: 1 }, // new +1
                    ],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'order_kitchen_tickets') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: 'kot-1',
                        ticket_number: 1,
                        ticket_type: 'new',
                        full_order_snapshot: [
                          { menu_item_id: 'item-1', item_name_snapshot: 'Paneer Sandwich', quantity: 1 },
                          { menu_item_id: 'item-2', item_name_snapshot: 'Masala Chai', quantity: 2 },
                        ],
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/kitchen-token`);
      const res = await GET(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.delta.ticketType).toBe('addon');
      expect(json.delta.hasAdditions).toBe(true);
      expect(json.delta.deltaItems).toHaveLength(2); // Masala Chai (+2) and French Fries (+1)
      expect(json.delta.addedItemsCount).toBe(3);
    });
  });

  describe('POST /api/staff/orders/[orderId]/kitchen-token/ack', () => {
    it('records acknowledged ticket snapshot via RPC', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { role: 'staff' } }),
              }),
            }),
          };
        }
        if (table === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: validOrderId,
                    order_items: [
                      { menu_item_id: 'item-1', item_name_snapshot: 'Paneer Sandwich', quantity: 1 },
                      { menu_item_id: 'item-2', item_name_snapshot: 'Masala Chai', quantity: 2 },
                      { menu_item_id: 'item-3', item_name_snapshot: 'French Fries', quantity: 1 },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'order_kitchen_tickets') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: 'b0000000-0000-4000-8000-000000000001',
                        full_order_snapshot: [
                          { menu_item_id: 'item-1', item_name_snapshot: 'Paneer Sandwich', quantity: 1 },
                          { menu_item_id: 'item-2', item_name_snapshot: 'Masala Chai', quantity: 2 },
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      mockRpc.mockResolvedValueOnce({
        data: {
          id: 'kot-ack-1',
          ticket_number: 2,
          ticket_type: 'addon',
        },
        error: null,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/kitchen-token/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ticketType: 'addon',
          itemsSnapshot: [{ menu_item_id: 'item-3', item_name_snapshot: 'French Fries', quantity: 1 }],
          fullOrderSnapshot: [
            { menu_item_id: 'item-1', item_name_snapshot: 'Paneer Sandwich', quantity: 1 },
            { menu_item_id: 'item-2', item_name_snapshot: 'Masala Chai', quantity: 2 },
            { menu_item_id: 'item-3', item_name_snapshot: 'French Fries', quantity: 1 },
          ],
          expectedPreviousTicketId: 'b0000000-0000-4000-8000-000000000001',
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.ticket.ticket_number).toBe(2);
      expect(mockRpc).toHaveBeenCalledWith('acknowledge_kitchen_ticket', expect.objectContaining({
        p_order_id: validOrderId,
        p_ticket_type: 'addon',
        p_expected_previous_ticket_id: 'b0000000-0000-4000-8000-000000000001',
      }));
    });
  });
});
