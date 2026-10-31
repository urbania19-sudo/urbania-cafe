-- Urbania Café — Migration 0013: Custom Items in Order Editing
-- Additive only. Fully backward compatible with existing schema.
-- Enhances public.edit_order_items() to support adding custom, non-catalogue dishes
-- (name, unit price, quantity, special notes) alongside catalogue items.

create or replace function public.edit_order_items(
  p_order_id uuid,
  p_items jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_unit_price int;
  v_line_total int;
  v_new_items_total int := 0;
  v_custom_total int := 0;
  v_seen_menu_ids uuid[] := '{}';
  v_new_item_ids uuid[] := '{}';
  v_new_id uuid;
  v_old_catalogue_ids uuid[];
  v_existing_price int;
  v_existing_options jsonb;
  v_existing_note text;
  v_is_custom boolean;
  v_custom_name text;
  v_note text;
  v_has_custom_support boolean := false;
begin
  -- 1. Enforce authenticated staff or admin role
  if not exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role in ('owner', 'admin', 'staff')
  ) then
    raise exception 'Unauthorized: staff or admin role required';
  end if;

  -- 2. Lock the order row to prevent concurrent edits or status updates
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  -- 3. Reject edits to completed or cancelled orders
  if v_order.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'Order cannot be edited in % status', v_order.status;
  end if;

  -- 4. Reject edits to already-billed orders
  if v_order.billed_at is not null then
    raise exception 'Order has already been billed and cannot be edited';
  end if;

  if exists (
    select 1
    from public.bills
    where order_id = p_order_id
      and status <> 'cancelled'
  ) then
    raise exception 'Order has an active bill and cannot be edited';
  end if;

  -- 5. Validate item list structure
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 25 then
    raise exception 'Order must contain between 1 and 25 items';
  end if;

  -- 6. Detect if payload explicitly includes custom item fields
  select exists (
    select 1
    from jsonb_array_elements(p_items) elem
    where (elem ? 'isCustom')
       or (elem ? 'unitPricePaise')
       or (elem ? 'unitPriceRupees')
       or (elem->>'menuItemId' is null)
  ) into v_has_custom_support;

  if not v_has_custom_support then
    -- Legacy compatibility mode: identify existing catalogue items
    v_old_catalogue_ids := array(
      select id
      from public.order_items
      where order_id = p_order_id
        and is_custom = false
        and menu_item_id is not null
    );

    -- Sum existing custom line items to preserve them without dropping
    select coalesce(sum(line_total_paise), 0)
    into v_custom_total
    from public.order_items
    where order_id = p_order_id
      and (is_custom = true or menu_item_id is null);
  end if;

  -- 7. Validate and insert new items
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'Item quantity must be between 1 and 20';
    end if;

    v_is_custom := coalesce((v_item->>'isCustom')::boolean, (v_item->>'menuItemId') is null);

    if v_is_custom then
      v_custom_name := nullif(left(trim(v_item->>'name'), 100), '');
      if v_custom_name is null then
        raise exception 'custom item name required';
      end if;

      v_unit_price := coalesce(
        (v_item->>'unitPricePaise')::int,
        round(((v_item->>'unitPriceRupees')::numeric) * 100)::int
      );
      if v_unit_price is null or v_unit_price < 0 then
        raise exception 'invalid custom price';
      end if;

      v_line_total := v_unit_price * v_qty;
      v_note := nullif(left(trim(v_item->>'note'), 180), '');

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
        p_order_id,
        null,
        v_custom_name,
        v_unit_price,
        v_qty,
        '[]'::jsonb,
        v_line_total,
        v_note,
        true
      )
      returning id into v_new_id;

      v_new_item_ids := v_new_item_ids || v_new_id;
      v_new_items_total := v_new_items_total + v_line_total;
    else
      -- Catalogue item
      select * into v_menu
      from public.menu_items
      where id = (v_item->>'menuItemId')::uuid;

      if not found then
        raise exception 'Menu item not found: %', (v_item->>'menuItemId');
      end if;

      -- Prevent duplicate line items for the same menu item ID
      if v_menu.id = any(v_seen_menu_ids) then
        raise exception 'Duplicate item in order edit: %', v_menu.name;
      end if;
      v_seen_menu_ids := v_seen_menu_ids || v_menu.id;

      -- Check if item was already on the order to preserve snapshot price, options, and notes
      v_existing_price := null;
      v_existing_options := '[]'::jsonb;
      v_existing_note := null;

      select unit_price_paise, selected_options_snapshot, item_note
      into v_existing_price, v_existing_options, v_existing_note
      from public.order_items
      where order_id = p_order_id
        and menu_item_id = v_menu.id
      limit 1;

      if v_existing_price is not null then
        v_unit_price := v_existing_price;
      else
        -- Newly added item during edit: check availability and use trusted database price
        if not v_menu.is_available then
          raise exception 'Item "%" is currently unavailable', v_menu.name;
        end if;
        v_unit_price := v_menu.price_paise;
      end if;

      v_note := coalesce(nullif(left(trim(v_item->>'note'), 180), ''), v_existing_note);
      v_line_total := v_unit_price * v_qty;

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
        p_order_id,
        v_menu.id,
        v_menu.name,
        v_unit_price,
        v_qty,
        coalesce(v_existing_options, '[]'::jsonb),
        v_line_total,
        v_note,
        false
      )
      returning id into v_new_id;

      v_new_item_ids := v_new_item_ids || v_new_id;
      v_new_items_total := v_new_items_total + v_line_total;
    end if;
  end loop;

  -- 8. Delete old items that were replaced
  if v_has_custom_support then
    delete from public.order_items
    where order_id = p_order_id
      and not (id = any(v_new_item_ids));
  else
    if array_length(v_old_catalogue_ids, 1) > 0 then
      delete from public.order_items
      where id = any(v_old_catalogue_ids);
    end if;
    v_new_items_total := v_new_items_total + v_custom_total;
  end if;

  -- 9. Atomically recalculate and update order totals
  update public.orders
  set
    subtotal_paise = v_new_items_total,
    total_paise = v_new_items_total
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;

revoke all on function public.edit_order_items(uuid, jsonb) from public;
grant execute on function public.edit_order_items(uuid, jsonb) to authenticated;
