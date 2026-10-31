-- Migration 0025: Admin Credit Order Idempotency Enforcement
-- Enforces mandatory, valid UUID idempotency keys for public.create_admin_credit_order(jsonb).
-- Rejects missing or malformed keys, serializes concurrent retries safely via advisory locking,
-- guards against conflicting idempotency re-plays, and returns existing orders cleanly on duplicate calls.

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
  v_raw_idempotency_key text;
  v_idempotency_key uuid;
  v_items jsonb;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_raw_option_ids jsonb;
  v_req_option_count int;
  v_matched_option_count int;
  v_options jsonb;
  v_option_total int;
  v_line_total int;
  v_total int := 0;
  v_validated_items jsonb := '[]'::jsonb;
  v_val_item jsonb;
  v_order public.orders;
  v_is_custom boolean;
  v_custom_name text;
  v_custom_price int;
begin
  -- 1. Authorization: user must be owner, admin, or service_role
  if not (public.is_admin() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'Admin access required';
  end if;

  -- 2. Validate idempotencyKey: must be present and a valid UUID
  v_raw_idempotency_key := nullif(trim(p_payload->>'idempotencyKey'), '');
  if v_raw_idempotency_key is null then
    raise exception 'Valid idempotency key required';
  end if;

  begin
    v_idempotency_key := v_raw_idempotency_key::uuid;
  exception when others then
    raise exception 'Valid idempotency key required';
  end;

  -- Serialize concurrent requests using the same idempotency key to prevent race conditions
  perform pg_advisory_xact_lock(hashtext(v_idempotency_key::text));

  -- 3. Validate target adminUserId belongs to an authorized admin or owner
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

  -- 4. Idempotency check: if order already exists with this idempotency key, return existing record
  select * into v_order from public.orders where idempotency_key = v_idempotency_key;
  if found then
    -- Check for conflicting payload: key must not be replayed for a different admin or non-admin channel
    if v_order.admin_user_id <> v_admin_user_id or v_order.order_source <> 'admin_credit' then
      raise exception 'URB:idempotency_conflict';
    end if;

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

  select coalesce(raw_user_meta_data->>'full_name', email, 'Admin')
  into v_admin_name
  from auth.users
  where id = v_admin_user_id;

  v_customer_note := coalesce(nullif(left(trim(p_payload->>'customerNote'), 300), ''), '[Admin Credit Consumption]');
  if not v_customer_note like '[Admin Credit]%' and not v_customer_note = '[Admin Credit Consumption]' then
    v_customer_note := '[Admin Credit] ' || v_customer_note;
  end if;

  v_items := coalesce(p_payload->'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 25 then
    raise exception 'invalid item count';
  end if;

  -- 5. Validate items and options once, build validated item snapshots and compute total
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

      v_validated_items := v_validated_items || jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', null,
          'item_name_snapshot', v_custom_name,
          'unit_price_paise', v_custom_price,
          'quantity', v_qty,
          'selected_options_snapshot', '[]'::jsonb,
          'line_total_paise', v_line_total,
          'item_note', nullif(left(trim(v_item->>'note'), 180), ''),
          'is_custom', true
        )
      );
    else
      if (v_item->>'menuItemId') is null then
        raise exception 'unavailable item';
      end if;

      select * into v_menu from public.menu_items
      where id = (v_item->>'menuItemId')::uuid and is_available;
      if not found then
        raise exception 'unavailable item';
      end if;

      v_raw_option_ids := coalesce(v_item->'optionIds', '[]'::jsonb);
      if jsonb_typeof(v_raw_option_ids) <> 'array' then
        raise exception 'invalid option format';
      end if;

      v_req_option_count := jsonb_array_length(v_raw_option_ids);
      if v_req_option_count > 10 then
        raise exception 'too many options selected';
      end if;

      if v_req_option_count = 0 then
        v_options := '[]'::jsonb;
        v_option_total := 0;
      else
        -- Validate every option: must exist, belong to this menu item, be available, and have no duplicates
        select
          coalesce(
            jsonb_agg(
              jsonb_build_object('name', o.name, 'price_delta_paise', o.price_delta_paise)
              order by o.sort_order, o.name
            ),
            '[]'::jsonb
          ),
          coalesce(sum(o.price_delta_paise), 0),
          count(*)
        into v_options, v_option_total, v_matched_option_count
        from (
          select distinct value::uuid as opt_id
          from jsonb_array_elements_text(v_raw_option_ids)
        ) req
        join public.menu_item_options o
          on o.id = req.opt_id
         and o.menu_item_id = v_menu.id
         and o.is_available;

        if v_matched_option_count <> v_req_option_count then
          if exists (
            select 1 from jsonb_array_elements_text(v_raw_option_ids) t(id_text)
            join public.menu_item_options o on o.id = t.id_text::uuid
            where o.menu_item_id <> v_menu.id
          ) then
            raise exception 'invalid option: option does not belong to selected menu item';
          end if;

          if exists (
            select 1 from jsonb_array_elements_text(v_raw_option_ids) t(id_text)
            join public.menu_item_options o on o.id = t.id_text::uuid
            where o.menu_item_id = v_menu.id and not o.is_available
          ) then
            raise exception 'unavailable option: selected option is not available';
          end if;

          raise exception 'invalid option';
        end if;
      end if;

      v_line_total := (v_menu.price_paise + v_option_total) * v_qty;

      v_validated_items := v_validated_items || jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', v_menu.id,
          'item_name_snapshot', v_menu.name,
          'unit_price_paise', v_menu.price_paise,
          'quantity', v_qty,
          'selected_options_snapshot', v_options,
          'line_total_paise', v_line_total,
          'item_note', nullif(left(trim(v_item->>'note'), 180), ''),
          'is_custom', false
        )
      );
    end if;

    v_total := v_total + v_line_total;
  end loop;

  -- 6. Insert order with status 'ACCEPTED' and payment_status = 'unpaid'
  begin
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
  exception when unique_violation then
    -- Concurrent insertion with same key completed simultaneously
    select * into v_order from public.orders where idempotency_key = v_idempotency_key;
    if found then
      if v_order.admin_user_id <> v_admin_user_id or v_order.order_source <> 'admin_credit' then
        raise exception 'URB:idempotency_conflict';
      end if;

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
    raise;
  end;

  -- 7. Insert order items directly from pre-computed validated items
  for v_val_item in select * from jsonb_array_elements(v_validated_items) loop
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
      (v_val_item->>'menu_item_id')::uuid,
      v_val_item->>'item_name_snapshot',
      (v_val_item->>'unit_price_paise')::int,
      (v_val_item->>'quantity')::int,
      coalesce(v_val_item->'selected_options_snapshot', '[]'::jsonb),
      (v_val_item->>'line_total_paise')::int,
      v_val_item->>'item_note',
      (v_val_item->>'is_custom')::boolean
    );
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

-- 8. Execution privilege restrictions (authenticated and service_role only)
revoke execute on function public.create_admin_credit_order(jsonb) from public;
revoke execute on function public.create_admin_credit_order(jsonb) from anon;
grant execute on function public.create_admin_credit_order(jsonb) to authenticated;
grant execute on function public.create_admin_credit_order(jsonb) to service_role;
