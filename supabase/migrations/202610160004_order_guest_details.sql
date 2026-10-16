alter table public.orders add column if not exists guest_count smallint check (guest_count between 1 and 20);
update public.orders set guest_count = 1 where guest_count is null;
alter table public.orders alter column guest_count set default 1;
alter table public.orders alter column guest_count set not null;

create or replace function public.place_public_order(p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_table public.cafe_tables;
  v_order public.orders;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_guest_count int;
  v_options jsonb;
  v_option_total int;
  v_total int := 0;
  v_line int;
begin
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb)) not between 1 and 25 then raise exception 'invalid item count'; end if;
  v_guest_count := (p_payload->>'guestCount')::int;
  if v_guest_count is null or v_guest_count not between 1 and 20 then raise exception 'invalid guest count'; end if;
  if nullif(left(p_payload->>'customerName',60),'') is null then raise exception 'customer name is required'; end if;
  select * into v_table from cafe_tables where qr_token=(p_payload->>'tableToken')::uuid and is_active;
  if not found then raise exception 'invalid table'; end if;
  select * into v_order from orders where idempotency_key=(p_payload->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('order_number',v_order.order_number,'table_label',v_table.label,'status',v_order.status,'total_paise',v_order.total_paise); end if;
  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty not between 1 and 20 then raise exception 'invalid quantity'; end if;
    select * into v_menu from menu_items where id=(v_item->>'menuItemId')::uuid and is_available;
    if not found then raise exception 'unavailable item'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('name',o.name,'price_delta_paise',o.price_delta_paise)),'[]'::jsonb),coalesce(sum(o.price_delta_paise),0)
      into v_options,v_option_total
      from menu_item_options o
      where o.id in(select value::uuid from jsonb_array_elements_text(coalesce(v_item->'optionIds','[]'::jsonb))) and o.menu_item_id=v_menu.id and o.is_available;
    if jsonb_array_length(v_options)<>jsonb_array_length(coalesce(v_item->'optionIds','[]'::jsonb)) then raise exception 'invalid option'; end if;
    v_line := (v_menu.price_paise+v_option_total)*v_qty;
    v_total := v_total+v_line;
  end loop;
  insert into orders(table_id,customer_name,guest_count,customer_note,subtotal_paise,total_paise,idempotency_key)
    values(v_table.id,nullif(left(p_payload->>'customerName',60),''),v_guest_count,nullif(left(p_payload->>'customerNote',300),''),v_total,v_total,(p_payload->>'idempotencyKey')::uuid)
    returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
    select * into v_menu from menu_items where id=(v_item->>'menuItemId')::uuid;
    v_qty := (v_item->>'quantity')::int;
    select coalesce(jsonb_agg(jsonb_build_object('name',o.name,'price_delta_paise',o.price_delta_paise)),'[]'::jsonb),coalesce(sum(o.price_delta_paise),0)
      into v_options,v_option_total
      from menu_item_options o
      where o.id in(select value::uuid from jsonb_array_elements_text(coalesce(v_item->'optionIds','[]'::jsonb)));
    insert into order_items(order_id,menu_item_id,item_name_snapshot,unit_price_paise,quantity,selected_options_snapshot,line_total_paise,item_note)
      values(v_order.id,v_menu.id,v_menu.name,v_menu.price_paise,v_qty,v_options,(v_menu.price_paise+v_option_total)*v_qty,nullif(left(v_item->>'note',180),''));
  end loop;
  return jsonb_build_object('order_number',v_order.order_number,'table_label',v_table.label,'status',v_order.status,'total_paise',v_order.total_paise);
end $$;

revoke all on function public.place_public_order(jsonb) from public;
grant execute on function public.place_public_order(jsonb) to service_role;
