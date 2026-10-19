-- Staff may reject an order that is still NEW; owners/admins may cancel until READY.
create or replace function public.update_staff_order_status(p_order_id uuid,p_next public.order_status,p_cancel_reason text default null) returns public.orders language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders; v_role text;
begin
 select role into v_role from public.admin_profiles where user_id=auth.uid();
 if v_role is null then raise exception 'forbidden'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found then raise exception 'order not found'; end if;
 if (v_order.status,p_next) not in (('NEW','ACCEPTED'),('ACCEPTED','PREPARING'),('PREPARING','READY'),('READY','COMPLETED'),('NEW','CANCELLED'),('ACCEPTED','CANCELLED'),('PREPARING','CANCELLED')) then raise exception 'invalid transition'; end if;
 if p_next='CANCELLED' and v_order.status<>'NEW' and v_role not in ('owner','admin') then raise exception 'admin only'; end if;
 update public.orders set status=p_next,accepted_at=case when p_next='ACCEPTED' then now() else accepted_at end,completed_at=case when p_next='COMPLETED' then now() else completed_at end,cancelled_at=case when p_next='CANCELLED' then now() else cancelled_at end,cancellation_reason=case when p_next='CANCELLED' then left(p_cancel_reason,300) else cancellation_reason end where id=p_order_id returning * into v_order;
 return v_order;
end $$;

-- Staff edit the items of an order until it is READY. Items already on the order keep their original price.
create or replace function public.edit_order_items(p_order_id uuid,p_items jsonb) returns public.orders language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders; v_item jsonb; v_menu public.menu_items; v_qty int; v_old uuid[]; v_price int; v_total int:=0; v_ids uuid[]:='{}';
begin
 if not exists(select 1 from public.admin_profiles where user_id=auth.uid()) then raise exception 'forbidden'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found then raise exception 'order not found'; end if;
 if v_order.status not in ('NEW','ACCEPTED','PREPARING') then raise exception 'order can no longer be edited'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 25 then raise exception 'invalid item count'; end if;
 v_old:=array(select id from public.order_items where order_id=p_order_id);
 for v_item in select * from jsonb_array_elements(p_items) loop
  v_qty:=(v_item->>'quantity')::int; if v_qty not between 1 and 20 then raise exception 'invalid quantity'; end if;
  select * into v_menu from public.menu_items where id=(v_item->>'menuItemId')::uuid; if not found then raise exception 'unknown item'; end if;
  if v_menu.id=any(v_ids) then raise exception 'duplicate item'; end if; v_ids:=v_ids||v_menu.id;
  v_price:=null;
  select unit_price_paise into v_price from public.order_items where order_id=p_order_id and menu_item_id=v_menu.id and id=any(v_old) limit 1;
  if v_price is null then if not v_menu.is_available then raise exception 'unavailable item'; end if; v_price:=v_menu.price_paise; end if;
  insert into public.order_items(order_id,menu_item_id,item_name_snapshot,unit_price_paise,quantity,line_total_paise) values(p_order_id,v_menu.id,v_menu.name,v_price,v_qty,v_price*v_qty);
  v_total:=v_total+v_price*v_qty;
 end loop;
 delete from public.order_items where id=any(v_old);
 update public.orders set subtotal_paise=v_total,total_paise=v_total where id=p_order_id returning * into v_order;
 return v_order;
end $$;
revoke all on function public.edit_order_items(uuid,jsonb) from public;
grant execute on function public.edit_order_items(uuid,jsonb) to authenticated;
