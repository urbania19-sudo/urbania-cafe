import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as cancelBill } from '@/app/api/admin/bills/[billId]/cancel/route';
import { POST as reprintBill } from '@/app/api/staff/bills/[billId]/reprint/route';

// Mock preview guard to allow write operations during these tests
vi.mock('@/lib/preview-guard', () => ({
  enforcePreviewWriteGuard: vi.fn(() => null),
  isPreviewWriteBlocked: vi.fn(() => ({ blocked: false })),
}));

// Mock owner and staffDb
const mockDb = {
  rpc: vi.fn(),
  from: vi.fn(),
};

vi.mock('@/lib/owner', () => ({
  owner: vi.fn(async () => mockDb),
  staffDb: vi.fn(async () => mockDb),
}));

describe('Authoritative Atomic Bill Cancellation (POST /api/admin/bills/[billId]/cancel)', () => {
  const validBillId = '123e4567-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully cancels bill via cancel_bill RPC and returns 200', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: { ok: true, bill_id: validBillId, bill_number: 'UB-01001', status: 'cancelled' },
      error: null,
    });

    const req = new NextRequest(`http://localhost/api/admin/bills/${validBillId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Customer change of mind' }),
    });

    const res = await cancelBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.bill_number).toBe('UB-01001');

    expect(mockDb.rpc).toHaveBeenCalledWith('cancel_bill', {
      p_bill_id: validBillId,
      p_reason: 'Customer change of mind',
    });
    // Crucial: ensure no piecewise table fallbacks are ever used
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects with 403 when RPC indicates unauthorized (URB:forbidden)', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'URB:forbidden', code: 'P0001' },
    });

    const req = new NextRequest(`http://localhost/api/admin/bills/${validBillId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Void test' }),
    });

    const res = await cancelBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Only administrators can cancel bills');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects with 404 when RPC indicates bill not found (URB:not_found)', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'URB:not_found', code: 'P0001' },
    });

    const req = new NextRequest(`http://localhost/api/admin/bills/${validBillId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Void test' }),
    });

    const res = await cancelBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Bill not found');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects with 501 when cancel_bill RPC does not exist (migration pending)', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'function public.cancel_bill does not exist', code: 'PGRST202' },
    });

    const req = new NextRequest(`http://localhost/api/admin/bills/${validBillId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Void test' }),
    });

    const res = await cancelBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain('requires database migration 0009');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects with 400 when bill is already cancelled and does not partially mutate records', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'URB:already_cancelled', code: 'P0001' },
    });

    const req = new NextRequest(`http://localhost/api/admin/bills/${validBillId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Duplicate void' }),
    });

    const res = await cancelBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('This bill has already been cancelled.');
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});

describe('Authoritative Bill Reprint Logging (POST /api/staff/bills/[billId]/reprint)', () => {
  const validBillId = '223e4567-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully records reprint event via record_bill_reprint RPC', async () => {
    const eventId = 'e0000000-0000-0000-0000-000000000099';
    mockDb.rpc.mockResolvedValueOnce({
      data: { ok: true, event_id: eventId, bill_number: 'UB-01002' },
      error: null,
    });

    const req = new NextRequest(`http://localhost/api/staff/bills/${validBillId}/reprint`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Customer requested duplicate' }),
    });

    const res = await reprintBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.event_id).toBe(eventId);
    expect(body.bill_number).toBe('UB-01002');

    expect(mockDb.rpc).toHaveBeenCalledWith('record_bill_reprint', {
      p_bill_id: validBillId,
      p_metadata: { reason: 'Customer requested duplicate' },
    });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('checks returned error and rejects with 403 when user is not staff', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'URB:forbidden', code: 'P0001' },
    });

    const req = new NextRequest(`http://localhost/api/staff/bills/${validBillId}/reprint`, {
      method: 'POST',
    });

    const res = await reprintBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Staff permissions required to record reprint');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('checks returned error and rejects with 404 when bill does not exist', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'URB:not_found', code: 'P0001' },
    });

    const req = new NextRequest(`http://localhost/api/staff/bills/${validBillId}/reprint`, {
      method: 'POST',
    });

    const res = await reprintBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Bill not found');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('checks returned error and rejects with 501 when record_bill_reprint RPC is missing', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'function public.record_bill_reprint does not exist', code: 'PGRST202' },
    });

    const req = new NextRequest(`http://localhost/api/staff/bills/${validBillId}/reprint`, {
      method: 'POST',
    });

    const res = await reprintBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain('requires database migration 0009');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('never returns ok:true when database returns an error', async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection timeout to database', code: '08006' },
    });

    const req = new NextRequest(`http://localhost/api/staff/bills/${validBillId}/reprint`, {
      method: 'POST',
    });

    const res = await reprintBill(req, { params: Promise.resolve({ billId: validBillId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBeUndefined();
    expect(body.error).toBe('connection timeout to database');
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});
