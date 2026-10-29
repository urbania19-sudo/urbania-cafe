// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextRequest } from 'next/server';

import { isSupabaseConfigured, isPreviewDemoMode } from '@/lib/preview-demo';
import PreviewDemoBanner from '@/components/demo/PreviewDemoBanner';
import {
  DEMO_CAFE_SETTINGS,
  DEMO_ADMIN_PROFILE,
  DEMO_ADMIN_USERS,
  DEMO_TABLES,
  DEMO_STAFF_ORDERS,
  DEMO_ADMIN_ORDERS,
  DEMO_ADMIN_METRICS,
  DEMO_BILLS,
  DEMO_CREDIT_ORDERS,
  findDemoKitchenTicketOrder,
} from '@/lib/demo-fixtures';

// Page components
import AdminPage from '@/app/admin/page';
import AdminMenuPage from '@/app/admin/menu/page';
import TablesPage from '@/app/admin/tables/page';
import AdminSettingsPage from '@/app/admin/settings/page';
import AdminReportsPage from '@/app/admin/reports/page';
import AdminCreditOrdersPage from '@/app/admin/credit-orders/page';
import StaffPage from '@/app/staff/page';
import KitchenTokenPrintPage from '@/app/staff/orders/[orderId]/kitchen-token/print/page';
import BillPrintPage from '@/app/staff/bills/[billId]/print/page';
import MenuPage from '@/app/menu/[tableToken]/page';
import AdminLoginPage from '@/app/admin/login/page';
import StaffLoginPage from '@/app/staff/login/page';

// API Handlers
import { GET as getBillsReport } from '@/app/api/admin/reports/bills/route';
import { GET as getCreditOrders, POST as createCreditOrder } from '@/app/api/admin/credit-orders/route';
import { GET as getCreditAdmins } from '@/app/api/admin/credit-orders/admins/route';
import { GET as getBillAuditEvents } from '@/app/api/admin/reports/events/route';
import { GET as exportBillsCsv } from '@/app/api/admin/reports/export/bills/route';
import { GET as exportEventsCsv } from '@/app/api/admin/reports/export/events/route';
import { GET as exportItemsCsv } from '@/app/api/admin/reports/export/items/route';
import { GET as getTableQrSvg } from '@/app/api/admin/qr/[token]/route';
import { POST as createStaffOrder } from '@/app/api/staff/orders/route';
import { PATCH as updateSettings } from '@/app/api/admin/settings/route';
import { GET as getStaffOrderBill } from '@/app/api/staff/orders/[orderId]/bill/route';
import { GET as getStaffKitchenToken } from '@/app/api/staff/orders/[orderId]/kitchen-token/route';
import { GET as getOrderPoll } from '@/app/api/orders/[key]/route';

import { redirect, notFound } from 'next/navigation';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/admin',
}));

