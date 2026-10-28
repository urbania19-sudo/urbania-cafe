// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@/lib/owner', () => ({
  staffDb: vi.fn(),
  owner: vi.fn(),
}));

vi.mock('@/lib/preview-guard', () => ({
  enforcePreviewWriteGuard: vi.fn().mockReturnValue(null),
}));

import { staffDb, owner } from '@/lib/owner';
import { POST as staffOrdersPost } from '@/app/api/staff/orders/route';
import { POST as adminCreditOrdersPost } from '@/app/api/admin/credit-orders/route';

describe('RPC Fallback Safety & Fail-Closed Regression Suite', () => {
  let mockStaffDb: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };
  let mockOwnerDb: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

  const validPlatformPayload = {
    orderSource: 'swiggy',
    externalPlatformName: 'Swiggy',
    externalPlatformRef: '#SW-9988',
    customerName: 'Swiggy Guest',
    guestCount: 1,
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    items: [
      {
        menuItemId: '00000000-0000-4000-8000-000000000002',
        quantity: 2,
      },
    ],
  };

  const validAdminCreditPayload = {
    adminUserId: '00000000-0000-4000-8000-000000000003',
    customerNote: 'Executive Meeting',
    idempotencyKey: '00000000-0000-4000-8000-000000000004',
    items: [
      {
        menuItemId: '00000000-0000-4000-8000-000000000002',
        quantity: 1,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockStaffDb = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };

    mockOwnerDb = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };

    (staffDb as any).mockResolvedValue(mockStaffDb);
    (owner as any).mockResolvedValue(mockOwnerDb);
  });

  // ===========================================================================
  // 1. Staff Orders Route: External Platform Orders
  // ===========================================================================
  describe('POST /api/staff/orders (External Platform Orders)', () => {
    it('1.1 PGRST202 returns HTTP 503 and NEVER calls direct table insert', async () => {
      mockStaffDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.create_external_platform_order(p_payload) in the schema cache',
        },
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPlatformPayload),
      });

      const res = await staffOrdersPost(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toMatch(/temporarily unavailable/i);

      // Verify direct table inserts were NOT called
      expect(mockStaffDb.from).not.toHaveBeenCalled();
    });

    it('1.2 PostgreSQL 42883 on exact function returns HTTP 503 and NEVER calls direct table insert', async () => {
      mockStaffDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42883',
          message: 'function public.create_external_platform_order(jsonb) does not exist',
        },
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPlatformPayload),
      });

      const res = await staffOrdersPost(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toMatch(/temporarily unavailable/i);

      expect(mockStaffDb.from).not.toHaveBeenCalled();
    });

    it('1.3 PostgreSQL 42883 on an unrelated function fails closed (HTTP 400) without 503 or direct insert', async () => {
      mockStaffDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42883',
          message: 'function public.unrelated_helper() does not exist',
        },
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPlatformPayload),
      });

      const res = await staffOrdersPost(req);
      expect(res.status).toBe(400);
      expect(mockStaffDb.from).not.toHaveBeenCalled();
    });

    it('1.4 "permission denied for function create_external_platform_order" fails closed without direct insert', async () => {
      mockStaffDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42501',
          message: 'permission denied for function create_external_platform_order',
        },
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPlatformPayload),
      });

      const res = await staffOrdersPost(req);
      expect(res.status).toBe(400); // Fails closed with billing/database error, never 201 or 503
      expect(mockStaffDb.from).not.toHaveBeenCalled();
    });

    it('1.5 URB:forbidden authorization exception returns HTTP 403 without direct insert', async () => {
      mockStaffDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: 'P0001',
          message: 'URB:forbidden',
        },
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPlatformPayload),
      });

      const res = await staffOrdersPost(req);
      expect(res.status).toBe(403);
      expect(mockStaffDb.from).not.toHaveBeenCalled();
    });

    it('1.6 Unrelated missing relation error does not trigger missing function or direct insert', async () => {
      mockStaffDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42P01',
          message: 'relation "orders" does not exist',
        },
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPlatformPayload),
      });

      const res = await staffOrdersPost(req);
      expect(res.status).toBe(400);
      expect(mockStaffDb.from).not.toHaveBeenCalled();
    });

    it('1.7 Validation error (e.g. invalid quantity) fails closed with HTTP 400 without direct insert', async () => {
      mockStaffDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: 'P0001',
          message: 'invalid quantity',
        },
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPlatformPayload),
      });

      const res = await staffOrdersPost(req);
      expect(res.status).toBe(400);
      expect(mockStaffDb.from).not.toHaveBeenCalled();
    });

    it('1.8 Successful RPC returns HTTP 201 with RPC data without direct insert', async () => {
      mockStaffDb.rpc.mockResolvedValueOnce({
        data: {
          ok: true,
          order_id: 'ord-test-1111',
          order_number: 105,
          service_mode: 'delivery',
          status: 'ACCEPTED',
          total_paise: 50000,
        },
        error: null,
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPlatformPayload),
      });

      const res = await staffOrdersPost(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.order_id).toBe('ord-test-1111');
      expect(mockStaffDb.from).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 2. Admin Credit Orders Route
  // ===========================================================================
  describe('POST /api/admin/credit-orders', () => {
    it('2.1 PGRST202 returns HTTP 503 and NEVER calls direct table insert', async () => {
      mockOwnerDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.create_admin_credit_order(p_payload) in the schema cache',
        },
      });

      const req = new NextRequest('http://localhost/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validAdminCreditPayload),
      });

      const res = await adminCreditOrdersPost(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toMatch(/temporarily unavailable/i);
      expect(mockOwnerDb.from).not.toHaveBeenCalled();
    });

    it('2.2 PostgreSQL 42883 on exact function returns HTTP 503 and NEVER calls direct table insert', async () => {
      mockOwnerDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42883',
          message: 'function public.create_admin_credit_order(jsonb) does not exist',
        },
      });

      const req = new NextRequest('http://localhost/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validAdminCreditPayload),
      });

      const res = await adminCreditOrdersPost(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toMatch(/temporarily unavailable/i);
      expect(mockOwnerDb.from).not.toHaveBeenCalled();
    });

    it('2.3 PostgreSQL 42883 on an unrelated function fails closed (HTTP 400) without 503 or direct insert', async () => {
      mockOwnerDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42883',
          message: 'function public.unrelated_function() does not exist',
        },
      });

      const req = new NextRequest('http://localhost/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validAdminCreditPayload),
      });

      const res = await adminCreditOrdersPost(req);
      expect(res.status).toBe(400);
      expect(mockOwnerDb.from).not.toHaveBeenCalled();
    });

    it('2.4 "permission denied for function create_admin_credit_order" fails closed without direct insert', async () => {
      mockOwnerDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42501',
          message: 'permission denied for function create_admin_credit_order',
        },
      });

      const req = new NextRequest('http://localhost/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validAdminCreditPayload),
      });

      const res = await adminCreditOrdersPost(req);
      expect(res.status).toBe(400);
      expect(mockOwnerDb.from).not.toHaveBeenCalled();
    });

    it('2.5 "Admin access required" authorization exception returns HTTP 403 without direct insert', async () => {
      mockOwnerDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: 'P0001',
          message: 'Admin access required',
        },
      });

      const req = new NextRequest('http://localhost/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validAdminCreditPayload),
      });

      const res = await adminCreditOrdersPost(req);
      expect(res.status).toBe(403);
      expect(mockOwnerDb.from).not.toHaveBeenCalled();
    });

    it('2.6 Unrelated missing relation does not trigger missing function or direct insert', async () => {
      mockOwnerDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42P01',
          message: 'relation "admin_profiles" does not exist',
        },
      });

      const req = new NextRequest('http://localhost/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validAdminCreditPayload),
      });

      const res = await adminCreditOrdersPost(req);
      expect(res.status).toBe(400);
      expect(mockOwnerDb.from).not.toHaveBeenCalled();
    });

    it('2.7 Validation failure fails closed with HTTP 400 without direct insert', async () => {
      mockOwnerDb.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: 'P0001',
          message: 'Selected user is not an authorized administrator or owner',
        },
      });

      const req = new NextRequest('http://localhost/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validAdminCreditPayload),
      });

      const res = await adminCreditOrdersPost(req);
      expect(res.status).toBe(400);
      expect(mockOwnerDb.from).not.toHaveBeenCalled();
    });

    it('2.8 Successful RPC returns HTTP 201 with RPC data without direct insert', async () => {
      mockOwnerDb.rpc.mockResolvedValueOnce({
        data: {
          ok: true,
          order_id: 'adm-ord-test-2222',
          order_number: 106,
          admin_user_id: '00000000-0000-4000-8000-000000000003',
          payment_status: 'unpaid',
          total_paise: 25000,
          paid_paise: 0,
        },
        error: null,
      });

      const req = new NextRequest('http://localhost/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validAdminCreditPayload),
      });

      const res = await adminCreditOrdersPost(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.order_id).toBe('adm-ord-test-2222');
      expect(mockOwnerDb.from).not.toHaveBeenCalled();
    });
  });
});
