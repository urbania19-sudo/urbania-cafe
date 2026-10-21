-- Urbania Café — Migration 0009: Billing Audit Events, Manual Orders & Service Modes
-- Additive only. Fully backward compatible with existing schema.

-- 0. Ensure role helper functions & policies
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role in ('owner', 'admin', 'staff')
  );
$$;

drop policy if exists "staff read own profile" on public.admin_profiles;
create policy "staff read own profile" on public.admin_profiles
  for select using (user_id = auth.uid());

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- 1. Order Source & Service Mode on Orders
alter table public.orders
  add column if not exists order_source text not null default 'qr'
    check (order_source in ('qr', 'manual')),
  add column if not exists service_mode text not null default 'dine_in'
    check (service_mode in ('dine_in', 'takeaway', 'counter', 'delivery'));

-- Allow table_id to be nullable for takeaway / counter orders
alter table public.orders
  alter column table_id drop not null;

create index if not exists orders_source_mode_idx on public.orders (order_source, service_mode);

-- 2. Custom Item Flag on Order Items
alter table public.order_items
  add column if not exists is_custom boolean not null default false;

-- 3. Additional Metadata and Cancellation Fields on Bills
alter table public.bills
  add column if not exists order_source text not null default 'qr'
    check (order_source in ('qr', 'manual')),
  add column if not exists service_mode text not null default 'dine_in'
    check (service_mode in ('dine_in', 'takeaway', 'counter', 'delivery')),
  add column if not exists customer_name text,
  add column if not exists cancelled_at timestamptz default null,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text default null;

create index if not exists bills_status_idx on public.bills (status);
create index if not exists bills_order_source_idx on public.bills (order_source);
create index if not exists bills_issued_at_status_idx on public.bills (issued_at desc, status);

