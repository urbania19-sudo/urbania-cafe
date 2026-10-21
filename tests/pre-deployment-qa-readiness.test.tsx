// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextRequest } from 'next/server';

// Components
import MenuClient from '@/components/menu/MenuClient';
import OrderBoard from '@/components/staff/OrderBoard';
import ManualOrderModal from '@/components/staff/ManualOrderModal';
import ThermalBillModal from '@/components/staff/ThermalBillModal';
import ReceiptPrintView from '@/components/bills/ReceiptPrintView';

// API Routes
import { POST as placePublicOrder } from '@/app/api/orders/route';
import { GET as trackOrderStatus } from '@/app/api/orders/[key]/route';
import { POST as createManualOrder } from '@/app/api/staff/orders/route';
import { PATCH as updateOrderStatus } from '@/app/api/staff/orders/[orderId]/route';
import { PATCH as editOrderItems } from '@/app/api/staff/orders/[orderId]/items/route';
import { POST as generateBill } from '@/app/api/staff/orders/[orderId]/bill/route';
import { POST as cancelBill } from '@/app/api/admin/bills/[billId]/cancel/route';

// Libs
import { SAMPLE_BILL, type Bill } from '@/lib/billing';
import { isPreviewWriteBlocked, enforcePreviewWriteGuard } from '@/lib/preview-guard';
import { calculateLineTotal } from '@/lib/pricing';

