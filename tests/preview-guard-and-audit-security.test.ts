import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isPreviewWriteBlocked, enforcePreviewWriteGuard } from '@/lib/preview-guard';
import { POST as createManualOrder } from '@/app/api/staff/orders/route';
import { POST as generateBill } from '@/app/api/staff/orders/[orderId]/bill/route';
import { POST as cancelBill } from '@/app/api/admin/bills/[billId]/cancel/route';
import { POST as reprintBill } from '@/app/api/staff/bills/[billId]/reprint/route';
import { POST as placePublicOrder } from '@/app/api/orders/route';
import { POST as createMenuItem, PATCH as updateMenuItem } from '@/app/api/admin/menu/route';
import { POST as createCategory } from '@/app/api/admin/categories/route';
import { PATCH as updateSettings } from '@/app/api/admin/settings/route';

describe('Preview Write Isolation Guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows writes in normal production mode (VERCEL_ENV=production)', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://rexeyagnvssvjlukjcbd.supabase.co';

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(false);
    expect(enforcePreviewWriteGuard()).toBeNull();
  });

  it('allows writes in local development (VERCEL_ENV is undefined)', () => {
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(false);
    expect(enforcePreviewWriteGuard()).toBeNull();
  });

  it('blocks writes fail-closed in Vercel Preview when database is shared with production', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://rexeyagnvssvjlukjcbd.supabase.co';

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
    expect(result.reason).toContain('Preview deployments sharing the production database are read-only');

    const response = enforcePreviewWriteGuard();
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it('blocks writes in Vercel Preview even if ALLOW_PREVIEW_WRITES=true when pointing to production DB', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ALLOW_PREVIEW_WRITES = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://rexeyagnvssvjlukjcbd.supabase.co';

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
  });

  it('permits writes in Vercel Preview only when explicitly allowed AND using an isolated non-production DB', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ALLOW_PREVIEW_WRITES = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated-db-123.supabase.co';

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(false);
    expect(enforcePreviewWriteGuard()).toBeNull();
  });
});

describe('API Route Preview Write Protection (Direct Invocations)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Simulate shared preview environment
    process.env.VERCEL_ENV = 'preview';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://rexeyagnvssvjlukjcbd.supabase.co';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects POST /api/staff/orders in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/staff/orders', {
      method: 'POST',
      body: JSON.stringify({ items: [{ name: 'Test', quantity: 1, unitPricePaise: 1000, isCustom: true }] }),
    });

    const res = await createManualOrder(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('PREVIEW_READ_ONLY');
  });

  it('rejects POST /api/staff/orders/[orderId]/bill in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/staff/orders/123/bill', { method: 'POST' });
    const res = await generateBill(req, { params: Promise.resolve({ orderId: '00000000-0000-0000-0000-000000000001' }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('PREVIEW_READ_ONLY');
  });

  it('rejects POST /api/admin/bills/[billId]/cancel in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/admin/bills/123/cancel', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Test cancel' }),
    });
    const res = await cancelBill(req, { params: Promise.resolve({ billId: '00000000-0000-0000-0000-000000000001' }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('PREVIEW_READ_ONLY');
  });

  it('rejects POST /api/staff/bills/[billId]/reprint in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/staff/bills/123/reprint', { method: 'POST' });
    const res = await reprintBill(req, { params: Promise.resolve({ billId: '00000000-0000-0000-0000-000000000001' }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('PREVIEW_READ_ONLY');
  });

  it('rejects POST /api/orders in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await placePublicOrder(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('PREVIEW_READ_ONLY');
  });

  it('rejects POST and PATCH /api/admin/menu in preview mode with HTTP 403', async () => {
    const reqPost = new NextRequest('http://localhost/api/admin/menu', { method: 'POST', body: JSON.stringify({}) });
    const resPost = await createMenuItem(reqPost);
    expect(resPost.status).toBe(403);

    const reqPatch = new NextRequest('http://localhost/api/admin/menu', { method: 'PATCH', body: JSON.stringify({}) });
    const resPatch = await updateMenuItem(reqPatch);
    expect(resPatch.status).toBe(403);
  });

  it('rejects POST /api/admin/categories in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/admin/categories', { method: 'POST', body: JSON.stringify({ name: 'Juices' }) });
    const res = await createCategory(req);
    expect(res.status).toBe(403);
  });

  it('rejects PATCH /api/admin/settings in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ cafe_name: 'Test' }) });
    const res = await updateSettings(req);
    expect(res.status).toBe(403);
  });
});
