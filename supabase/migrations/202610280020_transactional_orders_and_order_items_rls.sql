-- Migration 0020: Transactional Order Creation and Repeat Item Insert Restrictions
-- 1. Tightens public.order_items INSERT RLS policy to disallow appending extra items to existing orders via direct REST inserts.
-- 2. Adds public.create_external_platform_order(jsonb) for atomic transactional creation of Swiggy/Zomato orders and items.
-- 3. Adds public.create_admin_credit_order(jsonb) for atomic transactional creation of Admin Credit orders and items.

-- 1. Tighten Order Items INSERT Policy
-- Direct insertion is strictly limited to initial order creation for authorized channels.
-- It rejects direct insertion into orders that ALREADY have items (preventing repeat appends),
-- as well as ordinary customer orders, billed orders, cancelled orders, and completed orders.
drop policy if exists "staff and admins insert order items" on public.order_items;
create policy "staff and admins insert order items"
  on public.order_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.status not in ('CANCELLED', 'COMPLETED')
        and o.billed_at is null
        and not exists (
          select 1
          from public.bills b
          where b.order_id = o.id
            and b.status <> 'cancelled'
        )
        -- Disallow appending items to orders that already have items through direct REST insert
        and not exists (
          select 1
          from public.order_items existing
          where existing.order_id = order_items.order_id
        )
        and (
          -- Branch A: External delivery platform order items by staff or admins
          (
            public.is_staff()
            and o.order_source in ('swiggy', 'zomato', 'delivery_platform')
          )
          or
          -- Branch B: Admin credit order items by owners or admins
          (
            public.is_admin()
            and o.order_source = 'admin_credit'
          )
        )
    )
  );

-- 2. Transactional RPC: create_external_platform_order
-- Creates external delivery platform order (Swiggy, Zomato, delivery_platform) and all its line items
-- atomically in a single database transaction. Prevents incomplete orders.
create or replace function public.create_external_platform_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_order_source text;
  v_platform_name text;
  v_platform_ref text;
  v_customer_name text;
  v_customer_note text;
  v_guest_count int;
  v_idempotency_key uuid;
  v_items jsonb;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_options jsonb;
  v_option_total int;
  v_line_total int;
  v_total int := 0;
  v_order public.orders;
  v_is_custom boolean;
  v_custom_name text;
  v_custom_price int;
begin
  -- 1. Authorization: user must be staff, admin, owner, or service_role
  if not (public.is_staff() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'URB:forbidden';
  end if;

  -- 2. Validate payload structure
  v_order_source := coalesce(p_payload->>'orderSource', 'delivery_platform');
  if v_order_source not in ('swiggy', 'zomato', 'delivery_platform') then
    raise exception 'invalid platform order source';
  end if;

  v_platform_name := coalesce(
    nullif(trim(p_payload->>'externalPlatformName'), ''),
    case when v_order_source = 'swiggy' then 'Swiggy'
         when v_order_source = 'zomato' then 'Zomato'
         else 'Delivery Platform' end
  );
  v_platform_ref := nullif(trim(p_payload->>'externalPlatformRef'), '');

  v_customer_name := coalesce(
    nullif(left(trim(p_payload->>'customerName'), 60), ''),
    trim(v_platform_name || ' ' || coalesce(v_platform_ref, ''))
  );

  v_customer_note := coalesce(
    nullif(left(trim(p_payload->>'customerNote'), 300), ''),
    '[' || v_platform_name || '] External Delivery'
  );

  v_guest_count := coalesce((p_payload->>'guestCount')::int, 1);
  if v_guest_count not between 1 and 20 then
    v_guest_count := 1;
  end if;

  if (p_payload->>'idempotencyKey') is not null then
    v_idempotency_key := (p_payload->>'idempotencyKey')::uuid;
  else
    v_idempotency_key := gen_random_uuid();
  end if;

  -- Idempotency check: if order already exists with this idempotency key, return existing record
  select * into v_order from public.orders where idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'service_mode', v_order.service_mode,
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

  -- 4. Insert order with status 'ACCEPTED' and payment_status = 'external'
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
    accepted_at,
    payment_status,
    paid_paise,
    payment_method,
    external_platform_name,
    external_platform_ref
  ) values (
    null,
    v_order_source,
    'delivery',
    'ACCEPTED',
    v_customer_name,
    v_guest_count,
    v_customer_note,
    v_total,
    v_total,
    v_idempotency_key,
    now(),
    'external',
    0,
    null,
    v_platform_name,
    v_platform_ref
  ) returning * into v_order;

  -- 5. Insert order items in the same transaction
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
end;
$$;

