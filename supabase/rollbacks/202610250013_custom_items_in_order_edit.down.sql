-- Urbania Café — Migration 0013 Down: Restore edit_order_items to Migration 0011 definition
-- Reverts custom items in edit_order_items and restores 0011 behavior.

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
  v_new_catalogue_total int := 0;
  v_custom_total int := 0;
  v_final_total int := 0;
  v_seen_menu_ids uuid[] := '{}';
  v_old_catalogue_ids uuid[];
  v_existing_price int;
  v_existing_options jsonb;
  v_existing_note text;
begin
  if not exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role in ('owner', 'admin', 'staff')
  ) then
    raise exception 'Unauthorized: staff or admin role required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'Order cannot be edited in % status', v_order.status;
  end if;

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

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 25 then
    raise exception 'Order must contain between 1 and 25 items';
  end if;

  v_old_catalogue_ids := array(
    select id
    from public.order_items
    where order_id = p_order_id
      and is_custom = false
      and menu_item_id is not null
  );

  select coalesce(sum(line_total_paise), 0)
  into v_custom_total
  from public.order_items
  where order_id = p_order_id
    and (is_custom = true or menu_item_id is null);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'Item quantity must be between 1 and 20';
    end if;

    select * into v_menu
    from public.menu_items
    where id = (v_item->>'menuItemId')::uuid;

    if not found then
      raise exception 'Menu item not found: %', (v_item->>'menuItemId');
    end if;

    if v_menu.id = any(v_seen_menu_ids) then
      raise exception 'Duplicate item in order edit: %', v_menu.name;
    end if;
    v_seen_menu_ids := v_seen_menu_ids || v_menu.id;

    v_existing_price := null;
    v_existing_options := '[]'::jsonb;
    v_existing_note := null;

    select unit_price_paise, selected_options_snapshot, item_note
    into v_existing_price, v_existing_options, v_existing_note
    from public.order_items
    where order_id = p_order_id
      and menu_item_id = v_menu.id
      and id = any(v_old_catalogue_ids)
    limit 1;

    if v_existing_price is not null then
      v_unit_price := v_existing_price;
    else
      if not v_menu.is_available then
        raise exception 'Item "%" is currently unavailable', v_menu.name;
      end if;
      v_unit_price := v_menu.price_paise;
    end if;

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
      v_unit_price * v_qty,
      v_existing_note,
      false
    );

    v_new_catalogue_total := v_new_catalogue_total + (v_unit_price * v_qty);
  end loop;

  if array_length(v_old_catalogue_ids, 1) > 0 then
    delete from public.order_items
    where id = any(v_old_catalogue_ids);
  end if;

  v_final_total := v_new_catalogue_total + v_custom_total;

  update public.orders
  set
    subtotal_paise = v_final_total,
    total_paise = v_final_total
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;

revoke all on function public.edit_order_items(uuid, jsonb) from public;
grant execute on function public.edit_order_items(uuid, jsonb) to authenticated;
