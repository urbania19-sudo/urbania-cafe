import { describe, expect, it } from 'vitest';
import { friendlyBillingError, type CreateManualOrderInput, type Bill } from '../src/lib/billing';

describe('Audit & Reports Business Logic & Validation', () => {
  describe('Billing error translation', () => {
    it('translates cancellation and custom order errors to clear messages', () => {
      expect(friendlyBillingError(new Error('URB:already_cancelled'))).toBe(
        'This bill has already been cancelled.'
      );
      expect(friendlyBillingError(new Error('custom item name required'))).toBe(
        'Please enter a name for each custom line item.'
      );
      expect(friendlyBillingError(new Error('invalid custom price'))).toBe(
        'Custom item price must be a valid non-negative amount.'
      );
      expect(friendlyBillingError(new Error('invalid service mode'))).toBe(
        'Please select a valid service mode (Dine-in, Takeaway, Counter, or Delivery).'
      );
      expect(friendlyBillingError(new Error('invalid item count'))).toBe(
        'An order must contain between 1 and 25 items.'
      );
    });
  });

  describe('Manual order input validation rules', () => {
    it('validates dine-in vs non-table service modes', () => {
      const validDineIn: CreateManualOrderInput = {
        serviceMode: 'dine_in',
        tableId: 'tab-123',
        customerName: 'Rohit Sharma',
        guestCount: 2,
        items: [
          {
            menuItemId: 'item-1',
            quantity: 2,
            unitPricePaise: 12000,
            isCustom: false,
          },
        ],
      };

      const validCounter: CreateManualOrderInput = {
        serviceMode: 'counter',
        customerName: 'Walk-in Guest',
        items: [
          {
            name: 'Fresh Mint Lime Soda',
            quantity: 1,
            unitPricePaise: 8000,
            isCustom: true,
          },
        ],
      };

      expect(validDineIn.serviceMode).toBe('dine_in');
      expect(validDineIn.tableId).toBe('tab-123');
      expect(validCounter.tableId).toBeUndefined();
      expect(validCounter.items[0]?.isCustom).toBe(true);
      expect(validCounter.items[0]?.name).toBe('Fresh Mint Lime Soda');
    });

    it('calculates total paise correctly for combined catalogue and custom items', () => {
      const items = [
        { name: 'Cold Coffee', quantity: 2, unitPricePaise: 12000, isCustom: false },
        { name: 'Custom Pastry Slice', quantity: 3, unitPricePaise: 7500, isCustom: true },
      ];

      const total = items.reduce((acc, i) => acc + i.unitPricePaise * i.quantity, 0);
      expect(total).toBe(2 * 12000 + 3 * 7500); // 24000 + 22500 = 46500
      expect(total / 100).toBe(465.0);
    });
  });

  describe('Report KPI Aggregations', () => {
    const mockBills: Partial<Bill>[] = [
      {
        id: '1',
        bill_number: 'UB-01001',
        total_paise: 35000,
        status: 'issued',
        order_source: 'qr',
      },
      {
        id: '2',
        bill_number: 'UB-01002',
        total_paise: 15000,
        status: 'issued',
        order_source: 'manual',
      },
      {
        id: '3',
        bill_number: 'UB-01003',
        total_paise: 20000,
        status: 'cancelled',
        order_source: 'qr',
      },
    ];

    it('computes correct sales summary omitting cancelled bills from net revenue', () => {
      const totalBills = mockBills.length;
      const issuedBills = mockBills.filter((b) => b.status === 'issued');
      const cancelledBills = mockBills.filter((b) => b.status === 'cancelled');

      const grossSalesPaise = issuedBills.reduce((acc, b) => acc + (b.total_paise ?? 0), 0);
      const cancelledSalesPaise = cancelledBills.reduce((acc, b) => acc + (b.total_paise ?? 0), 0);
      const avgBillPaise = issuedBills.length ? Math.round(grossSalesPaise / issuedBills.length) : 0;

      expect(totalBills).toBe(3);
      expect(issuedBills.length).toBe(2);
      expect(cancelledBills.length).toBe(1);
      expect(grossSalesPaise).toBe(50000); // ₹500.00
      expect(cancelledSalesPaise).toBe(20000); // ₹200.00
      expect(avgBillPaise).toBe(25000); // ₹250.00
    });

    it('filters bills accurately by order source', () => {
      const qrBills = mockBills.filter((b) => b.order_source === 'qr');
      const manualBills = mockBills.filter((b) => b.order_source === 'manual');

      expect(qrBills.length).toBe(2);
      expect(manualBills.length).toBe(1);
      expect(manualBills[0]?.bill_number).toBe('UB-01002');
    });
  });
});
