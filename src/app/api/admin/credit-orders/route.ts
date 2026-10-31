import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { owner } from '@/lib/owner';
import { enforcePreviewWriteGuard } from '@/lib/preview-guard';
import { friendlyBillingError } from '@/lib/billing';
import { isPreviewDemoMode } from '@/lib/preview-demo';
import { DEMO_CREDIT_ORDERS } from '@/lib/demo-fixtures';

export const dynamic = 'force-dynamic';

const creditOrderCreateSchema = z.object({
  adminUserId: z.string('Valid admin user ID required').uuid('Valid admin user ID required'),
  customerNote: z.string().max(300).optional().nullable(),
  idempotencyKey: z.string('Valid idempotency key required').uuid('Valid idempotency key required'),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid().optional().nullable(),
        name: z.string().max(100).optional().nullable(),
        quantity: z.number().int().min(1).max(20),
        unitPricePaise: z.number().int().min(0).optional(),
        optionIds: z.array(z.string().uuid()).optional(),
        note: z.string().max(180).optional().nullable(),
        isCustom: z.boolean().optional(),
      })
    )
    .min(1, 'Order must contain at least 1 item')
    .max(25),
});

export async function GET(req: NextRequest) {
  if (isPreviewDemoMode()) {
    const { searchParams } = new URL(req.url);
    const adminUserId = searchParams.get('adminUserId')?.trim() || '';
    const paymentStatus = searchParams.get('paymentStatus') || 'all';
    const startDate = searchParams.get('startDate')?.trim() || '';
    const endDate = searchParams.get('endDate')?.trim() || '';
    const search = searchParams.get('search')?.trim() || '';

    let orders = [...DEMO_CREDIT_ORDERS];
    if (adminUserId && adminUserId !== 'all') {
      orders = orders.filter((o) => o.admin_user_id === adminUserId);
    }
    if (paymentStatus && paymentStatus !== 'all') {
      orders = orders.filter((o) => o.payment_status === paymentStatus);
    }
    if (startDate) {
      orders = orders.filter((o) => o.created_at >= `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      orders = orders.filter((o) => o.created_at <= `${endDate}T23:59:59.999Z`);
    }
    if (search) {
      const q = search.toLowerCase();
      orders = orders.filter(
        (o) =>
          String(o.order_number).includes(q) ||
          o.customer_name?.toLowerCase().includes(q) ||
          o.customer_note?.toLowerCase().includes(q)
      );
    }

    const summaryByAdmin: Record<string, { adminName: string; totalPaise: number; paidPaise: number; outstandingPaise: number; orderCount: number }> = {};
    let overallTotal = 0;
    let overallPaid = 0;
    let overallOutstanding = 0;

    for (const ord of orders) {
      const aId = ord.admin_user_id || 'unknown';
      const aName = ord.customer_name || 'Admin';
      const total = ord.total_paise || 0;
      const paid = ord.paid_paise || 0;
      const outstanding = Math.max(0, total - paid);

      if (!summaryByAdmin[aId]) {
        summaryByAdmin[aId] = {
          adminName: aName,
          totalPaise: 0,
          paidPaise: 0,
          outstandingPaise: 0,
          orderCount: 0,
        };
      }

      summaryByAdmin[aId].totalPaise += total;
      summaryByAdmin[aId].paidPaise += paid;
      summaryByAdmin[aId].outstandingPaise += outstanding;
      summaryByAdmin[aId].orderCount += 1;

      overallTotal += total;
      overallPaid += paid;
      overallOutstanding += outstanding;
    }

    return NextResponse.json({
      ok: true,
      orders,
      summary: {
        totalOrders: orders.length,
        overallTotalPaise: overallTotal,
        overallPaidPaise: overallPaid,
        overallOutstandingPaise: overallOutstanding,
        byAdmin: summaryByAdmin,
      },
    });
  }

  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const adminUserId = searchParams.get('adminUserId')?.trim() || '';
  const paymentStatus = searchParams.get('paymentStatus') || 'all';
  const startDate = searchParams.get('startDate')?.trim() || '';
  const endDate = searchParams.get('endDate')?.trim() || '';
  const search = searchParams.get('search')?.trim() || '';

  try {
    let query = db
      .from('orders')
      .select(
        'id, order_number, status, total_paise, subtotal_paise, created_at, customer_name, customer_note, order_source, admin_user_id, payment_status, paid_paise, order_items(id, item_name_snapshot, quantity, unit_price_paise, line_total_paise, item_note, is_custom)'
      )
      .eq('order_source', 'admin_credit')
      .order('created_at', { ascending: false });

    if (adminUserId && adminUserId !== 'all') {
      query = query.eq('admin_user_id', adminUserId);
    }
    if (paymentStatus && paymentStatus !== 'all') {
      query = query.eq('payment_status', paymentStatus);
    }
    if (startDate) {
      query = query.gte('created_at', `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query = query.lte('created_at', `${endDate}T23:59:59.999Z`);
    }
    if (search) {
      const orderNum = parseInt(search, 10);
      if (!isNaN(orderNum)) {
        query = query.or(`order_number.eq.${orderNum},customer_name.ilike.%${search}%,customer_note.ilike.%${search}%`);
      } else {
        query = query.or(`customer_name.ilike.%${search}%,customer_note.ilike.%${search}%`);
      }
    }

    const { data: rawOrders, error } = await query;
    if (error) {
      console.error('Failed to load admin credit orders:', error);
      return NextResponse.json({ error: 'Failed to load admin credit orders' }, { status: 500 });
    }

    const orders = (rawOrders || []).map((o) => ({
      ...o,
      subtotal_paise: o.subtotal_paise ?? o.total_paise,
    }));

    // Calculate aggregated balances per admin
    const summaryByAdmin: Record<string, { adminName: string; totalPaise: number; paidPaise: number; outstandingPaise: number; orderCount: number }> = {};
    let overallTotal = 0;
    let overallPaid = 0;
    let overallOutstanding = 0;

    for (const ord of orders) {
      const aId = ord.admin_user_id || 'unknown';
      const aName = ord.customer_name || 'Admin';
      const total = ord.total_paise || 0;
      const paid = ord.paid_paise || 0;
      const outstanding = Math.max(0, total - paid);

      if (!summaryByAdmin[aId]) {
        summaryByAdmin[aId] = {
          adminName: aName,
          totalPaise: 0,
          paidPaise: 0,
          outstandingPaise: 0,
          orderCount: 0,
        };
      }

      summaryByAdmin[aId].totalPaise += total;
      summaryByAdmin[aId].paidPaise += paid;
      summaryByAdmin[aId].outstandingPaise += outstanding;
      summaryByAdmin[aId].orderCount += 1;

      overallTotal += total;
      overallPaid += paid;
      overallOutstanding += outstanding;
    }

    return NextResponse.json({
      ok: true,
      orders,
      summary: {
        totalOrders: orders.length,
        overallTotalPaise: overallTotal,
        overallPaidPaise: overallPaid,
        overallOutstandingPaise: overallOutstanding,
        byAdmin: summaryByAdmin,
      },
    });
  } catch (err) {
    console.error('API Error in GET /api/admin/credit-orders:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = creditOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid admin credit order payload' },
      { status: 400 }
    );
  }

  const { adminUserId, customerNote, idempotencyKey, items } = parsed.data;

  try {
    // 1. Execute atomic transactional RPC
    const { data: rpcData, error: rpcError } = await db.rpc('create_admin_credit_order', {
      p_payload: {
        adminUserId,
        customerNote: customerNote?.trim() || null,
        idempotencyKey,
        items,
      },
    });

    if (rpcError) {
      console.error("Error in create_admin_credit_order RPC:", rpcError);
      const errCode = (rpcError as { code?: string }).code;
      const errMsg = rpcError.message || "";
      const isExactRpc = errMsg.includes("create_admin_credit_order");
      const isPermissionDenied = errMsg.toLowerCase().includes("permission denied");

      const isMissingFunction =
        !isPermissionDenied &&
        (errCode === "PGRST202" ||
          (errCode === "42883" && isExactRpc) ||
          (isExactRpc &&
            (errMsg.includes("does not exist") || errMsg.includes("Could not find the function"))));

      if (isMissingFunction) {
        return NextResponse.json(
          { error: "Admin credit order service is temporarily unavailable (database function pending migration)." },
          { status: 503 }
        );
      }

      if (errMsg.includes("URB:idempotency_conflict")) {
        return NextResponse.json(
          { error: "This order retry key was already used for different order details." },
          { status: 409 }
        );
      }

      const status = errMsg.includes("Admin access required") ? 403 : 400;
      return NextResponse.json(
        { error: friendlyBillingError(rpcError) },
        { status }
      );
    }

    if (!rpcData?.ok) {
      return NextResponse.json(
        { error: rpcData?.error || "Failed to create admin credit order." },
        { status: 400 }
      );
    }

    return NextResponse.json(rpcData, { status: 201 });
  } catch (err) {
    console.error('API Error in POST /api/admin/credit-orders:', err);
    return NextResponse.json(
      { error: friendlyBillingError(err) },
      { status: 500 }
    );
  }
}
