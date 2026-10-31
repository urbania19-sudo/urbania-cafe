-- Revert Migration 0012: Bill-level Fixed and Percentage Discounts

-- 1. Restore 1-argument generate_bill RPC
drop function if exists public.generate_bill(uuid, text, numeric);

create or replace function public.generate_bill(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
  v_table record;
  v_settings record;
  v_bill record;
  v_seq bigint;
  v_bill_number text;
  v_business jsonb;
  v_items jsonb;
  v_doc_type text;
  v_table_label text;
  v_table_number int := 0;
  v_actor_role text;
  v_actor_email text;
begin
  if not (public.is_staff() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'URB:forbidden';
  end if;

  select * into v_bill from public.bills where order_id = p_order_id;
  if found then
    return jsonb_build_object('ok', true, 'already_issued', true, 'bill', to_jsonb(v_bill));
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'URB:not_found';
  end if;

  select * into v_bill from public.bills where order_id = p_order_id;
  if found then
    return jsonb_build_object('ok', true, 'already_issued', true, 'bill', to_jsonb(v_bill));
  end if;

  if v_order.status = 'CANCELLED' then
    raise exception 'URB:order_cancelled';
  end if;

  if v_order.status = 'NEW' then
    raise exception 'URB:order_not_accepted';
  end if;

  if v_order.table_id is not null then
    select * into v_table from public.cafe_tables where id = v_order.table_id;
    if found then
      v_table_number := v_table.table_number;
      v_table_label := v_table.label;
    end if;
  end if;

  if v_table_label is null then
    if v_order.service_mode = 'takeaway' then
      v_table_label := 'Takeaway';
    elsif v_order.service_mode = 'counter' then
      v_table_label := 'Counter';
    elsif v_order.service_mode = 'delivery' then
      v_table_label := 'Delivery';
    else
      v_table_label := 'Table ?';
    end if;
  end if;

  select * into v_settings from public.cafe_settings limit 1;
  if not found then
    v_settings := row(
      gen_random_uuid(), 'Urbania Café', null, null, '#a34d2d', 'Asia/Kolkata', now(), now(),
      'URBANIA CAFE AND JUICE BAR', '12226032000212', '2027-02-22'::date,
      '17/456, Chopasni Housing Board', 'Jodhpur', 'Rajasthan', '342008', false,
      null, null, 'unconfirmed', null, 'inclusive', 'UB-', null, 'Thank you for visiting Urbania Café!'
    )::public.cafe_settings;
  end if;

  if v_settings.gst_status = 'registered' then
    raise exception 'URB:tax_invoice_not_configured';
  end if;
  v_doc_type := 'bill';

  v_business := jsonb_build_object(
    'cafe_name', coalesce(v_settings.cafe_name, 'Urbania Café'),
    'legal_name', coalesce(v_settings.legal_name, 'URBANIA CAFE AND JUICE BAR'),
    'fssai_number', coalesce(v_settings.fssai_number, '12226032000212'),
    'fssai_validity_date', v_settings.fssai_validity_date,
    'address_line1', coalesce(v_settings.address_line1, '17/456, Chopasni Housing Board'),
    'city', coalesce(v_settings.city, 'Jodhpur'),
    'state', coalesce(v_settings.state, 'Rajasthan'),
    'pincode', coalesce(v_settings.pincode, '342008'),
    'pincode_verified', coalesce(v_settings.pincode_verified, false),
    'phone', v_settings.phone,
    'email', v_settings.email,
    'gst_status', coalesce(v_settings.gst_status, 'unconfirmed'),
    'gstin', v_settings.gstin,
    'tax_treatment', coalesce(v_settings.tax_treatment, 'inclusive'),
    'bill_header_text', v_settings.bill_header_text,
    'bill_footer_text', coalesce(v_settings.bill_footer_text, 'Thank you for visiting Urbania Café!')
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'name', oi.item_name_snapshot,
        'unit_price_paise', oi.unit_price_paise,
        'quantity', oi.quantity,
        'line_total_paise', oi.line_total_paise,
        'selected_options', oi.selected_options_snapshot,
        'note', oi.item_note,
        'is_custom', coalesce(oi.is_custom, false)
      ) order by oi.id
    ),
    '[]'::jsonb
  ) into v_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  v_seq := nextval('public.bill_number_seq');
  v_bill_number := coalesce(v_settings.bill_prefix, 'UB-') || lpad(v_seq::text, 5, '0');

  insert into public.bills (
    order_id,
    bill_number,
    bill_seq,
    order_number,
    table_number,
    table_label,
    order_source,
    service_mode,
    customer_name,
    status,
    document_type,
    business_snapshot,
    items_snapshot,
    subtotal_paise,
    tax_rate,
    tax_paise,
    total_paise,
    notes,
    issued_at,
    issued_by
  ) values (
    p_order_id,
    v_bill_number,
    v_seq,
    v_order.order_number,
    v_table_number,
    v_table_label,
    coalesce(v_order.order_source, 'qr'),
    coalesce(v_order.service_mode, 'dine_in'),
    v_order.customer_name,
    'issued',
    v_doc_type,
    v_business,
    v_items,
    v_order.subtotal_paise,
    0,
    0,
    v_order.total_paise,
    v_order.customer_note,
    now(),
    v_uid
  )
  returning * into v_bill;

  update public.orders
  set billed_at = v_bill.issued_at
  where id = p_order_id;

  grant execute on function public.generate_bill(uuid) to authenticated, service_role;

  return jsonb_build_object(
    'ok', true,
    'already_issued', false,
    'bill', to_jsonb(v_bill)
  );
end $$;

grant execute on function public.generate_bill(uuid) to authenticated, service_role;

-- 2. Drop columns
alter table public.bills
  drop column if exists discount_paise,
  drop column if exists discount_value,
  drop column if exists discount_type,
  drop column if exists subtotal_before_discount_paise;
