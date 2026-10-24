import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  isPreviewWriteBlocked,
  enforcePreviewWriteGuard,
  KNOWN_PRODUCTION_PROJECT_REF,
} from '@/lib/preview-guard';

vi.mock('@/lib/supabase/auth-server', () => ({
  authDb: vi.fn(),
}));

import { authDb } from '@/lib/supabase/auth-server';
import { POST as createManualOrder } from '@/app/api/staff/orders/route';
import { POST as generateBill } from '@/app/api/staff/orders/[orderId]/bill/route';
import { POST as cancelBill } from '@/app/api/admin/bills/[billId]/cancel/route';
import { POST as reprintBill } from '@/app/api/staff/bills/[billId]/reprint/route';
import { POST as placePublicOrder } from '@/app/api/orders/route';
import { POST as createMenuItem, PATCH as updateMenuItem } from '@/app/api/admin/menu/route';
import { POST as createCategory } from '@/app/api/admin/categories/route';
import { PATCH as updateSettings } from '@/app/api/admin/settings/route';

describe('Preview Write Isolation Guard — 13 Core Safety Policy Cases', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    (authDb as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // 1. Production writes remain permitted under the existing production policy
  it('Case 1: Production writes remain permitted under the existing production policy (VERCEL_ENV=production)', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(false);
    expect(enforcePreviewWriteGuard()).toBeNull();
  });

  // 2. Local development retains existing behavior
  it('Case 2: Local development retains existing behavior (VERCEL_ENV is undefined)', () => {
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(false);
    expect(enforcePreviewWriteGuard()).toBeNull();
  });

  // 3. Preview writes are blocked by default
  it('Case 3: Preview writes are blocked by default in Vercel Preview (fail-closed policy)', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
    expect(result.reason).toContain('Preview deployments sharing the production database are read-only');

    const response = enforcePreviewWriteGuard();
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  // 4. Preview writes remain blocked when ISOLATED_STAGING_DB is missing or false
  it('Case 4: Preview writes remain blocked when ISOLATED_STAGING_DB is missing or false', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ALLOW_PREVIEW_WRITES = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated-ref123.supabase.co';

    // 4a. Missing ISOLATED_STAGING_DB
    delete process.env.ISOLATED_STAGING_DB;
    delete process.env.STAGING_DATABASE;
    let result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 4b. Explicitly false ISOLATED_STAGING_DB
    process.env.ISOLATED_STAGING_DB = 'false';
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
  });

  // 5. Preview writes remain blocked when ALLOW_PREVIEW_WRITES is missing or false
  it('Case 5: Preview writes remain blocked when ALLOW_PREVIEW_WRITES is missing or false', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated-ref123.supabase.co';

    // 5a. Missing ALLOW_PREVIEW_WRITES
    delete process.env.ALLOW_PREVIEW_WRITES;
    let result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 5b. Explicitly false ALLOW_PREVIEW_WRITES
    process.env.ALLOW_PREVIEW_WRITES = 'false';
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
  });

  // 6. BLOCK_PREVIEW_WRITES=true always blocks Preview writes
  it('Case 6: BLOCK_PREVIEW_WRITES=true always blocks Preview writes regardless of other flags', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.ALLOW_PREVIEW_WRITES = 'true';
    process.env.BLOCK_PREVIEW_WRITES = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated-ref123.supabase.co';

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
  });

  // 7. A connection URL containing the known production project reference is blocked
  it('Case 7: A connection URL containing the known production project reference is blocked', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.ALLOW_PREVIEW_WRITES = 'true';

    // 7a. Standard production Supabase URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;
    let result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 7b. Embedded in custom domain path or proxy query
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://custom-proxy.urbania.cafe/${KNOWN_PRODUCTION_PROJECT_REF}`;
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
  });

  // 8. Alternative server-side or database connection variables pointing to production are detected
  it('Case 8: Alternative server-side or database connection variables pointing to production are detected', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.ALLOW_PREVIEW_WRITES = 'true';
    // Public URL looks like staging, but internal/server variables target production
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated-ref123.supabase.co';

    // 8a. SUPABASE_INTERNAL_URL targets production
    process.env.SUPABASE_INTERNAL_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;
    let result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 8b. POSTGRES_URL targets production
    process.env.SUPABASE_INTERNAL_URL = 'https://staging-isolated-ref123.supabase.co';
    process.env.POSTGRES_URL = `postgresql://postgres:secret@db.${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 8c. DATABASE_URL targets production pooler
    delete process.env.POSTGRES_URL;
    process.env.DATABASE_URL = `postgresql://postgres.${KNOWN_PRODUCTION_PROJECT_REF}:secret@aws-0.pooler.supabase.com:6543/postgres`;
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 8d. SUPABASE_URL targets production
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
  });

  // 9. A configured production comparison URL matching the staging candidate causes writes to be blocked
  it('Case 9: A configured production comparison URL matching the staging candidate causes writes to be blocked', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.ALLOW_PREVIEW_WRITES = 'true';

    // 9a. Matches explicit PRODUCTION_SUPABASE_URL
    process.env.PRODUCTION_SUPABASE_URL = 'https://custom-prod-cafe.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://custom-prod-cafe.supabase.co';
    let result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 9b. Matches explicit PRODUCTION_DATABASE_URL
    delete process.env.PRODUCTION_SUPABASE_URL;
    process.env.PRODUCTION_DATABASE_URL = 'postgresql://postgres:secret@db.custom-prod-cafe.supabase.co:5432/postgres';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://custom-prod-cafe.supabase.co';
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
  });

  // 10. Missing or unrecognized database targets do not accidentally permit writes
  it('Case 10: Missing or unrecognized database targets do not accidentally permit writes', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.ALLOW_PREVIEW_WRITES = 'true';

    // 10a. Missing database targets (all connection URLs empty/undefined)
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_INTERNAL_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;

    let result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 10b. Unrecognized or malformed database targets
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'not-a-valid-database-url';
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');

    // 10c. Inconsistent database targets configured across connection variables
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-project-alpha.supabase.co';
    process.env.SUPABASE_INTERNAL_URL = 'https://staging-project-beta.supabase.co';
    result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('PREVIEW_READ_ONLY');
  });

  // 11. A verified isolated staging configuration permits Preview writes only when every safety condition passes
  it('Case 11: A verified isolated staging configuration permits Preview writes only when every safety condition passes', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.ALLOW_PREVIEW_WRITES = 'true';
    delete process.env.BLOCK_PREVIEW_WRITES;
    process.env.PRODUCTION_SUPABASE_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated-ref123.supabase.co';
    process.env.SUPABASE_INTERNAL_URL = 'https://staging-isolated-ref123.supabase.co';

    const result = isPreviewWriteBlocked();
    expect(result.blocked).toBe(false);
    expect(enforcePreviewWriteGuard()).toBeNull();
  });

  // 12. Unauthorized users cannot generate bills even when Preview writes are enabled
  it('Case 12: Unauthorized users cannot generate bills even when Preview writes are enabled', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.ALLOW_PREVIEW_WRITES = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated-ref123.supabase.co';

    // Mock unauthenticated state
    (authDb as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('No active session') }),
      },
    });

    // Write guard permits execution...
    expect(enforcePreviewWriteGuard()).toBeNull();

    // ...but the endpoint still enforces user authentication and returns 401 Unauthorized
    const validOrderId = 'a0000000-0000-4000-8000-000000000001';
    const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/bill`, {
      method: 'POST',
    });
    const res = await generateBill(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  // 13. The guard does not bypass the existing database authorization or order-state checks
  it('Case 13: The guard does not bypass the existing database authorization or order-state checks', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ISOLATED_STAGING_DB = 'true';
    process.env.ALLOW_PREVIEW_WRITES = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated-ref123.supabase.co';

    const validOrderId = 'a0000000-0000-4000-8000-000000000001';

    // Mock an authenticated staff user
    (authDb as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-uuid' } } }),
      },
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Order is not in a billable state (status: CANCELLED)' },
      }),
    });

    // Write guard permits execution...
    expect(enforcePreviewWriteGuard()).toBeNull();

    // 13a. Input validation check: Invalid order ID format must be rejected with 400 Bad Request
    const reqInvalid = new NextRequest('http://localhost/api/staff/orders/invalid-uuid/bill', {
      method: 'POST',
    });
    const resInvalid = await generateBill(reqInvalid, {
      params: Promise.resolve({ orderId: 'invalid-uuid' }),
    });
    expect(resInvalid.status).toBe(400);
    const bodyInvalid = await resInvalid.json();
    expect(bodyInvalid.error).toBe('Invalid order ID');

    // 13b. Database state check: If order is cancelled, DB RPC rejection is returned, proving no bypass
    const reqState = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/bill`, {
      method: 'POST',
    });
    const resState = await generateBill(reqState, {
      params: Promise.resolve({ orderId: validOrderId }),
    });
    expect(resState.status).toBe(400);
    const bodyState = await resState.json();
    expect(bodyState.error).toContain('Order is not in a billable state');
  });
});