describe('Urbania Café — Safe Vercel Preview Demo Mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    // Clear Supabase variables by default to test demo mode
    delete process.env.SUPABASE_INTERNAL_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;

    // Provide mock fetch for jsdom so relative URLs in client-side useEffect don't throw
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/admin/credit-orders/admins')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, admins: DEMO_ADMIN_USERS }),
        });
      }
      if (urlStr.includes('/api/admin/credit-orders')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, orders: DEMO_CREDIT_ORDERS, summary: {} }),
        });
      }
      if (urlStr.includes('/api/admin/reports/bills')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, bills: DEMO_BILLS, totalCount: DEMO_BILLS.length, summary: {} }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('1. Demo Mode Activation Logic', () => {
    it('activates demo mode when VERCEL_ENV === "preview" and Supabase credentials are missing', () => {
      process.env.VERCEL_ENV = 'preview';
      expect(isSupabaseConfigured()).toBe(false);
      expect(isPreviewDemoMode()).toBe(true);
    });

    it('does NOT activate demo mode in preview when Supabase credentials ARE configured', () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://custom-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

      expect(isSupabaseConfigured()).toBe(true);
      expect(isPreviewDemoMode()).toBe(false);
    });

    it('does NOT activate demo mode in production even if Supabase credentials are missing', () => {
      process.env.VERCEL_ENV = 'production';
      expect(isSupabaseConfigured()).toBe(false);
      expect(isPreviewDemoMode()).toBe(false);
    });

    it('does NOT activate demo mode in production when credentials are configured', () => {
      process.env.VERCEL_ENV = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://custom-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

      expect(isSupabaseConfigured()).toBe(true);
      expect(isPreviewDemoMode()).toBe(false);
    });

    it('does NOT activate demo mode in local development (VERCEL_ENV undefined) without credentials', () => {
      delete process.env.VERCEL_ENV;
      expect(isSupabaseConfigured()).toBe(false);
      expect(isPreviewDemoMode()).toBe(false);
    });

    it('does NOT activate demo mode in local development with local Supabase credentials', () => {
      delete process.env.VERCEL_ENV;
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_anon_token';

      expect(isSupabaseConfigured()).toBe(true);
      expect(isPreviewDemoMode()).toBe(false);
    });
  });

  describe('2. Preview Demo Banner', () => {
    it('renders the exact required copy and status role', () => {
      render(<PreviewDemoBanner />);
      const banner = screen.getByRole('status', { name: /preview demo mode/i });
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(banner).toHaveStyle({ position: 'sticky' });
    });
  });

  describe('3. Admin & Staff Page Rendering in Demo Mode', () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = 'preview';
    });

    it('/admin renders demo metrics, recent orders, and demo banner', async () => {
      const pageJsx = await AdminPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(container.textContent).toContain('Today’s service');
      expect(container.textContent).toContain('Owner portal · owner');
      expect(container.textContent).toContain("Today's orders");
      expect(container.textContent).toContain('Active in kitchen');
      expect(container.textContent).toContain('Recent orders');
      expect(container.textContent).toContain('#101');
    });

    it('/admin/menu renders synthetic catalog and demo banner', async () => {
      const pageJsx = await AdminMenuPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(container.textContent).toContain('Menu management');
      expect(container.textContent).toContain('Sandwiches');
      expect(screen.getByDisplayValue('Veg Grill')).toBeInTheDocument();
    });

    it('/admin/tables renders synthetic table list and demo banner', async () => {
      const pageJsx = await TablesPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(container.textContent).toContain('Table QR codes');
      expect(container.textContent).toContain('Table 1');
      expect(container.textContent).toContain('Table 5');
    });

    it('/admin/settings renders synthetic cafe settings and demo banner', async () => {
      const pageJsx = await AdminSettingsPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(container.textContent).toContain('Business & FSSAI Settings');
      expect(screen.getByDisplayValue('Urbania Café')).toBeInTheDocument();
      expect(screen.getByDisplayValue('12226032000212')).toBeInTheDocument();
    });

    it('/admin/reports renders audit interface with demo banner', async () => {
      const pageJsx = await AdminReportsPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(container.textContent).toContain('Audit & Reports');
    });

    it('/admin/credit-orders renders credit ledger with demo banner', async () => {
      const pageJsx = await AdminCreditOrdersPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(container.textContent).toContain('Admin Credit & Settlements');
    });

    it('/staff renders live order queue with demo orders and demo banner', async () => {
      const pageJsx = await StaffPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(container.textContent).toContain('Live Order Queue');
      expect(container.textContent).toContain('#101');
      expect(container.textContent).toContain('#102');
    });

    it('/staff/orders/[orderId]/kitchen-token/print renders kitchen ticket and demo banner', async () => {
      const pageJsx = await KitchenTokenPrintPage({
        params: Promise.resolve({ orderId: 'e0000000-0000-4000-8000-000000000101' }),
        searchParams: Promise.resolve({}),
      });
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(screen.getByRole('img', { name: /Kitchen Token #101/i })).toBeInTheDocument();
    });

    it('/staff/bills/[billId]/print renders receipt and demo banner for demo bill', async () => {
      const pageJsx = await BillPrintPage({
        params: Promise.resolve({ billId: 'b0000000-0000-4000-8000-000000000001' }),
        searchParams: Promise.resolve({}),
      });
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('PREVIEW DEMO — Sample data only. Changes are not saved.');
      expect(screen.getByRole('img', { name: /Bill #UB-DEMO-0001/i })).toBeInTheDocument();
    });

    it('/staff/bills/[billId]/print calls notFound for non-existent bill in demo mode', async () => {
      await BillPrintPage({
        params: Promise.resolve({ billId: 'b0000000-0000-4000-8000-000000000999' }),
        searchParams: Promise.resolve({}),
      });
      expect(notFound).toHaveBeenCalled();
    });

    it('/menu/[tableToken] renders demo menu for demo-table-1 and demo-t2', async () => {
      const pageJsx1 = await MenuPage({
        params: Promise.resolve({ tableToken: 'demo-table-1' }),
      });
      const { container: c1 } = render(pageJsx1);
      expect(c1.textContent).toContain('Table 1');
      expect(c1.textContent).toContain('Sandwiches');

      const pageJsx2 = await MenuPage({
        params: Promise.resolve({ tableToken: 'demo-t2' }),
      });
      const { container: c2 } = render(pageJsx2);
      expect(c2.textContent).toContain('Table 2');
      expect(c2.textContent).toContain('Sandwiches');
    });

    it('login pages redirect automatically in demo mode', async () => {
      await AdminLoginPage();
      expect(redirect).toHaveBeenCalledWith('/admin');

      await StaffLoginPage();
      expect(redirect).toHaveBeenCalledWith('/staff');
    });
  });

  describe('4. API Routes in Demo Mode (Read Operations & Fail-Closed Writes)', () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = 'preview';
    });

    it('GET /api/admin/reports/bills returns synthetic bills and summary', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/reports/bills');
      const res = await getBillsReport(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.bills.length).toBeGreaterThan(0);
      expect(data.summary).toBeDefined();
      expect(data.summary.totalCount).toBe(DEMO_BILLS.length);
    });

    it('GET /api/admin/reports/bills supports search by order number', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/reports/bills?search=106');
      const res = await getBillsReport(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.bills.length).toBe(1);
      expect(data.bills[0].order_number).toBe(106);
    });

    it('GET /api/admin/credit-orders returns synthetic credit orders and summary', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/credit-orders');
      const res = await getCreditOrders(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.orders.length).toBe(DEMO_CREDIT_ORDERS.length);
      expect(data.summary.overallTotalPaise).toBeGreaterThan(0);
    });

    it('GET /api/admin/credit-orders/admins returns synthetic authorized admin users', async () => {
      const res = await getCreditAdmins();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.admins.length).toBe(DEMO_ADMIN_USERS.length);
      expect(data.admins[0].email).toBe('owner@urbaniacafe.com');
    });

    it('GET /api/admin/reports/events returns synthetic bill audit events', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/reports/events');
      const res = await getBillAuditEvents(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.events.length).toBeGreaterThan(0);
    });

    it('GET /api/admin/reports/export/bills returns CSV content in demo mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/reports/export/bills');
      const res = await exportBillsCsv(req);
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(text).toContain('Bill Number');
      expect(text).toContain('UB-DEMO-0001');
    });

    it('GET /api/admin/qr/[token] generates SVG QR code in demo mode', async () => {
      const res = await getTableQrSvg(new Request('http://localhost:3000/api/admin/qr/demo-t1'), {
        params: Promise.resolve({ token: 'demo-t1' }),
      });
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/svg+xml');
      expect(text).toContain('<svg');
    });

    it('GET /api/staff/orders/[orderId]/bill returns synthetic bill for valid order in demo mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/staff/orders/e0000000-0000-4000-8000-000000000106/bill');
      const res = await getStaffOrderBill(req, {
        params: Promise.resolve({ orderId: 'e0000000-0000-4000-8000-000000000106' }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.bill).toBeDefined();
      expect(data.bill.order_number).toBe(106);
      expect(data.bill.bill_number).toBe('UB-DEMO-0001');
    });

    it('GET /api/staff/orders/[orderId]/bill returns 404 for unknown order in demo mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/staff/orders/e0000000-0000-4000-8000-000000000999/bill');
      const res = await getStaffOrderBill(req, {
        params: Promise.resolve({ orderId: 'e0000000-0000-4000-8000-000000000999' }),
      });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe('Order bill not found');
    });

    it('GET /api/staff/orders/[orderId]/kitchen-token returns KOT delta in demo mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/staff/orders/e0000000-0000-4000-8000-000000000101/kitchen-token');
      const res = await getStaffKitchenToken(req, {
        params: Promise.resolve({ orderId: 'e0000000-0000-4000-8000-000000000101' }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.order.order_number).toBe(101);
      expect(data.delta).toBeDefined();
    });

    it('GET /api/orders/[key] returns 404 fail-closed in demo mode', async () => {
      const req = new Request('http://localhost:3000/api/orders/e0000000-0000-4000-8000-000000000101');
      const res = await getOrderPoll(req, {
        params: Promise.resolve({ key: 'e0000000-0000-4000-8000-000000000101' }),
      });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe('Not found');
    });

    it('POST /api/staff/orders fails closed with 403 Forbidden in demo mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/staff/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderSource: 'manual',
          serviceMode: 'dine_in',
          items: [{ name: 'Test', quantity: 1, unitPricePaise: 1000 }],
        }),
      });

      const res = await createStaffOrder(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('PREVIEW_READ_ONLY');
      expect(data.error).toBeDefined();
    });

    it('POST /api/admin/credit-orders fails closed with 403 Forbidden in demo mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/credit-orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          adminUserId: '00000000-0000-4000-a000-000000000001',
          idempotencyKey: '00000000-0000-4000-a000-000000000099',
          items: [{ name: 'Test Dish', quantity: 1, unitPricePaise: 5000 }],
        }),
      });

      const res = await createCreditOrder(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('PREVIEW_READ_ONLY');
    });

    it('PATCH /api/admin/settings fails closed with 403 Forbidden in demo mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cafe_name: 'Hacked Cafe' }),
      });

      const res = await updateSettings(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('PREVIEW_READ_ONLY');
    });
  });

  describe('5. Production and Local Dev Behavior Preservation', () => {
    it('/admin falls back to "Admin unavailable" when unconfigured in production', async () => {
      process.env.VERCEL_ENV = 'production';
      const pageJsx = await AdminPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('Admin unavailable');
      expect(container.textContent).toContain('Configure Supabase to enable the owner dashboard.');
      expect(container.textContent).not.toContain('PREVIEW DEMO');
    });

    it('/admin falls back to "Admin unavailable" when unconfigured in local development', async () => {
      delete process.env.VERCEL_ENV;
      const pageJsx = await AdminPage();
      const { container } = render(pageJsx);

      expect(container.textContent).toContain('Admin unavailable');
      expect(container.textContent).toContain('Configure Supabase to enable the owner dashboard.');
      expect(container.textContent).not.toContain('PREVIEW DEMO');
    });
  });
});
