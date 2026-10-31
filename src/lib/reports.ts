/**
 * Shared Reporting & Service Metrics Layer
 *
 * Provides single-source-of-truth calculations for:
 * - Timezone-aware business-day boundaries (configured cafe timezone, default Asia/Kolkata)
 * - Order volume, active pipeline, and completed counts
 * - Gross sales, bill discounts, and net sales (excluding cancelled orders)
 * - Actual cash/digital collections (customer payments + settled admin credit; excludes unpaid credit & external delivery platforms)
 * - Swiggy & Zomato external platform order volume (payment managed externally)
 * - Admin internal credit consumption & outstanding balances
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CafeReportMetrics {
  date: string; // YYYY-MM-DD in cafe timezone
  timezone: string;
  orderCount: number; // all non-cancelled orders placed today
  completedOrderCount: number; // completed orders
  activeOrderCount: number; // in service (NEW, ACCEPTED, PREPARING, READY)
  cancelledOrderCount: number; // cancelled orders
  customerOrderCount: number; // QR & manual customer orders
  externalPlatformCount: number; // Swiggy & Zomato orders
  adminCreditCount: number; // Admin credit orders
  // Financials (in paise)
  grossSalesPaise: number; // customer item totals before discounts
  discountsPaise: number; // discounts granted on customer bills
  netSalesPaise: number; // customer billed sales after discounts
  cashCollectedPaise: number; // cash customer payments collected today
  onlineCollectedPaise: number; // online/UPI customer payments collected today
  customerCollectedPaise: number; // net recorded customer collections, including unclassified legacy receipts
  /**
   * Sum of historical customer_payments rows carrying status = 'refunded'.
   * NOTE: Financial refunds, partial refunds, and payment reversals are NOT implemented.
   * This does NOT represent confirmed money returned to customers; it is an audit classification
   * of historical records. Excluded from completed customer collections.
   */
  customerRefundsPaise: number;
  /**
   * Unambiguous alias for customerRefundsPaise to prevent staff or auditors from mistaking
   * historical audit classifications for confirmed financial refund payouts.
   */
  historicalRefundClassifiedPaise: number;
  unclassifiedCollectedPaise: number; // legacy/other-method collections not safely attributable to cash or UPI
  customerOutstandingPaise: number; // unpaid/partial customer bill balances
  collectedPaise: number; // actual money collected by Urbania (customer payments + settled admin credit)
  totalCollectedPaise: number; // total money collected (customer + admin credit settlements)
  externalPlatformValuePaise: number; // delivery platform order value (externally paid)
  adminCreditTotalPaise: number; // total internal consumption value
  adminCreditOutstandingPaise: number; // unpaid admin credit balance
  adminCreditSettledTodayPaise: number; // admin credit payments received today
}

export interface ParsedReportSearch {
  raw: string;
  trimmed: string;
  orderNumber: number | null;
  searchTerm: string;
}

/**
 * Parses user search input for Audit & Reports:
 * - Trims whitespace
 * - Identifies human-facing order numbers from inputs like "123", "#123", "Order #123", "order 123", "ORDER # 123"
 * - Returns the exact integer order number if matched, or null
 * - Preserves the search term for secondary bill number and customer name matching
 */
export function parseReportSearch(raw: string): ParsedReportSearch {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { raw, trimmed: '', orderNumber: null, searchTerm: '' };
  }

  // Matches "123", "#123", "# 123", "order 123", "Order #123", "order#123", "Order # 123"
  const orderMatch = /^(?:order\s*#?\s*|#\s*)?(\d+)$/i.exec(trimmed);
  let orderNumber: number | null = null;
  if (orderMatch && orderMatch[1]) {
    const parsed = parseInt(orderMatch[1], 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      orderNumber = parsed;
    }
  }

  return {
    raw,
    trimmed,
    orderNumber,
    searchTerm: trimmed,
  };
}

export interface DateBounds {
  startUtcIso: string;
  endUtcIso: string;
  dateStr: string;
}

/**
 * Returns the configured cafe timezone from cafe_settings, or Asia/Kolkata default.
 */