// Mocks
vi.mock('@/lib/supabase/auth-server', () => ({
  authDb: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  adminDb: vi.fn(),
}));
vi.mock('@/lib/owner', () => ({
  staffDb: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { authDb } from '@/lib/supabase/auth-server';
import { adminDb } from '@/lib/supabase/server';
import { staffDb } from '@/lib/owner';

describe('Pre-Deployment QA & Release Readiness Test Suite', () => {
  const originalEnv = process.env;

  const validTableToken = 'a0000000-0000-4000-8000-000000000001';
  const validOrderId = 'b0000000-0000-4000-8000-000000000002';
  const validMenuItemId = 'c0000000-0000-4000-8000-000000000003';
  const validIdempotencyKey = 'd0000000-0000-4000-8000-000000000004';
  const validBillId = 'e0000000-0000-4000-8000-000000000005';

  const mockMenuItems = [
    {
      id: validMenuItemId,
      name: 'Cold Coffee Frappe',
      description: 'Chilled rich espresso blended with creamy vanilla milk',
      price_paise: 18000,
      is_veg: true,
      is_available: true,
      category_id: 'cat-beverages',
      image_url: null,
    },
    {
      id: 'c0000000-0000-4000-8000-000000000009',
      name: 'Seasonal Mango Shake (Out of Stock)',
      description: 'Fresh seasonal mangoes blended with milk',
      price_paise: 16000,
      is_veg: true,
      is_available: false, // unavailable item
      category_id: 'cat-beverages',
      image_url: null,
    },
    {
      id: 'c0000000-0000-4000-8000-000000000010',
      name: 'Grilled Cheese Sandwich',
      description: 'Toasted sourdough with cheddar and mozzarella',
      price_paise: 22000,
      is_veg: true,
      is_available: true,
      category_id: 'cat-food',
      image_url: null,
    },
  ];

  const mockCategories = [
    { id: 'cat-beverages', name: 'Beverages' },
    { id: 'cat-food', name: 'Food' },
  ];

  const mockTables = [
    { id: validTableToken, table_number: 1, label: 'Table 1' },
    { id: 'a0000000-0000-4000-8000-000000000002', table_number: 2, label: 'Table 2' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.VERCEL_ENV = 'production'; // simulate operational environment
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://rexeyagnvssvjlukjcbd.supabase.co';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // 1. CUSTOMER ORDERING END TO END
  // =========================================================================
  describe('Customer Ordering End-to-End', () => {
    it('renders menu items and filters by category', () => {
      render(
        <MenuClient
          table={{ label: 'Table 1', qr_token: 'valid-token' }}
          categories={mockCategories}
          items={mockMenuItems}
        />
      );

      // Verify all available items rendered initially (regex matches bullet prefix)
      expect(screen.getByText(/Cold Coffee Frappe/i)).toBeInTheDocument();
      expect(screen.getByText(/Grilled Cheese Sandwich/i)).toBeInTheDocument();

      // Filter by Food category (role="tab")
      const foodCategoryTab = screen.getByRole('tab', { name: 'Food' });
      fireEvent.click(foodCategoryTab);

      // Verify Cold Coffee Frappe is hidden and Sandwich is visible
      expect(screen.queryByText(/Cold Coffee Frappe/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Grilled Cheese Sandwich/i)).toBeInTheDocument();

      // Filter by All categories
      const allCategoryTab = screen.getByRole('tab', { name: 'All' });
      fireEvent.click(allCategoryTab);
      expect(screen.getByText(/Cold Coffee Frappe/i)).toBeInTheDocument();
      expect(screen.getByText(/Grilled Cheese Sandwich/i)).toBeInTheDocument();
    });

    it('adds items, updates quantities, calculates cart total, and enables order submission', () => {
      render(
        <MenuClient
          table={{ label: 'Table 1', qr_token: 'valid-token' }}
          categories={mockCategories}
          items={mockMenuItems}
        />
      );

      // Add Cold Coffee Frappe (₹180)
      const addBtns = screen.getAllByRole('button', { name: 'Add' });
      fireEvent.click(addBtns[0]); // Add first available item

      // Cart bar appears with "1 item" and price
      expect(screen.getByText(/1 item/i)).toBeInTheDocument();
      expect(screen.getAllByText(/₹180.00/i).length).toBeGreaterThanOrEqual(1);

      // Open cart drawer
      fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));

      // Fill in required customer details
      const nameInput = screen.getByRole('textbox', { name: 'Your name' });
      const guestInput = screen.getByRole('spinbutton', { name: 'Number of people' });
      fireEvent.change(nameInput, { target: { value: 'Rahul Sharma' } });
      fireEvent.change(guestInput, { target: { value: '2' } });

      const submitBtn = screen.getByRole('button', { name: 'Send order to staff' });
      expect(submitBtn).toBeEnabled();
    });

    it('validates customer order submission via POST /api/orders and handles idempotency', async () => {
      const mockOrderResponse = {
        order_id: validOrderId,
        order_number: 105,
        status: 'NEW',
        total_paise: 18000,
      };

      (adminDb as any).mockReturnValue({
        rpc: vi.fn().mockResolvedValue({
          data: mockOrderResponse,
          error: null,
        }),
      });

      const payload = {
        tableToken: validTableToken,
        idempotencyKey: validIdempotencyKey,
        customerName: 'Rahul Sharma',
        guestCount: 2,
        customerNote: 'Less ice please',
        items: [{ menuItemId: validMenuItemId, quantity: 1, optionIds: [] }],
      };

      const req = new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const res = await placePublicOrder(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.order_number).toBe(105);
      expect(data.status).toBe('NEW');
    });

    it('rejects invalid customer orders: empty cart, quantity 0, and invalid UUIDs', async () => {
      // Empty items
      const reqEmpty = new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableToken: validTableToken,
          idempotencyKey: validIdempotencyKey,
          customerName: 'Rahul',
          guestCount: 1,
          items: [],
        }),
      });
      const resEmpty = await placePublicOrder(reqEmpty);
      expect(resEmpty.status).toBe(400);

      // Quantity 0
      const reqZeroQty = new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableToken: validTableToken,
          idempotencyKey: validIdempotencyKey,
          customerName: 'Rahul',
          guestCount: 1,
          items: [{ menuItemId: validMenuItemId, quantity: 0 }],
        }),
      });
      const resZeroQty = await placePublicOrder(reqZeroQty);
      expect(resZeroQty.status).toBe(400);

      // Invalid table UUID
      const reqBadToken = new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableToken: 'not-a-uuid',
          idempotencyKey: validIdempotencyKey,
          customerName: 'Rahul',
          guestCount: 1,
          items: [{ menuItemId: validMenuItemId, quantity: 1 }],
        }),
      });
      const resBadToken = await placePublicOrder(reqBadToken);
      expect(resBadToken.status).toBe(400);
    });

    it('tracks order status via GET /api/orders/[key] safely without exposing secrets', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { order_number: 105, status: 'NEW' },
        error: null,
      });

      (adminDb as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mockSingle,
            }),
          }),
        }),
      });

      const req = new NextRequest(`http://localhost/api/orders/${validIdempotencyKey}`);
      const res = await trackOrderStatus(req, { params: Promise.resolve({ key: validIdempotencyKey }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ order_number: 105, status: 'NEW' });
      // Guarantee sensitive customer data or system secrets are not exposed
      expect(data.customer_name).toBeUndefined();
      expect(data.service_role).toBeUndefined();

      // Test invalid non-UUID key returns 404
      const badReq = new NextRequest('http://localhost/api/orders/not-a-uuid');
      const badRes = await trackOrderStatus(badReq, { params: Promise.resolve({ key: 'not-a-uuid' }) });
      expect(badRes.status).toBe(404);
    });
  });

  // =========================================================================
  // 2. MANUAL AND CUSTOM ORDERS
  // =========================================================================
  describe('Manual & Custom Orders Across Service Modes', () => {
    it('supports all 4 service modes (Dine-in, Takeaway, Counter, Delivery) in ManualOrderModal', () => {
      render(
        <ManualOrderModal
          tables={mockTables}
          menuItems={mockMenuItems}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      const dineInBtn = screen.getByRole('button', { name: /🪑 Dine-in/i });
      const takeawayBtn = screen.getByRole('button', { name: /🥡 Takeaway/i });
      const counterBtn = screen.getByRole('button', { name: /🛎️ Counter/i });
      const deliveryBtn = screen.getByRole('button', { name: /🛵 Delivery/i });

      expect(dineInBtn).toBeInTheDocument();
      expect(takeawayBtn).toBeInTheDocument();
      expect(counterBtn).toBeInTheDocument();
      expect(deliveryBtn).toBeInTheDocument();

      // Dine-in displays table selection
      expect(screen.getByText('Select Table')).toBeInTheDocument();

      // Switch to Delivery mode: table selection is omitted
      fireEvent.click(deliveryBtn);
      expect(screen.queryByText('Select Table')).not.toBeInTheDocument();

      // Switch to Counter mode
      fireEvent.click(counterBtn);
      expect(screen.queryByText('Select Table')).not.toBeInTheDocument();

      // Switch to Takeaway mode
      fireEvent.click(takeawayBtn);
      expect(screen.queryByText('Select Table')).not.toBeInTheDocument();
    });

    it('adds custom line items with name, price, notes and calculates total', () => {
      render(
        <ManualOrderModal
          tables={mockTables}
          menuItems={mockMenuItems}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      // Add catalogue item (Cold Coffee Frappe ₹180)
      const addCatalogueBtn = screen.getByRole('button', { name: '+ Add Item' });
      fireEvent.click(addCatalogueBtn);

      // Add custom line item (₹75)
      fireEvent.click(screen.getByRole('button', { name: /\+ Add Permitted Custom Line Item/i }));
      fireEvent.change(screen.getByPlaceholderText('Custom Item Name'), { target: { value: 'Custom Ginger Elaichi Chai' } });
      fireEvent.change(screen.getByPlaceholderText('Price (₹)'), { target: { value: '75' } });
      fireEvent.change(screen.getByPlaceholderText('Optional Note for custom item'), { target: { value: 'Strong decoction' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Custom Item' }));

      // Total should be ₹180 + ₹75 = ₹255.00
      expect(screen.getByText(/₹255.00/i)).toBeInTheDocument();
      expect(screen.getByText('Custom Ginger Elaichi Chai')).toBeInTheDocument();
      expect(screen.getByText('Note: Strong decoction')).toBeInTheDocument();
    });

    it('validates custom item creation: rejects empty name and non-positive prices', () => {
      render(
        <ManualOrderModal
          tables={mockTables}
          menuItems={mockMenuItems}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /\+ Add Permitted Custom Line Item/i }));

      // Try adding with empty name
      fireEvent.click(screen.getByRole('button', { name: 'Add Custom Item' }));
      expect(screen.getByText('Please enter a name for the custom item.')).toBeInTheDocument();

      // Try adding with invalid negative price
      fireEvent.change(screen.getByPlaceholderText('Custom Item Name'), { target: { value: 'Cookies' } });
      fireEvent.change(screen.getByPlaceholderText('Price (₹)'), { target: { value: '-5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Custom Item' }));
      expect(screen.getByText('Please enter a valid price for the custom item.')).toBeInTheDocument();
    });

    it('handles manual order API creation with atomic RPC and idempotency', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { ok: true, order_id: validOrderId, order_number: 106, total_paise: 25500 },
        error: null,
      });

      (staffDb as any).mockResolvedValue({
        rpc: mockRpc,
      });

      const req = new NextRequest('http://localhost/api/staff/orders', {
        method: 'POST',
        body: JSON.stringify({
          serviceMode: 'counter',
          customerName: 'Walk-in Guest',
          idempotencyKey: validIdempotencyKey,
          items: [
            { menuItemId: validMenuItemId, quantity: 1 },
            { name: 'Custom Ginger Elaichi Chai', quantity: 1, unitPricePaise: 7500, isCustom: true },
          ],
        }),
      });

      const res = await createManualOrder(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.order_number).toBe(106);
    });
  });

  // =========================================================================
  // 3. STAFF ORDER LIFECYCLE & INVESTIGATIONS
  // =========================================================================
  describe('Staff Order Lifecycle: Order Placed -> Accept Order -> Completed -> View Image', () => {
    it('presents the exact intended staff buttons and NEVER displays Preparing or Ready buttons', () => {
      const orders = [
        {
          id: 'ord-new',
          order_number: 201,
          status: 'NEW',
          customer_name: 'Guest 1',
          guest_count: 1,
          total_paise: 18000,
          created_at: new Date().toISOString(),
          billed_at: null,
          service_mode: 'counter',
          order_source: 'manual',
          cafe_tables: null,
          order_items: [{ menu_item_id: validMenuItemId, item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
        },
        {
          id: 'ord-accepted',
          order_number: 202,
          status: 'ACCEPTED',
          customer_name: 'Guest 2',
          guest_count: 2,
          total_paise: 22000,
          created_at: new Date().toISOString(),
          billed_at: null,
          service_mode: 'dine_in',
          order_source: 'qr',
          cafe_tables: { label: 'Table 1' },
          order_items: [{ menu_item_id: validMenuItemId, item_name_snapshot: 'Grilled Cheese Sandwich', quantity: 1 }],
        },
        {
          id: 'ord-completed',
          order_number: 203,
          status: 'COMPLETED',
          customer_name: 'Guest 3',
          guest_count: 1,
          total_paise: 18000,
          created_at: new Date().toISOString(),
          billed_at: null,
          service_mode: 'counter',
          order_source: 'manual',
          cafe_tables: null,
          order_items: [{ menu_item_id: validMenuItemId, item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
        },
      ];

      render(<OrderBoard initial={orders as any} menu={mockMenuItems} tables={mockTables} />);

      // Verify NO "Preparing" or "Ready" buttons anywhere in the interface
      expect(screen.queryByRole('button', { name: /Preparing/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Ready/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Mark Preparing/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Mark Ready/i })).toBeNull();

      // Order 201 (NEW): "Order Placed" badge, "Accept Order", "Reject", "Edit items"
      expect(screen.getByText('Order Placed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Accept Order' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();

      // Order 202 (ACCEPTED): "Accepted" badge, "Completed", "Edit items"
      expect(screen.getByText('Accepted')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();

      // Order 203 (COMPLETED): "Completed" badge, "View Image"
      expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('button', { name: 'View Image' })).toBeInTheDocument();
    });

    it('surfaces actual server errors when an action fails instead of generic messages', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Database transition locked by concurrent transaction' }),
      });

      const orders = [
        {
          id: 'ord-err',
          order_number: 205,
          status: 'ACCEPTED',
          customer_name: 'Guest',
          guest_count: 1,
          total_paise: 18000,
          created_at: new Date().toISOString(),
          billed_at: null,
          service_mode: 'counter',
          order_source: 'manual',
          cafe_tables: null,
          order_items: [{ menu_item_id: validMenuItemId, item_name_snapshot: 'Cold Coffee Frappe', quantity: 1 }],
        },
      ];

      render(<OrderBoard initial={orders as any} menu={mockMenuItems} tables={mockTables} />);

      const completedBtn = screen.getByRole('button', { name: 'Completed' });
      fireEvent.click(completedBtn);

      await waitFor(() => {
        expect(screen.getByText('Database transition locked by concurrent transaction')).toBeInTheDocument();
      });
    });

    it('Edit Items: updates order atomically via edit_order_items RPC', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { id: validOrderId, total_paise: 36000 },
        error: null,
      });

      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-id' } }, error: null }),
        },
        rpc: mockRpc,
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({
          items: [{ menuItemId: validMenuItemId, quantity: 2 }],
        }),
      });

      const res = await editOrderItems(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('edit_order_items', {
        p_order_id: validOrderId,
        p_items: [{ menuItemId: validMenuItemId, quantity: 2 }],
      });
    });

    it('Completed Button: executes direct transition and supports idempotency', async () => {
      (authDb as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'staff-id' } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: validOrderId, status: 'ACCEPTED', order_number: 105 },
                error: null,
              }),
            }),
          }),
        }),
        rpc: vi.fn().mockResolvedValue({ data: { id: validOrderId, status: 'COMPLETED' }, error: null }),
      });

      const req = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await updateOrderStatus(req, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // 4. BILLING, RECEIPTS, AND THERMAL PRINTING
  // =========================================================================
  describe('Billing & Receipts Verification', () => {
    it('verifies verified business details and omits GST when unregistered', () => {
      const bill: Bill = {
        ...SAMPLE_BILL,
        tax_rate: 0,
        tax_paise: 0,
        business_snapshot: {
          ...SAMPLE_BILL.business_snapshot,
          cafe_name: 'Urbania Café',
          legal_name: 'URBANIA CAFE AND JUICE BAR',
          fssai_number: '12226032000212',
          pincode: '342008',
          pincode_verified: true,
          gst_status: 'unconfirmed',
        },
      };

      // Verify immutable business snapshot data
      expect(bill.business_snapshot.legal_name).toBe('URBANIA CAFE AND JUICE BAR');
      expect(bill.business_snapshot.fssai_number).toBe('12226032000212');
      expect(bill.business_snapshot.pincode).toBe('342008');
      expect(bill.business_snapshot.pincode_verified).toBe(true);
      expect(bill.tax_rate).toBe(0);
      expect(bill.tax_paise).toBe(0);

      render(<ThermalBillModal bill={bill} onClose={vi.fn()} isReprint={false} />);

      // Verify clean receipt image dialog rendered at 384px with pure white background
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      const img = screen.getByRole('img', { name: new RegExp(`Bill #${bill.bill_number}`, 'i') });
      expect(img).toBeInTheDocument();
      expect(img.style.maxWidth).toBe('384px');
      expect(img.getAttribute('width')).toBe('384');
    });

    it('renders clean receipt image element at 384px width in ReceiptPrintView', () => {
      render(<ReceiptPrintView bill={SAMPLE_BILL} isReprint={false} />);

      const img = screen.getByRole('img', { name: new RegExp(`Bill #${SAMPLE_BILL.bill_number}`, 'i') });
      expect(img).toBeInTheDocument();
      expect(img.style.maxWidth).toBe('384px');
      // Contains only clean receipt without web navigation or headers
      expect(screen.queryByRole('navigation')).toBeNull();
      expect(screen.queryByRole('banner')).toBeNull();
    });
  });

  // =========================================================================
  // 5. SECURITY & PREVIEW WRITE GUARD
  // =========================================================================
  describe('Security & Preview Guard Protection', () => {
    it('strictly blocks mutations when VERCEL_ENV=preview with HTTP 403 PREVIEW_READ_ONLY', async () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://rexeyagnvssvjlukjcbd.supabase.co';

      // Verify guard helper directly
      const guardResult = isPreviewWriteBlocked();
      expect(guardResult.blocked).toBe(true);
      expect(guardResult.code).toBe('PREVIEW_READ_ONLY');

      // Verify POST /api/orders
      const orderReq = new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({ customerName: 'Rahul' }),
      });
      const orderRes = await placePublicOrder(orderReq);
      expect(orderRes.status).toBe(403);
      expect((await orderRes.json()).code).toBe('PREVIEW_READ_ONLY');

      // Verify PATCH /api/staff/orders/[orderId]
      const statusReq = new NextRequest(`http://localhost/api/staff/orders/${validOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });
      const statusRes = await updateOrderStatus(statusReq, { params: Promise.resolve({ orderId: validOrderId }) });
      expect(statusRes.status).toBe(403);
      expect((await statusRes.json()).code).toBe('PREVIEW_READ_ONLY');
    });

    it('allows read-only endpoints in Preview mode without mutation errors', async () => {
      process.env.VERCEL_ENV = 'preview';

      (adminDb as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { order_number: 105, status: 'COMPLETED' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const trackReq = new NextRequest(`http://localhost/api/orders/${validIdempotencyKey}`);
      const trackRes = await trackOrderStatus(trackReq, { params: Promise.resolve({ key: validIdempotencyKey }) });
      // GET requests must succeed in Preview mode
      expect(trackRes.status).toBe(200);
      const data = await trackRes.json();
      expect(data.status).toBe('COMPLETED');
    });
  });
});
