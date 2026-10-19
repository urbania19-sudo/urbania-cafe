-- Idempotent: re-applies staff access so /staff can load orders. Safe to run more than once.
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.admin_profiles where user_id=auth.uid() and role in ('owner','admin','staff'))
$$;
drop policy if exists "staff read orders" on public.orders;
create policy "staff read orders" on public.orders for select using(public.is_staff());
drop policy if exists "staff read order items" on public.order_items;
create policy "staff read order items" on public.order_items for select using(public.is_staff());
drop policy if exists "staff read own profile" on public.admin_profiles;
create policy "staff read own profile" on public.admin_profiles for select using (user_id = auth.uid());
drop policy if exists "staff read tables" on public.cafe_tables;
create policy "staff read tables" on public.cafe_tables for select using (public.is_staff());
grant execute on function public.is_staff() to authenticated;
grant execute on function public.update_staff_order_status(uuid,public.order_status,text) to authenticated;
grant select on public.orders, public.order_items, public.cafe_tables, public.admin_profiles to authenticated;