describe('API Route Preview Write Protection (Direct Invocations in Preview Default Mode)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Simulate standard Vercel preview deployment sharing production database
    process.env.VERCEL_ENV = 'preview';
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;
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
    const res = await generateBill(req, {
      params: Promise.resolve({ orderId: '00000000-0000-0000-0000-000000000001' }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('PREVIEW_READ_ONLY');
  });

  it('rejects POST /api/admin/bills/[billId]/cancel in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/admin/bills/123/cancel', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Test cancel' }),
    });
    const res = await cancelBill(req, {
      params: Promise.resolve({ billId: '00000000-0000-0000-0000-000000000001' }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('PREVIEW_READ_ONLY');
  });

  it('rejects POST /api/staff/bills/[billId]/reprint in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/staff/bills/123/reprint', { method: 'POST' });
    const res = await reprintBill(req, {
      params: Promise.resolve({ billId: '00000000-0000-0000-0000-000000000001' }),
    });
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
    const reqPost = new NextRequest('http://localhost/api/admin/menu', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const resPost = await createMenuItem(reqPost);
    expect(resPost.status).toBe(403);

    const reqPatch = new NextRequest('http://localhost/api/admin/menu', {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const resPatch = await updateMenuItem(reqPatch);
    expect(resPatch.status).toBe(403);
  });

  it('rejects POST /api/admin/categories in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name: 'Juices' }),
    });
    const res = await createCategory(req);
    expect(res.status).toBe(403);
  });

  it('rejects PATCH /api/admin/settings in preview mode with HTTP 403', async () => {
    const req = new NextRequest('http://localhost/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ cafe_name: 'Test' }),
    });
    const res = await updateSettings(req);
    expect(res.status).toBe(403);
  });
});
