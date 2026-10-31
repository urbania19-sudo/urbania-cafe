import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH as updateOrderStatus } from '@/app/api/staff/orders/[orderId]/route';
import { PATCH as editOrderItems } from '@/app/api/staff/orders/[orderId]/items/route';

// Mock dependencies
vi.mock('@/lib/supabase/auth-server', () => ({
  authDb: vi.fn(),
}));

import { authDb } from '@/lib/supabase/auth-server';

describe('Order Status Completion & Edit Items API Routes', () => {
  const originalEnv = process.env;
  const mockOrderId = 'a0000000-0000-4000-8000-000000000001';
  const mockMenuItemId = 'b0000000-0000-4000-8000-000000000002';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Production environment to test operational route logic without preview guard block
    process.env.VERCEL_ENV = 'production';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('PATCH /api/staff/orders/[orderId] (Completed Button Workflow)', () => {
    it('rejects unauthorized requests with HTTP 401 when staff is not logged in', async () => {
      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('No session') }),
        },
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('returns HTTP 400 when attempting to complete a NEW order without accepting first', async () => {
      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'NEW', order_number: 101 },
                error: null,
              }),
            }),
          }),
        }),
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('must be accepted before it can be marked completed');
    });

    it('returns HTTP 400 when attempting to complete a CANCELLED order', async () => {
      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'CANCELLED', order_number: 102 },
                error: null,
              }),
            }),
          }),
        }),
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Cannot complete Order #102 because it has been cancelled');
    });

    it('is idempotent: returns ok when order is already COMPLETED', async () => {
      const mockRpc = vi.fn();
      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'COMPLETED', order_number: 103 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe('COMPLETED');
      // No database RPC needed when already completed
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('executes direct ACCEPTED -> COMPLETED transition when supported by database RPC', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: { id: mockOrderId, status: 'COMPLETED' }, error: null });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'ACCEPTED', order_number: 104 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe('COMPLETED');
      expect(mockRpc).toHaveBeenCalledWith('update_staff_order_status', {
        p_order_id: mockOrderId,
        p_next: 'COMPLETED',
      });
    });

    it('bridges legacy intermediate states (ACCEPTED -> PREPARING -> READY -> COMPLETED) if DB requires it', async () => {
      const mockRpc = vi
        .fn()
        // 1. Direct transition fails with invalid transition
        .mockResolvedValueOnce({ data: null, error: { message: 'invalid transition' } })
        // 2. Step 1: PREPARING succeeds
        .mockResolvedValueOnce({ data: { status: 'PREPARING' }, error: null })
        // 3. Step 2: READY succeeds
        .mockResolvedValueOnce({ data: { status: 'READY' }, error: null })
        // 4. Step 3: COMPLETED succeeds
        .mockResolvedValueOnce({ data: { status: 'COMPLETED' }, error: null });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'ACCEPTED', order_number: 105 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe('COMPLETED');

      expect(mockRpc).toHaveBeenCalledTimes(4);
      expect(mockRpc).toHaveBeenNthCalledWith(1, 'update_staff_order_status', { p_order_id: mockOrderId, p_next: 'COMPLETED' });
      expect(mockRpc).toHaveBeenNthCalledWith(2, 'update_staff_order_status', { p_order_id: mockOrderId, p_next: 'PREPARING' });
      expect(mockRpc).toHaveBeenNthCalledWith(3, 'update_staff_order_status', { p_order_id: mockOrderId, p_next: 'READY' });
      expect(mockRpc).toHaveBeenNthCalledWith(4, 'update_staff_order_status', { p_order_id: mockOrderId, p_next: 'COMPLETED' });
    });

    it('halts and returns error if intermediate bridge step fails without completing', async () => {
      const mockRpc = vi
        .fn()
        // 1. Direct transition fails with invalid transition
        .mockResolvedValueOnce({ data: null, error: { message: 'invalid transition' } })
        // 2. Step 1: PREPARING fails
        .mockResolvedValueOnce({ data: null, error: { message: 'Order lock conflict' } });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'ACCEPTED', order_number: 106 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Failed to transition order to Preparing: Order lock conflict');
      // Must NOT continue to READY or COMPLETED after failure
      expect(mockRpc).toHaveBeenCalledTimes(2);
    });

    it('halts and returns error if step 2 (READY) fails during legacy bridge, confirming step 3 is NOT called', async () => {
      const mockRpc = vi
        .fn()
        // 1. Direct transition fails with invalid transition
        .mockResolvedValueOnce({ data: null, error: { message: 'invalid transition' } })
        // 2. Step 1: PREPARING succeeds
        .mockResolvedValueOnce({ data: { status: 'PREPARING' }, error: null })
        // 3. Step 2: READY fails
        .mockResolvedValueOnce({ data: null, error: { message: 'Kitchen queue full' } });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'ACCEPTED', order_number: 107 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Failed to transition order to Ready: Kitchen queue full');
      // Exactly 3 calls: direct attempt, PREPARING, READY. Must NOT call step 3 (COMPLETED).
      expect(mockRpc).toHaveBeenCalledTimes(3);
    });

    it('halts and returns error if step 3 (COMPLETED) fails during legacy bridge', async () => {
      const mockRpc = vi
        .fn()
        // 1. Direct transition fails with invalid transition
        .mockResolvedValueOnce({ data: null, error: { message: 'invalid transition' } })
        // 2. Step 1: PREPARING succeeds
        .mockResolvedValueOnce({ data: { status: 'PREPARING' }, error: null })
        // 3. Step 2: READY succeeds
        .mockResolvedValueOnce({ data: { status: 'READY' }, error: null })
        // 4. Step 3: COMPLETED fails
        .mockResolvedValueOnce({ data: null, error: { message: 'Database serialization error' } });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'ACCEPTED', order_number: 108 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Failed to complete order: Database serialization error');
      expect(mockRpc).toHaveBeenCalledTimes(4);
    });

    it('does NOT attempt legacy bridge when direct transition fails due to authorization error (returns HTTP 403)', async () => {
      const mockRpc = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { message: 'Unauthorized: staff or admin permissions required' } });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'unauthorized-user' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'ACCEPTED', order_number: 109 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized: staff or admin permissions required');
      // Crucial: Must NOT attempt any legacy bridging on permission failures!
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });

    it('does NOT attempt legacy bridge when direct transition fails due to unrelated DB error (e.g. lock conflict)', async () => {
      const mockRpc = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { message: 'deadlock detected on relation orders' } });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: mockOrderId, status: 'ACCEPTED', order_number: 110 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('deadlock detected on relation orders');
      // Unrelated errors must NOT trigger legacy bridging
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /api/staff/orders/[orderId]/items (Edit Items Button Workflow)', () => {
    it('rejects unauthorized requests with HTTP 401 when staff is not logged in', async () => {
      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('No session') }),
        },
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: [{ menuItemId: mockMenuItemId, quantity: 2 }] }),
      });

      const res = await editOrderItems(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('rejects invalid payloads with quantity < 1 or > 20 with HTTP 400', async () => {
      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: [{ menuItemId: mockMenuItemId, quantity: 0 }] }),
      });

      const res = await editOrderItems(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid request');
    });

    it('calls edit_order_items RPC and returns ok:true on successful edit', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: { id: mockOrderId, total_paise: 50000 }, error: null });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: [{ menuItemId: mockMenuItemId, quantity: 2 }] }),
      });

      const res = await editOrderItems(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('edit_order_items', {
        p_order_id: mockOrderId,
        p_items: [{ menuItemId: mockMenuItemId, quantity: 2 }],
      });
    });

    it('accepts custom dishes with isCustom=true, name, price, quantity, and notes', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: { id: mockOrderId, total_paise: 35000 }, error: null });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        rpc: mockRpc,
      });

      const customItemsPayload = [
        { menuItemId: mockMenuItemId, quantity: 1 },
        { isCustom: true, name: 'Special Masala Chai', unitPriceRupees: 40, quantity: 2, note: 'Extra ginger' },
      ];

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: customItemsPayload }),
      });

      const res = await editOrderItems(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('edit_order_items', {
        p_order_id: mockOrderId,
        p_items: [
          { menuItemId: mockMenuItemId, quantity: 1 },
          { isCustom: true, name: 'Special Masala Chai', unitPricePaise: 4000, quantity: 2, note: 'Extra ginger' },
        ],
      });
    });

    it('rejects custom dishes with empty name or negative price with HTTP 400', async () => {
      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
      });

      // 1. Empty dish name
      const reqEmptyName = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: [{ isCustom: true, name: '   ', unitPriceRupees: 50, quantity: 1 }] }),
      });
      const res1 = await editOrderItems(reqEmptyName, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res1.status).toBe(400);

      // 2. Negative unit price
      const reqNegPrice = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: [{ isCustom: true, name: 'Toast', unitPriceRupees: -10, quantity: 1 }] }),
      });
      const res2 = await editOrderItems(reqNegPrice, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res2.status).toBe(400);
    });

    it('surfaces backend error when order is already billed or completed', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Order has already been billed and cannot be edited' },
      });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: [{ menuItemId: mockMenuItemId, quantity: 1 }] }),
      });

      const res = await editOrderItems(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('already been billed and cannot be edited');
    });

    it('returns informative HTTP 503 error when database function edit_order_items is missing', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'function public.edit_order_items(uuid, jsonb) does not exist' },
      });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-user-1' } }, error: null }),
        },
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: [{ menuItemId: mockMenuItemId, quantity: 2 }] }),
      });

      const res = await editOrderItems(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toContain('database function pending migration');
    });

    it('is blocked by fail-closed Preview guard when VERCEL_ENV=preview', async () => {
      process.env.VERCEL_ENV = 'preview';

      const req = new NextRequest(`http://localhost/api/staff/orders/${mockOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items: [{ menuItemId: mockMenuItemId, quantity: 2 }] }),
      });

      const res = await editOrderItems(req, { params: Promise.resolve({ orderId: mockOrderId }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe('PREVIEW_READ_ONLY');
    });
  });
});
