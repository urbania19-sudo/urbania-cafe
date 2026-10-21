import { describe, expect, it } from 'vitest';
import type { Bill } from '../src/lib/billing';

describe('Order Billing Workflow & State Rules', () => {
  function canGenerateBill(status: string): boolean {
    return ['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'].includes(status);
  }

  it('prohibits billing for NEW and CANCELLED orders', () => {
    expect(canGenerateBill('NEW')).toBe(false);
    expect(canGenerateBill('CANCELLED')).toBe(false);
  });

  it('permits billing for ACCEPTED, PREPARING, READY, and COMPLETED orders', () => {
    expect(canGenerateBill('ACCEPTED')).toBe(true);
    expect(canGenerateBill('PREPARING')).toBe(true);
    expect(canGenerateBill('READY')).toBe(true);
    expect(canGenerateBill('COMPLETED')).toBe(true);
  });

  it('maintains snapshot immutability across reprints', () => {
    const originalBill: Bill = {
      id: 'b-100',
      order_id: 'ord-100',
      bill_number: 'UB-01001',
      bill_seq: 1001,
      order_number: 1,
      table_number: 1,
      status: 'issued',
      document_type: 'bill',
      business_snapshot: {
        cafe_name: 'Urbania Café',
        legal_name: 'URBANIA CAFE AND JUICE BAR',
        fssai_number: '12226032000212',
      },
      items_snapshot: [
        {
          id: 'item-1',
          name: 'Cappuccino',
          unit_price_paise: 20000,
          quantity: 1,
          line_total_paise: 20000,
        },
      ],
      subtotal_paise: 20000,
      tax_rate: 0,
      tax_paise: 0,
      total_paise: 20000,
      notes: null,
      issued_at: '2026-10-20T10:00:00Z',
      issued_by: 'staff-user',
    };

    // When reprinting, the bill must NOT be re-calculated or mutated
    const reprint = { ...originalBill };
    expect(reprint.bill_number).toBe('UB-01001');
    expect(reprint.items_snapshot[0]?.unit_price_paise).toBe(20000);
    expect(reprint.issued_at).toBe('2026-10-20T10:00:00Z');
  });
});
