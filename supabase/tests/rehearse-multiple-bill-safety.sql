-- Urbania Café — Multiple-Bill Safety Gate Rehearsal
-- Simulates an ambiguous scenario by temporarily dropping the 1:1 order_id constraint,
-- inserting multiple bills for a single order, and proving that the migration 0018
-- safety assertion fails closed with URB:ambiguous_multiple_bills_detected.

alter table public.bills drop constraint if exists bills_order_id_key;

do $$
declare
  v_test_order uuid := gen_random_uuid();
  v_caught boolean := false;
begin
  -- 1. Insert test order
  insert into public.orders (
    id, order_number, table_id, order_source, status,
    subtotal_paise, total_paise, idempotency_key
  )
  select
    v_test_order, 99991, id, 'manual', 'COMPLETED',
    20000, 20000, gen_random_uuid()
  from public.cafe_tables
  limit 1;

  -- 2. Insert duplicate bills referencing the same order
  insert into public.bills (
    order_id, order_number, bill_number, bill_seq, status,
    order_source, document_type, business_snapshot, items_snapshot,
    subtotal_paise, total_paise
  )
  values (
    v_test_order, 99991, 'UB-DUP-1', 99991, 'issued',
    'manual', 'bill', '{}'::jsonb, '[]'::jsonb, 20000, 20000
  );

  insert into public.bills (
    order_id, order_number, bill_number, bill_seq, status,
    order_source, document_type, business_snapshot, items_snapshot,
    subtotal_paise, total_paise
  )
  values (
    v_test_order, 99991, 'UB-DUP-2', 99991, 'cancelled',
    'manual', 'bill', '{}'::jsonb, '[]'::jsonb, 20000, 20000
  );

  -- 3. Execute the migration 0018 safety gate logic
  begin
    if exists (
      select 1 from public.bills group by order_id having count(*) > 1
    ) then
      raise exception 'URB:ambiguous_multiple_bills_detected: manual reconciliation required';
    end if;
  exception
    when others then
      if sqlerrm like '%URB:ambiguous_multiple_bills_detected%' then
        v_caught := true;
      else
        raise;
      end if;
  end;

  if not v_caught then
    raise exception 'Multiple-bill safety gate FAILED to catch ambiguous duplicate bills!';
  end if;

  -- 4. Clean up test rows
  delete from public.bills where order_id = v_test_order;
  delete from public.orders where id = v_test_order;
end $$;

alter table public.bills add constraint bills_order_id_key unique (order_id);