-- 3. Transactional RPC: create_admin_credit_order
-- Creates admin credit consumption order and all its items atomically in a single database transaction.
-- Prevents incomplete orders and enforces admin role verification.
create or replace function public.create_admin_credit_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_admin_user_id uuid;
  v_admin_profile record;
  v_admin_name text;
  v_customer_note text;
  v_idempotency_key uuid;
  v_items jsonb;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_options jsonb;
  v_option_total int;
  v_line_total int;
  v_total int := 0;
  v_order public.orders;
  v_is_custom boolean;
  v_custom_name text;
  v_custom_price int;
begin
  -- 1. Authorization: user must be owner, admin, or service_role
  if not (public.is_admin() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'Admin access required';
  end if;

  -- 2. Validate target adminUserId belongs to an authorized admin or owner
  v_admin_user_id := (p_payload->>'adminUserId')::uuid;
  if v_admin_user_id is null then
    raise exception 'Valid admin user ID required';
  end if;

  select * into v_admin_profile
  from public.admin_profiles
  where user_id = v_admin_user_id and role in ('owner', 'admin');

  if not found then
    raise exception 'Selected user is not an authorized administrator or owner';
  end if;

  -- Attempt to get admin display name
  select coalesce(raw_user_meta_data->>'full_name', email, 'Admin')
  into v_admin_name
  from auth.users
  where id = v_admin_user_id;

  v_customer_note := coalesce(nullif(left(trim(p_payload->>'customerNote'), 300), ''), '[Admin Credit Consumption]');
  if not v_customer_note like '[Admin Credit]%' and not v_customer_note = '[Admin Credit Consumption]' then
    v_customer_note := '[Admin Credit] ' || v_customer_note;
  end if;

  if (p_payload->>'idempotencyKey') is not null then
    v_idempotency_key := (p_payload->>'idempotencyKey')::uuid;
  else
    v_idempotency_key := gen_random_uuid();
  end if;

  -- Idempotency check: if order already exists with this idempotency key, return existing record
  select * into v_order from public.orders where idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'admin_user_id', v_order.admin_user_id,
      'payment_status', v_order.payment_status,
      'total_paise', v_order.total_paise,
      'paid_paise', v_order.paid_paise
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

  -- 4. Insert order with status 'ACCEPTED' and payment_status = 'unpaid'
  insert into public.orders (
    table_id,
    order_source,
    service_mode,
    status,
    customer_name,
    admin_user_id,
    guest_count,
    customer_note,
    subtotal_paise,
    total_paise,
    idempotency_key,
    accepted_at,
    payment_status,
    paid_paise,
    payment_method
  ) values (
    null,
    'admin_credit',
    'dine_in',
    'ACCEPTED',
    'Admin: ' || coalesce(v_admin_name, 'Admin'),
    v_admin_user_id,
    1,
    v_customer_note,
    v_total,
    v_total,
    v_idempotency_key,
    now(),
    'unpaid',
    0,
    null
  ) returning * into v_order;

  -- 5. Insert order items in the same transaction
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
    'admin_user_id', v_order.admin_user_id,
    'payment_status', v_order.payment_status,
    'total_paise', v_order.total_paise,
    'paid_paise', v_order.paid_paise
  );
end;
$$;

grant execute on function public.create_external_platform_order(jsonb) to authenticated;
grant execute on function public.create_admin_credit_order(jsonb) to authenticated;
