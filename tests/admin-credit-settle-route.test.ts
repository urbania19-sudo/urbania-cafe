// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@/lib/owner', () => ({
  owner: vi.fn(),
}));

vi.mock('@/lib/preview-guard', () => ({
  enforcePreviewWriteGuard: vi.fn().mockReturnValue(null),
}));

import { owner } from '@/lib/owner';
import { POST as settlePost } from '@/app/api/admin/credit-orders/settle/route';

describe('Admin Credit Settlement Route Safety & Fail-Closed Suite', () => {
  let mockDb: {
    rpc: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
  };

  const validPayload = {
    orderId: '00000000-0000-4000-8000-000000000001',
    amountPaise: 5000,
    paymentMethod: 'upi',
    notes: 'Partial settlement via UPI',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        single: vi.fn(),
      }),
    };

    (owner as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
  });

  it('1. Returns 503 Service Unavailable when RPC is missing (PGRST202) and performs NO direct database writes', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.settle_admin_credit_payment in the schema cache',
      },
    });

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain('Atomic settlement procedure is unavailable');
    // Critical: No direct fallback write on orders, admin_credit_settlements, or bills
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('2. Returns 503 Service Unavailable when RPC does not exist (code 42883) and performs NO direct database writes', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '42883',
        message: 'function public.settle_admin_credit_payment(uuid, integer, text, text) does not exist',
      },
    });

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain('Atomic settlement procedure is unavailable');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('3. Successfully returns 200 with atomic RPC data and performs NO direct queries', async () => {
    const rpcSuccessData = {
      ok: true,
      settlement_id: 'stl-uuid-1234',
      order_id: validPayload.orderId,
      order_number: 105,
      amount_paise: 5000,
      paid_paise: 5000,
      total_paise: 10000,
      payment_status: 'partially_paid',
      settled_at: new Date().toISOString(),
    };

    mockDb.rpc.mockResolvedValueOnce({
      data: rpcSuccessData,
      error: null,
    });

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.settlement_id).toBe('stl-uuid-1234');
    expect(mockDb.rpc).toHaveBeenCalledWith('settle_admin_credit_payment', {
      p_order_id: validPayload.orderId,
      p_amount_paise: validPayload.amountPaise,
      p_payment_method: validPayload.paymentMethod,
      p_notes: validPayload.notes,
    });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('4. Returns 403 Forbidden when caller lacks admin privileges', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message: 'forbidden: admin privileges required',
      },
    });

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('admin privileges');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('5. Returns 404 Not Found when order is not found', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message: 'order not found',
      },
    });

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(404);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('6. Returns 400 Bad Request when settlement amount exceeds outstanding balance', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message: 'payment amount 20000 exceeds outstanding balance 15000',
      },
    });

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('exceeds outstanding balance');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('7. Returns 400 Bad Request when order is cancelled', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message: 'cannot settle payment for cancelled order',
      },
    });

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('cancelled order');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('8. Returns 400 Bad Request when order is not an admin credit order', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message: 'order 102 is not an admin credit order',
      },
    });

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('not an admin credit order');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('9. Explicitly rejects refund or reversal actions upfront with 400 without touching database', async () => {
    const refundPayload = {
      ...validPayload,
      action: 'refund',
    };

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refundPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Refunds and settlement reversals are not supported');
    expect(mockDb.rpc).not.toHaveBeenCalled();
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('10. Returns 401 Unauthorized when owner() context is null', async () => {
    (owner as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(401);
    expect(mockDb.rpc).not.toHaveBeenCalled();
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('11. Returns 400 for invalid payload (e.g. non-positive amount)', async () => {
    const invalidPayload = {
      ...validPayload,
      amountPaise: 0,
    };

    const req = new NextRequest('http://localhost/api/admin/credit-orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload),
    });

    const res = await settlePost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('greater than zero');
    expect(mockDb.rpc).not.toHaveBeenCalled();
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});
