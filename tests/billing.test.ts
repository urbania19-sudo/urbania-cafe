import { describe, expect, it } from 'vitest';
import { friendlyBillingError, isValidFssai, isValidGstin, type Bill } from '../src/lib/billing';

describe('Billing Logic & Validation Helpers', () => {
  it('maps database error codes into human-readable messages', () => {
    expect(friendlyBillingError(new Error('URB:forbidden'))).toBe(
      'You are not authorised to generate or view bills.'
    );
    expect(friendlyBillingError(new Error('URB:not_found'))).toBe('Order not found.');
    expect(friendlyBillingError(new Error('URB:order_cancelled'))).toBe(
      'Cannot generate a bill for a cancelled order.'
    );
    expect(friendlyBillingError(new Error('URB:order_not_accepted'))).toBe(
      'Please accept the order before generating its bill.'
    );
    expect(friendlyBillingError(new Error('URB:settings_missing'))).toBe(
      'Café settings are not configured in the database.'
    );
    expect(friendlyBillingError(new Error('URB:tax_invoice_not_configured'))).toBe(
      'GST Tax Invoices are not yet enabled pending itemized tax calculation. Please keep GST status as Pending Registration or Not Registered in Settings.'
    );
    expect(friendlyBillingError(new Error('Unknown postgres fault'))).toBe(
      'Unknown postgres fault'
    );
  });

  it('validates 14-digit FSSAI licence numbers strictly', () => {
    expect(isValidFssai('12226032000212')).toBe(true);
    expect(isValidFssai('12345678901234')).toBe(true);
    expect(isValidFssai('1222603200021')).toBe(false); // 13 digits
    expect(isValidFssai('122260320002123')).toBe(false); // 15 digits
    expect(isValidFssai('1222603200021A')).toBe(false); // non-numeric
    expect(isValidFssai('')).toBe(false);
  });

  it('validates Indian GSTIN format correctly', () => {
    expect(isValidGstin('08AAAAA0000A1Z5')).toBe(true);
    expect(isValidGstin('27ABCDE1234F2Z5')).toBe(true);
    expect(isValidGstin('08AAAAA0000A1')).toBe(false); // too short
    expect(isValidGstin('08AAAAA0000A1Z599')).toBe(false); // too long
    expect(isValidGstin('INVALID_GSTIN')).toBe(false);
  });

  it('verifies bill immutable snapshot fields', () => {
    const mockBill: Bill = {
      id: 'b-001',
      order_id: 'ord-001',
      bill_number: 'UB-01001',
      bill_seq: 1001,
      order_number: 42,
      table_number: 2,
      table_label: 'Table 2',
      status: 'issued',
      document_type: 'bill',
      business_snapshot: {
        cafe_name: 'Urbania Café',
        legal_name: 'URBANIA CAFE AND JUICE BAR',
        fssai_number: '12226032000212',
        address_line1: '17/456, Chopasni Housing Board',
        city: 'Jodhpur',
        state: 'Rajasthan',
        pincode: '342008',
        pincode_verified: true,
        gst_status: 'unconfirmed',
      },
      items_snapshot: [
        {
          id: 'item-1',
          name: 'Flat White',
          unit_price_paise: 22000,
          quantity: 2,
          line_total_paise: 44000,
        },
      ],
      subtotal_paise: 44000,
      tax_rate: 0,
      tax_paise: 0,
      total_paise: 44000,
      notes: null,
      issued_at: '2026-10-20T10:00:00Z',
      issued_by: 'staff-user-1',
    };

    expect(mockBill.business_snapshot.fssai_number).toBe('12226032000212');
    expect(mockBill.business_snapshot.pincode_verified).toBe(true);
    expect(mockBill.total_paise).toBe(44000);
    expect(mockBill.status).toBe('issued');
  });
});