-- 4. Bill Audit Events Table
create table if not exists public.bill_audit_events (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  bill_number text not null,
  event_type text not null check (event_type in ('issued', 'reprinted', 'cancelled', 'viewed')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  actor_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bill_audit_events_bill_id_idx on public.bill_audit_events(bill_id);
create index if not exists bill_audit_events_bill_number_idx on public.bill_audit_events(bill_number);
create index if not exists bill_audit_events_created_at_idx on public.bill_audit_events(created_at desc);
create index if not exists bill_audit_events_event_type_idx on public.bill_audit_events(event_type);

grant select on public.bill_audit_events to authenticated;
grant insert on public.bill_audit_events to authenticated;
grant all on public.bill_audit_events to service_role;

alter table public.bill_audit_events enable row level security;

-- Policies for Bill Audit Events
drop policy if exists "staff read bill audit events" on public.bill_audit_events;
create policy "staff read bill audit events" on public.bill_audit_events
  for select using (public.is_staff());

drop policy if exists "staff insert bill audit events" on public.bill_audit_events;
create policy "staff insert bill audit events" on public.bill_audit_events
  for insert with check (public.is_staff());

drop policy if exists "admins manage bill audit events" on public.bill_audit_events;
create policy "admins manage bill audit events" on public.bill_audit_events
  for all using (public.is_admin()) with check (public.is_admin());

-- 5. Updated Atomic Bill Generation Function with Audit Logging & Manual Orders
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

  -- Re-check if another concurrent process generated the bill while waiting for lock
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

  -- 5. Read table details if table_id is set
  if v_order.table_id is not null then
    select * into v_table from public.cafe_tables where id = v_order.table_id;
    if found then
      v_table_number := v_table.table_number;
      v_table_label := v_table.label;
    end if;
  end if;

  -- Fallback table label based on service mode
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

  -- 6. Read current settings snapshot
  select * into v_settings from public.cafe_settings limit 1;
  if not found then
    v_settings := row(
      gen_random_uuid(), 'Urbania Café', null, null, '#a34d2d', 'Asia/Kolkata', now(), now(),
      'URBANIA CAFE AND JUICE BAR', '12226032000212', '2027-02-22'::date,
      '17/456, Chopasni Housing Board', 'Jodhpur', 'Rajasthan', '342008', false,
      null, null, 'unconfirmed', null, 'inclusive', 'UB-', null, 'Thank you for visiting Urbania Café!'
    )::public.cafe_settings;
  end if;

  -- Block tax-invoice generation until itemized GST engine is complete
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
        'note', oi.item_note,
        'is_custom', coalesce(oi.is_custom, false)
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

  -- 10. Mark order as billed
  update public.orders
  set billed_at = v_bill.issued_at
  where id = p_order_id;

  -- 11. Record 'issued' audit event
  if v_uid is not null then
    select role into v_actor_role from public.admin_profiles where user_id = v_uid limit 1;
    select email into v_actor_email from auth.users where id = v_uid limit 1;
  end if;

  insert into public.bill_audit_events (
    bill_id,
    bill_number,
    event_type,
    actor_id,
    actor_role,
    actor_email,
    metadata
  ) values (
    v_bill.id,
    v_bill.bill_number,
    'issued',
    v_uid,
    v_actor_role,
    v_actor_email,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'total_paise', v_bill.total_paise,
      'order_source', v_bill.order_source,
      'service_mode', v_bill.service_mode,
      'item_count', jsonb_array_length(v_items)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_issued', false,
    'bill', to_jsonb(v_bill)
  );
end $$;

-- 6. Helper Function: Record Bill Reprint Audit Event
create or replace function public.record_bill_reprint(
  p_bill_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_bill record;
  v_actor_role text;
  v_actor_email text;
  v_event_id uuid;
begin
  if not (public.is_staff() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'URB:forbidden';
  end if;

  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    raise exception 'URB:not_found';
  end if;

  if v_uid is not null then
    select role into v_actor_role from public.admin_profiles where user_id = v_uid limit 1;
    select email into v_actor_email from auth.users where id = v_uid limit 1;
  end if;

  insert into public.bill_audit_events (
    bill_id,
    bill_number,
    event_type,
    actor_id,
    actor_role,
    actor_email,
    metadata
  ) values (
    v_bill.id,
    v_bill.bill_number,
    'reprinted',
    v_uid,
    v_actor_role,
    v_actor_email,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'bill_number', v_bill.bill_number
  );
end $$;

grant execute on function public.record_bill_reprint(uuid, jsonb) to authenticated, service_role;

-- 7. Helper Function: Cancel / Void an Issued Bill
create or replace function public.cancel_bill(
  p_bill_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_bill record;
  v_actor_role text;
  v_actor_email text;
  v_clean_reason text := nullif(trim(p_reason), '');
begin
  if not (public.is_admin() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'URB:forbidden';
  end if;

  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then
    raise exception 'URB:not_found';
  end if;

  if v_bill.status = 'cancelled' then
    return jsonb_build_object(
      'ok', true,
      'already_cancelled', true,
      'bill', to_jsonb(v_bill)
    );
  end if;

  if v_uid is not null then
    select role into v_actor_role from public.admin_profiles where user_id = v_uid limit 1;
    select email into v_actor_email from auth.users where id = v_uid limit 1;
  end if;

  -- 1. Update bill status
  update public.bills
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_uid,
      cancellation_reason = left(v_clean_reason, 300),
      updated_at = now()
  where id = p_bill_id
  returning * into v_bill;

  -- 2. Update linked order to CANCELLED
  update public.orders
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancellation_reason = 'Bill ' || v_bill.bill_number || ' cancelled: ' || coalesce(left(v_clean_reason, 250), 'Admin voided')
  where id = v_bill.order_id;

  -- 3. Record 'cancelled' audit event
  insert into public.bill_audit_events (
    bill_id,
    bill_number,
    event_type,
    actor_id,
    actor_role,
    actor_email,
    metadata
  ) values (
    v_bill.id,
    v_bill.bill_number,
    'cancelled',
    v_uid,
    v_actor_role,
    v_actor_email,
    jsonb_build_object(
      'reason', v_clean_reason,
      'order_number', v_bill.order_number,
      'total_paise', v_bill.total_paise
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_cancelled', false,
    'bill', to_jsonb(v_bill)
  );
end $$;

grant execute on function public.cancel_bill(uuid, text) to authenticated, service_role;

-- 8. Atomic Server-Side Manual Order Creation Function
create or replace function public.create_manual_order(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_service_mode text;
  v_table_id uuid := null;
  v_table public.cafe_tables;
  v_guest_count int;
  v_customer_name text;
  v_customer_note text;
  v_items jsonb;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_options jsonb;
  v_option_total int;
  v_line_total int;
  v_total int := 0;
  v_order public.orders;
  v_idempotency_key uuid;
  v_is_custom boolean;
  v_custom_name text;
  v_custom_price int;
begin
  -- 1. Check authorization
  if not (public.is_staff() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'URB:forbidden';
  end if;

  -- 2. Validate payload structure
  v_service_mode := coalesce(p_payload->>'serviceMode', 'dine_in');
  if v_service_mode not in ('dine_in', 'takeaway', 'counter', 'delivery') then
    raise exception 'invalid service mode';
  end if;

  v_customer_name := nullif(left(trim(p_payload->>'customerName'), 60), '');
  v_customer_note := nullif(left(trim(p_payload->>'customerNote'), 300), '');
  v_guest_count := coalesce((p_payload->>'guestCount')::int, 1);
  if v_guest_count not between 1 and 20 then
    v_guest_count := 1;
  end if;

  if (p_payload->>'idempotencyKey') is not null then
    v_idempotency_key := (p_payload->>'idempotencyKey')::uuid;
  else
    v_idempotency_key := gen_random_uuid();
  end if;

  -- If dine_in, check table if provided
  if (p_payload->>'tableId') is not null then
    select * into v_table from public.cafe_tables where id = (p_payload->>'tableId')::uuid and is_active;
    if found then
      v_table_id := v_table.id;
    end if;
  end if;

  -- Idempotency check
  select * into v_order from public.orders where idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'status', v_order.status,
      'total_paise', v_order.total_paise
    );
  end if;

  v_items := coalesce(p_payload->'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 25 then
    raise exception 'invalid item count';
  end if;

  -- 3. Calculate line totals and validate items
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty not between 1 and 20 then
      raise exception 'invalid quantity';
    end if;

    v_is_custom := coalesce((v_item->>'isCustom')::boolean, false);

    if v_is_custom then
      v_custom_name := nullif(left(trim(v_item->>'name'), 100), '');
      if v_custom_name is null then
        raise exception 'custom item name required';
      end if;
      v_custom_price := (v_item->>'unitPricePaise')::int;
      if v_custom_price is null or v_custom_price < 0 then
        raise exception 'invalid custom price';
      end if;
      v_line_total := v_custom_price * v_qty;
    else
      select * into v_menu from public.menu_items
      where id = (v_item->>'menuItemId')::uuid and is_available;
      if not found then
        raise exception 'unavailable item';
      end if;

      select coalesce(
        jsonb_agg(jsonb_build_object('name', o.name, 'price_delta_paise', o.price_delta_paise)),
        '[]'::jsonb
      ), coalesce(sum(o.price_delta_paise), 0)
      into v_options, v_option_total
      from public.menu_item_options o
      where o.id in (select value::uuid from jsonb_array_elements_text(coalesce(v_item->'optionIds', '[]'::jsonb)))
        and o.menu_item_id = v_menu.id
        and o.is_available;

      v_line_total := (v_menu.price_paise + v_option_total) * v_qty;
    end if;

    v_total := v_total + v_line_total;
  end loop;

  -- 4. Insert order with status 'ACCEPTED'
  insert into public.orders (
    table_id,
    order_source,
    service_mode,
    status,
    customer_name,
    guest_count,
    customer_note,
    subtotal_paise,
    total_paise,
    idempotency_key,
    accepted_at
  ) values (
    v_table_id,
    'manual',
    v_service_mode,
    'ACCEPTED',
    coalesce(v_customer_name, case when v_service_mode = 'takeaway' then 'Takeaway Guest' else 'Walk-in Guest' end),
    v_guest_count,
    v_customer_note,
    v_total,
    v_total,
    v_idempotency_key,
    now()
  ) returning * into v_order;

  -- 5. Insert order items
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_qty := (v_item->>'quantity')::int;
    v_is_custom := coalesce((v_item->>'isCustom')::boolean, false);

    if v_is_custom then
      v_custom_name := left(trim(v_item->>'name'), 100);
      v_custom_price := (v_item->>'unitPricePaise')::int;
      insert into public.order_items (
        order_id,
        menu_item_id,
        item_name_snapshot,
        unit_price_paise,
        quantity,
        selected_options_snapshot,
        line_total_paise,
        item_note,
        is_custom
      ) values (
        v_order.id,
        null,
        v_custom_name,
        v_custom_price,
        v_qty,
        '[]'::jsonb,
        v_custom_price * v_qty,
        nullif(left(trim(v_item->>'note'), 180), ''),
        true
      );
    else
      select * into v_menu from public.menu_items where id = (v_item->>'menuItemId')::uuid;
      select coalesce(
        jsonb_agg(jsonb_build_object('name', o.name, 'price_delta_paise', o.price_delta_paise)),
        '[]'::jsonb
      ), coalesce(sum(o.price_delta_paise), 0)
      into v_options, v_option_total
      from public.menu_item_options o
      where o.id in (select value::uuid from jsonb_array_elements_text(coalesce(v_item->'optionIds', '[]'::jsonb)));

      insert into public.order_items (
        order_id,
        menu_item_id,
        item_name_snapshot,
        unit_price_paise,
        quantity,
        selected_options_snapshot,
        line_total_paise,
        item_note,
        is_custom
      ) values (
        v_order.id,
        v_menu.id,
        v_menu.name,
        v_menu.price_paise,
        v_qty,
        v_options,
        (v_menu.price_paise + v_option_total) * v_qty,
        nullif(left(trim(v_item->>'note'), 180), ''),
        false
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'service_mode', v_order.service_mode,
    'status', v_order.status,
    'total_paise', v_order.total_paise
  );
end $$;

grant execute on function public.create_manual_order(jsonb) to authenticated, service_role;
