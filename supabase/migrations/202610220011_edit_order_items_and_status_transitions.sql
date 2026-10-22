-- Urbania Café — Migration 0011: Safe Order Item Editing and Direct Status Transitions
-- Additive only. Fully backward compatible with existing schema.

-- 1. Function to safely edit order items
-- Validates caller permissions, locks order, rejects billed/completed orders,
-- preserves custom items & options, uses trusted prices, and recalculates totals atomically.
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
  -- Enforce authenticated staff or admin role
  if not exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role in ('owner', 'admin', 'staff')
  ) then
    raise exception 'Unauthorized: staff or admin role required';
  end if;

  -- Lock the order row to prevent concurrent edits or status updates
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  -- Reject edits to completed or cancelled orders
  if v_order.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'Order cannot be edited in % status', v_order.status;
  end if;

  -- Reject edits to already-billed orders
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

  -- Validate item list structure
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 25 then
    raise exception 'Order must contain between 1 and 25 items';
  end if;

  -- Identify existing catalogue order items (which will be replaced by the edited list)
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

  -- Validate and insert the updated catalogue items
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
      and id = any(v_old_catalogue_ids)
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

  -- Delete the old catalogue items that were replaced
  if array_length(v_old_catalogue_ids, 1) > 0 then
    delete from public.order_items
    where id = any(v_old_catalogue_ids);
  end if;

  -- Recalculate total combining new catalogue items and preserved custom items
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


-- 2. Enhanced update_staff_order_status with direct ACCEPTED -> COMPLETED support and idempotency
create or replace function public.update_staff_order_status(
  p_order_id uuid,
  p_next public.order_status,
  p_cancel_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_role text;
begin
  select role into v_role
  from public.admin_profiles
  where user_id = auth.uid();

  if v_role is null or v_role not in ('owner', 'admin', 'staff') then
    raise exception 'Unauthorized: staff or admin permissions required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  -- Idempotency: if already in the target status, return cleanly without error
  if v_order.status = p_next then
    return v_order;
  end if;

  -- Allowed status transitions:
  -- Supports both simplified staff workflow (NEW -> ACCEPTED -> COMPLETED)
  -- and legacy intermediate workflows (ACCEPTED -> PREPARING -> READY -> COMPLETED)
  if (v_order.status, p_next) not in (
    ('NEW', 'ACCEPTED'),
    ('ACCEPTED', 'COMPLETED'),
    ('ACCEPTED', 'PREPARING'),
    ('PREPARING', 'READY'),
    ('READY', 'COMPLETED'),
    ('PREPARING', 'COMPLETED'),
    ('NEW', 'CANCELLED'),
    ('ACCEPTED', 'CANCELLED'),
    ('PREPARING', 'CANCELLED')
  ) then
    raise exception 'Invalid order status transition from % to %', v_order.status, p_next;
  end if;

  if p_next = 'CANCELLED' and v_order.status <> 'NEW' and v_role not in ('owner', 'admin') then
    raise exception 'Only administrators or owners can cancel an accepted or in-progress order';
  end if;

  update public.orders
  set
    status = p_next,
    accepted_at = case when p_next = 'ACCEPTED' and accepted_at is null then now() else accepted_at end,
    completed_at = case when p_next = 'COMPLETED' then now() else completed_at end,
    cancelled_at = case when p_next = 'CANCELLED' then now() else cancelled_at end,
    cancellation_reason = case when p_next = 'CANCELLED' then left(p_cancel_reason, 300) else cancellation_reason end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;

revoke all on function public.update_staff_order_status(uuid, public.order_status, text) from public;
grant execute on function public.update_staff_order_status(uuid, public.order_status, text) to authenticated;
