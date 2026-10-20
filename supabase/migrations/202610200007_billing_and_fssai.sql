-- Urbania Café — Migration 0007: Production billing, thermal receipts, and FSSAI compliance
-- Additive only. Destination compatible with Next.js 16 schema.

-- 1. Enhanced Business & FSSAI Settings in cafe_settings
alter table public.cafe_settings
  add column if not exists legal_name text default 'URBANIA CAFE AND JUICE BAR',
  add column if not exists fssai_number text default '12226032000212',
  add column if not exists fssai_validity_date date default '2027-02-22',
  add column if not exists address_line1 text default '17/456, Chopasni Housing Board',
  add column if not exists city text default 'Jodhpur',
  add column if not exists state text default 'Rajasthan',
  add column if not exists pincode text default '342008',
  add column if not exists pincode_verified boolean not null default false,
  add column if not exists phone text default null,
  add column if not exists email text default null,
  add column if not exists gst_status text not null default 'unconfirmed'
    check (gst_status in ('unconfirmed', 'registered', 'not_registered')),
  add column if not exists gstin text default null,
  add column if not exists tax_treatment text not null default 'inclusive'
    check (tax_treatment in ('inclusive', 'exclusive', 'none')),
  add column if not exists bill_prefix text not null default 'UB-',
  add column if not exists bill_header_text text default null,
  add column if not exists bill_footer_text text not null default 'Thank you for visiting Urbania Café!';

-- Populate default verified business details for existing cafe_settings rows
update public.cafe_settings
set legal_name = coalesce(legal_name, 'URBANIA CAFE AND JUICE BAR'),
    fssai_number = coalesce(fssai_number, '12226032000212'),
    fssai_validity_date = coalesce(fssai_validity_date, '2027-02-22'::date),
    address_line1 = coalesce(address_line1, '17/456, Chopasni Housing Board'),
    city = coalesce(city, 'Jodhpur'),
    state = coalesce(state, 'Rajasthan'),
    pincode = coalesce(pincode, '342008'),
    bill_prefix = coalesce(bill_prefix, 'UB-'),
    bill_footer_text = coalesce(bill_footer_text, 'Thank you for visiting Urbania Café!');

-- Allow staff to read settings for receipt display
drop policy if exists "staff read settings" on public.cafe_settings;
create policy "staff read settings" on public.cafe_settings
  for select using (public.is_staff());

-- 2. Billed Timestamp on Orders
alter table public.orders
  add column if not exists billed_at timestamptz default null;

-- 3. Bill Sequence & Bills Table
create sequence if not exists public.bill_number_seq start 1001;

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  bill_number text not null unique,
  bill_seq bigint not null,
  order_number bigint not null,
  table_number int not null default 0,
  table_label text,
  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  document_type text not null default 'bill' check (document_type in ('bill', 'tax_invoice')),
  business_snapshot jsonb not null,
  items_snapshot jsonb not null,
  subtotal_paise int not null check (subtotal_paise >= 0),
  tax_rate numeric(5,4) not null default 0 check (tax_rate >= 0 and tax_rate < 1),
  tax_paise int not null default 0 check (tax_paise >= 0),
  total_paise int not null check (total_paise >= 0),
  notes text,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bills_order_id_idx on public.bills (order_id);
create index if not exists bills_bill_number_idx on public.bills (bill_number);
create index if not exists bills_issued_at_idx on public.bills (issued_at desc);

grant select on public.bills to authenticated;
grant all on public.bills to service_role;

alter table public.bills enable row level security;

create policy "staff read bills" on public.bills for select using (public.is_staff());
create policy "admins manage bills" on public.bills for all using (public.is_admin()) with check (public.is_admin());

-- 4. Atomic Server-Side Bill Generation RPC
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
begin
  -- 1. Authorization: user must be staff or service_role
  if not (public.is_staff() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'URB:forbidden';
  end if;

  -- 2. Idempotency: if bill already issued, return existing record immediately
  select * into v_bill from public.bills where order_id = p_order_id;
  if found then
    return jsonb_build_object(
      'ok', true,
      'already_issued', true,
      'bill', to_jsonb(v_bill)
    );
  end if;

  -- 3. Lock order row for update to prevent concurrent duplicate generation
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'URB:not_found';
  end if;

  -- Re-check if another concurrent process generated the bill while waiting for the lock
  select * into v_bill from public.bills where order_id = p_order_id;
  if found then
    return jsonb_build_object(
      'ok', true,
      'already_issued', true,
      'bill', to_jsonb(v_bill)
    );
  end if;

  -- 4. Check order eligibility
  if v_order.status = 'CANCELLED' then
    raise exception 'URB:order_cancelled';
  end if;

  if v_order.status = 'NEW' then
    raise exception 'URB:order_not_accepted';
  end if;

  -- 5. Read table details
  select * into v_table from public.cafe_tables where id = v_order.table_id;

  -- 6. Read current settings snapshot
  select * into v_settings from public.cafe_settings limit 1;
  if not found then
    -- Fallback default settings if table is empty
    v_settings := row(
      gen_random_uuid(), 'Urbania Café', null, null, '#a34d2d', 'Asia/Kolkata', now(), now(),
      'URBANIA CAFE AND JUICE BAR', '12226032000212', '2027-02-22'::date,
      '17/456, Chopasni Housing Board', 'Jodhpur', 'Rajasthan', '342008', false,
      null, null, 'unconfirmed', null, 'inclusive', 'UB-', null, 'Thank you for visiting Urbania Café!'
    )::public.cafe_settings;
  end if;

  -- 6. Enforce GST correctness: until itemized CGST/SGST tax calculation is implemented
  -- and validated, block tax-invoice generation to prevent issuing zero-tax tax invoices.
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

  -- 7. Collect items snapshot directly from database records
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'name', oi.item_name_snapshot,
        'unit_price_paise', oi.unit_price_paise,
        'quantity', oi.quantity,
        'line_total_paise', oi.line_total_paise,
        'selected_options', oi.selected_options_snapshot,
        'note', oi.item_note
      ) order by oi.id
    ),
    '[]'::jsonb
  ) into v_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  -- 8. Atomically allocate bill number from sequence
  v_seq := nextval('public.bill_number_seq');
  v_bill_number := coalesce(v_settings.bill_prefix, 'UB-') || lpad(v_seq::text, 5, '0');

  -- 9. Insert immutable bill record
  insert into public.bills (
    order_id,
    bill_number,
    bill_seq,
    order_number,
    table_number,
    table_label,
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
    coalesce(v_table.table_number, 0),
    coalesce(v_table.label, 'Table ?'),
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

  -- 10. Mark order as billed
  update public.orders
  set billed_at = v_bill.issued_at
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'already_issued', false,
    'bill', to_jsonb(v_bill)
  );
end $$;

grant execute on function public.generate_bill(uuid) to authenticated, service_role;

-- 5. Helper Function to Fetch Bill for an Order
create or replace function public.get_bill_for_order(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_bill record;
begin
  if not (public.is_staff() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'URB:forbidden';
  end if;

  select * into v_bill from public.bills where order_id = p_order_id;
  if not found then
    return null;
  end if;

  return to_jsonb(v_bill);
end $$;

grant execute on function public.get_bill_for_order(uuid) to authenticated, service_role;
