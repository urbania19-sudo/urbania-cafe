-- Staff accounts are created by an owner in Supabase Auth, then explicitly assigned here.
alter table public.admin_profiles drop constraint admin_profiles_role_check;
alter table public.admin_profiles add constraint admin_profiles_role_check check(role in ('owner','admin','staff'));

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.admin_profiles where user_id=auth.uid() and role in ('owner','admin','staff'))
$$;
create policy "staff read orders" on public.orders for select using(public.is_staff());
create policy "staff read order items" on public.order_items for select using(public.is_staff());

create function public.update_staff_order_status(p_order_id uuid,p_next public.order_status,p_cancel_reason text default null) returns public.orders language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders; v_role text;
begin
 select role into v_role from public.admin_profiles where user_id=auth.uid();
 if v_role is null then raise exception 'forbidden'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found then raise exception 'order not found'; end if;
 if (v_order.status,p_next) not in (('NEW','ACCEPTED'),('ACCEPTED','PREPARING'),('PREPARING','READY'),('READY','COMPLETED'),('NEW','CANCELLED'),('ACCEPTED','CANCELLED'),('PREPARING','CANCELLED')) then raise exception 'invalid transition'; end if;
 if p_next='CANCELLED' and v_role not in ('owner','admin') then raise exception 'admin only'; end if;
 update public.orders set status=p_next,accepted_at=case when p_next='ACCEPTED' then now() else accepted_at end,completed_at=case when p_next='COMPLETED' then now() else completed_at end,cancelled_at=case when p_next='CANCELLED' then now() else cancelled_at end,cancellation_reason=case when p_next='CANCELLED' then left(p_cancel_reason,300) else cancellation_reason end where id=p_order_id returning * into v_order;
 return v_order;
end $$;
grant execute on function public.update_staff_order_status(uuid,public.order_status,text) to authenticated;
