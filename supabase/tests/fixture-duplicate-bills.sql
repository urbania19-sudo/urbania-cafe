-- Urbania Cafe - Duplicate Bill Fixture for Migration 0018 Fail-Closed Abort Replay
-- Seeds an order and two associated bills into the legacy database.

DO $$
DECLARE
  v_order_id uuid := '88888888-8888-4888-8888-888888888888'::uuid;
  v_table_id uuid;
BEGIN
  SELECT id INTO v_table_id FROM public.cafe_tables LIMIT 1;

  INSERT INTO public.orders (
    id, order_number, table_id, order_source, status,
    subtotal_paise, total_paise, idempotency_key
  ) VALUES (
    v_order_id, 98801, v_table_id, 'manual', 'COMPLETED',
    25000, 25000, gen_random_uuid()
  );

  -- Bill 1: Issued bill for 25000 paise
  INSERT INTO public.bills (
    order_id, order_number, bill_number, bill_seq, status,
    order_source, document_type, business_snapshot, items_snapshot,
    subtotal_paise, discount_paise, tax_paise, total_paise
  ) VALUES (
    v_order_id, 98801, 'UB-DUP-01', 98801, 'issued',
    'manual', 'bill', '{}'::jsonb, '[]'::jsonb,
    25000, 0, 0, 25000
  );

  -- Bill 2: Cancelled bill referencing the EXACT SAME order
  INSERT INTO public.bills (
    order_id, order_number, bill_number, bill_seq, status,
    order_source, document_type, business_snapshot, items_snapshot,
    subtotal_paise, discount_paise, tax_paise, total_paise
  ) VALUES (
    v_order_id, 98801, 'UB-DUP-02', 98802, 'cancelled',
    'manual', 'bill', '{}'::jsonb, '[]'::jsonb,
    25000, 0, 0, 25000
  );
END $$;