export async function getCafeTimezone(db: SupabaseClient): Promise<string> {
  try {
    const { data } = await db.from('cafe_settings').select('timezone').limit(1).maybeSingle();
    return data?.timezone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

/**
 * Calculates the exact UTC ISO string start (00:00:00.000) and end (23:59:59.999)
 * for a business date in the given IANA timezone.
 */
export function getTimezoneDateBounds(dateStr: string, timezone = 'Asia/Kolkata'): DateBounds {
  // Validate YYYY-MM-DD
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid date format "${dateStr}". Expected YYYY-MM-DD.`);
  }

  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);

  // Compute timezone offset minutes using Intl.DateTimeFormat
  let offsetMinutes = 330; // default to IST (+5:30)
  try {
    const probeDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(probeDate);
    const getPart = (type: string) => {
      const p = parts.find((pt) => pt.type === type);
      return p ? parseInt(p.value, 10) : 0;
    };
    const y = getPart('year');
    const m = getPart('month');
    const d = getPart('day');
    let h = getPart('hour');
    if (h === 24) h = 0;
    const min = getPart('minute');
    const s = getPart('second');

    const targetLocalTimeInUtcMs = Date.UTC(y, m - 1, d, h, min, s);
    offsetMinutes = Math.round((targetLocalTimeInUtcMs - probeDate.getTime()) / 60000);
  } catch {
    offsetMinutes = 330;
  }

  // Local start: YYYY-MM-DD 00:00:00.000 in target timezone converted to UTC
  const startLocalMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const startUtcMs = startLocalMs - offsetMinutes * 60 * 1000;

  // Local end: YYYY-MM-DD 23:59:59.999 in target timezone converted to UTC
  const endLocalMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const endUtcMs = endLocalMs - offsetMinutes * 60 * 1000;

  return {
    startUtcIso: new Date(startUtcMs).toISOString(),
    endUtcIso: new Date(endUtcMs).toISOString(),
    dateStr,
  };
}

/**
 * Returns current YYYY-MM-DD string in the specified timezone.
 */
export function getTodayDateString(timezone = 'Asia/Kolkata'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    // Fallback: UTC+5:30 manual shift
    const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return nowIst.toISOString().slice(0, 10);
  }
}

/**
 * Computes unified service and audit metrics for a specific business day.
 */
export async function getDailyServiceMetrics(
  db: SupabaseClient,
  targetDate?: string,
  tz?: string
): Promise<CafeReportMetrics> {
  const timezone = tz || (await getCafeTimezone(db));
  const dateStr = targetDate || getTodayDateString(timezone);
  const { startUtcIso, endUtcIso } = getTimezoneDateBounds(dateStr, timezone);

  // 1. Query all orders placed on this business day
  const ordersResult = await db
    .from('orders')
    .select('id, order_number, status, total_paise, subtotal_paise, order_source, payment_status, paid_paise, created_at')
    .gte('created_at', startUtcIso)
    .lte('created_at', endUtcIso);
  if (ordersResult.error) throw new Error(`Unable to load orders for report: ${ordersResult.error.message}`);
  const orders = ordersResult.data || [];

  // 2. Query all bills issued on this business day
  const billsResult = await db
    .from('bills')
    .select('id, order_id, order_number, status, total_paise, discount_paise, tax_paise, subtotal_paise, order_source, payment_status, payment_method, paid_paise, issued_at')
    .gte('issued_at', startUtcIso)
    .lte('issued_at', endUtcIso);
  if (billsResult.error) throw new Error(`Unable to load bills for report: ${billsResult.error.message}`);
  const bills = billsResult.data || [];

  // 3. Query all customer payments recorded on this business day
  let customerPayments: {
    bill_id: string;
    payment_method: string;
    amount_paise: number;
    status: string;
    paid_at: string;
  }[] = [];
  try {
    const paymentResult = await db
      .from('customer_payments')
      .select('bill_id, payment_method, amount_paise, status, paid_at')
      .gte('paid_at', startUtcIso)
      .lte('paid_at', endUtcIso);
    if (paymentResult.error) {
      const code = (paymentResult.error as { code?: string }).code;
      if (code !== '42P01' && code !== 'PGRST205' && code !== 'PGRST200') {
        throw new Error(`Unable to load customer payments for report: ${paymentResult.error.message}`);
      }
    } else {
      customerPayments = paymentResult.data || [];
    }
  } catch (error) {
    // Older test/staging schemas may not have migration 0017 yet; unexpected errors must surface.
    if (error instanceof Error && error.message.startsWith('Unable to load customer payments')) throw error;
    customerPayments = [];
  }

  // 4. Query all admin credit settlements received on this business day
  let settlements: { amount_paise: number; settled_at?: string }[] = [];
  try {
    const settlementResult = await db
      .from('admin_credit_settlements')
      .select('amount_paise, settled_at')
      .gte('settled_at', startUtcIso)
      .lte('settled_at', endUtcIso);
    if (settlementResult.error) {
      const code = (settlementResult.error as { code?: string }).code;
      if (code !== '42P01' && code !== 'PGRST205' && code !== 'PGRST200') {
        throw new Error(`Unable to load admin credit settlements for report: ${settlementResult.error.message}`);
      }
    } else {
      settlements = settlementResult.data || [];
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unable to load admin credit settlements')) throw error;
    settlements = [];
  }

  // --- Order Counts ---
  const nonCancelledOrders = orders.filter((o) => o.status !== 'CANCELLED');
  const cancelledOrders = orders.filter((o) => o.status === 'CANCELLED');
  const completedOrders = nonCancelledOrders.filter((o) => o.status === 'COMPLETED');
  const activeOrders = nonCancelledOrders.filter((o) =>
    ['NEW', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status)
  );

  const customerOrders = nonCancelledOrders.filter(
    (o) => o.order_source === 'qr' || o.order_source === 'manual' || !o.order_source
  );
  const platformOrders = nonCancelledOrders.filter((o) =>
    ['swiggy', 'zomato', 'delivery_platform'].includes(o.order_source)
  );
  const adminCreditOrders = nonCancelledOrders.filter((o) => o.order_source === 'admin_credit');

  // --- Financial Metrics ---
  // Gross customer sales: customer orders total before discounts
  const grossSalesPaise = customerOrders.reduce((sum, o) => sum + (o.subtotal_paise || o.total_paise || 0), 0);

  // Customer bills issued today
  const customerBills = bills.filter(
    (b) =>
      b.status === 'issued' &&
      (b.order_source === 'qr' || b.order_source === 'manual' || !b.order_source)
  );

  const discountsPaise = customerBills.reduce((sum, b) => sum + (b.discount_paise || 0), 0);
  const netSalesPaise = customerBills.reduce((sum, b) => sum + (b.total_paise || 0), 0);

  // Admin credit settlements collected today
  const adminCreditSettledTodayPaise = settlements.reduce((sum, s) => sum + (s.amount_paise || 0), 0);

  // Customer Payment Breakdown
  let cashCollectedPaise = 0;
  let onlineCollectedPaise = 0;
  let unclassifiedCollectedPaise = 0;
  let customerRefundsPaise = 0;

  // The schema allows status='refunded' as an audit classification on historical payment records;
  // it is not a financial refund transaction. Exclude any non-completed rows from receipts.
  // Financial refunds and partial refunds are not implemented.
  const paymentsByBill = new Map<string, typeof customerPayments>();
  for (const payment of customerPayments) {
    const rows = paymentsByBill.get(payment.bill_id) || [];
    rows.push(payment);
    paymentsByBill.set(payment.bill_id, rows);
  }

  for (const payment of customerPayments) {
    if (payment.status === 'refunded') {
      // Historical payment record classified with status 'refunded' for audit purposes.
      // Financial refunds are not implemented; this is an audit classification only.
      customerRefundsPaise += payment.amount_paise || 0;
      continue;
    }
    if (payment.status !== 'completed') continue;
    if (payment.payment_method === 'cash') cashCollectedPaise += payment.amount_paise || 0;
    else if (payment.payment_method === 'upi' || payment.payment_method === 'online') {
      onlineCollectedPaise += payment.amount_paise || 0;
    } else {
      unclassifiedCollectedPaise += payment.amount_paise || 0;
    }
  }

  // Check which bills have transaction ledger rows in history to avoid
  // treating modern bills paid on another day as legacy cash/online on their issue date.
  const billIds = customerBills.map((b) => b.id).filter(Boolean);
  const billsWithLedgerPayments = new Set<string>();
  if (billIds.length > 0) {
    try {
      const selectBuilder = db.from('customer_payments').select('bill_id');
      if (typeof (selectBuilder as any)?.in === 'function') {
        const { data: ledgerRows } = await (selectBuilder as any).in('bill_id', billIds);
        if (Array.isArray(ledgerRows)) {
          for (const row of ledgerRows) {
            if (row?.bill_id) billsWithLedgerPayments.add(row.bill_id);
          }
        }
      }
    } catch {
      // Table or method may not exist in mock/legacy setups; safely ignore
    }
  }

  // Reconcile older bills that predate the transaction ledger. Preserve their recorded
  // paid balance but do not invent Cash/UPI. A bill with ledger rows is never counted twice.
  for (const bill of customerBills) {
    if (paymentsByBill.has(bill.id) || billsWithLedgerPayments.has(bill.id)) continue;
    const amount = Math.max(0, bill.paid_paise ?? (bill.payment_status === 'paid' ? bill.total_paise : 0));
    if (!amount) continue;
    if (bill.payment_method === 'cash') cashCollectedPaise += amount;
    else if (bill.payment_method === 'upi' || bill.payment_method === 'online') onlineCollectedPaise += amount;
    else unclassifiedCollectedPaise += amount;
  }

  // Non-completed / refunded records are excluded from collections above.
  // Financial refunds are not implemented; do not subtract customerRefundsPaise again.
  const customerCollectedPaise = Math.max(
    0,
    cashCollectedPaise + onlineCollectedPaise + unclassifiedCollectedPaise
  );

  // Outstanding customer balance on today's issued customer bills
  let customerOutstandingPaise = 0;
  for (const b of customerBills) {
    if (b.payment_status === 'paid') continue;
    if (b.payment_status === 'unpaid') {
      customerOutstandingPaise += b.total_paise || 0;
    } else if (b.paid_paise !== undefined && b.paid_paise !== null) {
      customerOutstandingPaise += Math.max(0, (b.total_paise || 0) - b.paid_paise);
    }
  }

  // Total Actual Collections: customer collections + settled admin credit
  const totalCollectedPaise = customerCollectedPaise + adminCreditSettledTodayPaise;
  const collectedPaise = totalCollectedPaise;

  // External delivery platform volume
  const externalPlatformValuePaise = platformOrders.reduce((sum, o) => sum + (o.total_paise || 0), 0);

  // Admin credit volume
  const adminCreditTotalPaise = adminCreditOrders.reduce((sum, o) => sum + (o.total_paise || 0), 0);
  const adminCreditPaidPaise = adminCreditOrders.reduce((sum, o) => sum + (o.paid_paise || 0), 0);
  const adminCreditOutstandingPaise = Math.max(0, adminCreditTotalPaise - adminCreditPaidPaise);

  return {
    date: dateStr,
    timezone,
    orderCount: nonCancelledOrders.length,
    completedOrderCount: completedOrders.length,
    activeOrderCount: activeOrders.length,
    cancelledOrderCount: cancelledOrders.length,
    customerOrderCount: customerOrders.length,
    externalPlatformCount: platformOrders.length,
    adminCreditCount: adminCreditOrders.length,
    grossSalesPaise,
    discountsPaise,
    netSalesPaise,
    cashCollectedPaise,
    onlineCollectedPaise,
    customerCollectedPaise,
    customerRefundsPaise,
    historicalRefundClassifiedPaise: customerRefundsPaise,
    unclassifiedCollectedPaise,
    customerOutstandingPaise,
    collectedPaise,
    totalCollectedPaise,
    externalPlatformValuePaise,
    adminCreditTotalPaise,
    adminCreditOutstandingPaise,
    adminCreditSettledTodayPaise,
  };
}
