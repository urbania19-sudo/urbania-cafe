import { describe, expect, it } from 'vitest';
import {
  escapeCsvCell,
  generateCsv,
  exportBillsCsv,
  exportBillItemsCsv,
  exportAuditEventsCsv,
} from '../src/lib/csv';
import type { Bill, BillAuditEvent } from '../src/lib/billing';

describe('CSV Builder & Formula Injection Defenses', () => {
  describe('escapeCsvCell', () => {
    it('handles null, undefined, and non-string inputs cleanly', () => {
      expect(escapeCsvCell(null)).toBe('""');
      expect(escapeCsvCell(undefined)).toBe('""');
      expect(escapeCsvCell(0)).toBe('"0"');
      expect(escapeCsvCell(42.5)).toBe('"42.5"');
      expect(escapeCsvCell(true)).toBe('"true"');
      expect(escapeCsvCell(false)).toBe('"false"');
    });

    it('neutralizes spreadsheet formula injection prefixes (=, +, -, @, \\t, \\r)', () => {
      expect(escapeCsvCell('=1+1')).toBe(`"'=1+1"`);
      expect(escapeCsvCell('=SUM(A1:A10)')).toBe(`"'=SUM(A1:A10)"`);
      expect(escapeCsvCell('+cmd|')).toBe(`"'+cmd|"`);
      expect(escapeCsvCell('-calc')).toBe(`"'-calc"`);
      expect(escapeCsvCell('@HYPERLINK("http://evil.com")')).toBe(`"'@HYPERLINK(""http://evil.com"")"`);
      expect(escapeCsvCell('\tmalicious')).toBe(`"'\tmalicious"`);
      expect(escapeCsvCell('\rmalicious')).toBe(`"'\rmalicious"`);
    });

    it('neutralizes formula injection even when leading whitespace is present', () => {
      expect(escapeCsvCell('   =1+2')).toBe(`"'   =1+2"`);
      expect(escapeCsvCell('  +cmd')).toBe(`"'  +cmd"`);
      expect(escapeCsvCell('  @SUM')).toBe(`"'  @SUM"`);
    });

    it('escapes embedded double quotes by doubling them per RFC 4180', () => {
      expect(escapeCsvCell('Urbania "Special" Blend')).toBe('"Urbania ""Special"" Blend"');
      expect(escapeCsvCell('Say "Hello"')).toBe('"Say ""Hello"""');
    });

    it('wraps fields containing commas, linebreaks, and special characters', () => {
      expect(escapeCsvCell('Jodhpur, Rajasthan')).toBe('"Jodhpur, Rajasthan"');
      expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCsvCell("Line 1\r\nLine 2")).toBe('"Line 1\r\nLine 2"');
    });
  });

  describe('generateCsv', () => {
    it('prepends UTF-8 BOM (\\uFEFF) for Microsoft Excel compatibility', () => {
      const csv = generateCsv(['Name', 'Price'], [['Filter Coffee', '120.00']]);
      expect(csv.startsWith('\uFEFF')).toBe(true);
    });

    it('uses standard RFC 4180 CRLF (\\r\\n) line endings', () => {
      const csv = generateCsv(['A', 'B'], [['1', '2'], ['3', '4']]);
      const body = csv.replace(/^\uFEFF/, '').trimEnd();
      const lines = body.split('\r\n');
      expect(lines).toEqual(['"A","B"', '"1","2"', '"3","4"']);
    });
  });

  describe('exportBillsCsv', () => {
    const sampleBills: Bill[] = [
      {
        id: 'bill-1',
        order_id: 'ord-1',
        bill_number: 'UB-01001',
        bill_seq: 1001,
        order_number: 101,
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
          phone: '+91 98765 43210',
          gst_status: 'not_registered',
        },
        items_snapshot: [
          {
            id: 'item-1',
            name: 'Classic Cold Coffee',
            quantity: 2,
            unit_price_paise: 12000,
            line_total_paise: 24000,
            is_custom: false,
          },
        ],
        subtotal_paise: 24000,
        tax_rate: 0,
        tax_paise: 0,
        total_paise: 24000,
        notes: null,
        issued_at: '2026-10-21T10:00:00.000Z',
        order_source: 'qr',
        service_mode: 'dine_in',
        customer_name: 'Aditya Birla',
      },
      {
        id: 'bill-2',
        order_id: 'ord-2',
        bill_number: 'UB-01002',
        bill_seq: 1002,
        order_number: 102,
        table_number: 0,
        table_label: '',
        status: 'cancelled',
        document_type: 'bill',
        business_snapshot: {
          cafe_name: 'Urbania Café',
          legal_name: 'URBANIA CAFE AND JUICE BAR',
          fssai_number: '12226032000212',
          address_line1: '17/456, Chopasni Housing Board',
          city: 'Jodhpur',
          state: 'Rajasthan',
          pincode: '342008',
          phone: '+91 98765 43210',
          gst_status: 'not_registered',
        },
        items_snapshot: [],
        subtotal_paise: 15000,
        tax_rate: 0,
        tax_paise: 0,
        total_paise: 15000,
        notes: null,
        issued_at: '2026-10-21T10:15:00.000Z',
        cancelled_at: '2026-10-21T10:30:00.000Z',
        cancellation_reason: 'Mistake in order count',
        order_source: 'manual',
        service_mode: 'counter',
        customer_name: '=DDE("cmd";"calc")', // Injection attempt in customer name
      },
    ];

    it('converts paise amounts to formatted rupees and escapes sensitive fields', () => {
      const csv = exportBillsCsv(sampleBills);
      expect(csv).toContain('"Bill Number"');
      expect(csv).toContain('"UB-01001"');
      expect(csv).toContain('"240.00"'); // subtotal
      expect(csv).toContain('"dine_in"');
      expect(csv).toContain('"qr"');
      expect(csv).toContain('"Aditya Birla"');

      // Check second bill and injection protection
      expect(csv).toContain('"UB-01002"');
      expect(csv).toContain('"150.00"');
      expect(csv).toContain(`"'=DDE(""cmd"";""calc"")"`); // Protected formula injection
      expect(csv).toContain('"Mistake in order count"');
      expect(csv).toContain('"cancelled"');
    });
  });

  describe('exportBillItemsCsv', () => {
    const sampleBills: Bill[] = [
      {
        id: 'bill-1',
        order_id: 'ord-1',
        bill_number: 'UB-01001',
        bill_seq: 1001,
        order_number: 101,
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
          phone: '+91 98765 43210',
          gst_status: 'not_registered',
        },
        items_snapshot: [
          {
            id: 'item-1',
            name: 'Classic Cold Coffee',
            quantity: 2,
            unit_price_paise: 12000,
            line_total_paise: 24000,
            is_custom: false,
            note: 'Extra cold',
          },
          {
            id: 'item-2',
            name: '+Special Combo Chef Treat', // Injection attempt
            quantity: 1,
            unit_price_paise: 25000,
            line_total_paise: 25000,
            is_custom: true,
          },
        ],
        subtotal_paise: 49000,
        tax_rate: 0,
        tax_paise: 0,
        total_paise: 49000,
        notes: null,
        issued_at: '2026-10-21T10:00:00.000Z',
      },
    ];

    it('correctly maps item snapshots and distinguishes custom items', () => {
      const csv = exportBillItemsCsv(sampleBills);
      expect(csv).toContain('"Bill Number"');
      expect(csv).toContain('"Classic Cold Coffee"');
      expect(csv).toContain('"Catalogue"');
      expect(csv).toContain('"120.00"');
      expect(csv).toContain('"240.00"');

      // Check custom item and injection escape
      expect(csv).toContain(`"'+Special Combo Chef Treat"`);
      expect(csv).toContain('"Custom Item"');
      expect(csv).toContain('"250.00"');
    });
  });

  describe('exportAuditEventsCsv', () => {
    const sampleEvents: BillAuditEvent[] = [
      {
        id: 'evt-1',
        bill_id: 'bill-1',
        bill_number: 'UB-01001',
        event_type: 'issued',
        actor_id: 'usr-1',
        actor_role: 'staff',
        actor_email: 'staff@urbania.cafe',
        metadata: { total_paise: 35000 },
        created_at: '2026-10-21T10:00:00.000Z',
      },
      {
        id: 'evt-2',
        bill_id: 'bill-1',
        bill_number: 'UB-01001',
        event_type: 'reprinted',
        actor_id: 'usr-1',
        actor_role: 'staff',
        actor_email: 'staff@urbania.cafe',
        metadata: { source: 'thermal_modal', action: 'share' },
        created_at: '2026-10-21T10:10:00.000Z',
      },
      {
        id: 'evt-3',
        bill_id: 'bill-2',
        bill_number: 'UB-01002',
        event_type: 'cancelled',
        actor_id: 'usr-admin',
        actor_role: 'owner',
        actor_email: 'owner@urbania.cafe',
        metadata: { reason: 'Duplicate order entered' },
        created_at: '2026-10-21T10:30:00.000Z',
      },
    ];

    it('formats audit events with JSON metadata strings correctly', () => {
      const csv = exportAuditEventsCsv(sampleEvents);
      expect(csv).toContain('"Event ID","Bill ID","Bill Number"');
      expect(csv).toContain('"UB-01001"');
      expect(csv).toContain('"issued"');
      expect(csv).toContain('"reprinted"');
      expect(csv).toContain('"cancelled"');
      expect(csv).toContain('"owner@urbania.cafe"');
      expect(csv).toContain('Duplicate order entered');
    });
  });
});
