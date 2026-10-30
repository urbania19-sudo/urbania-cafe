-- Urbania Café — Migration 0027: Role Helper & RPC Permission Hardening
-- Additive security hardening. No business data is rewritten.
-- Apply only after migrations 0016–0026 have been rehearsed on a disposable database.

begin;

-- 1. The application role source of truth is public.admin_profiles.
--    Never permit a caller to inspect another user's role through these helper RPCs.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or _user_id is distinct from auth.uid() then false
    when _role = 'admin'::public.app_role then exists (
      select 1
      from public.admin_profiles ap
      where ap.user_id = auth.uid()
        and ap.role in ('owner', 'admin')
    )
    when _role = 'kitchen'::public.app_role then exists (
      select 1
      from public.admin_profiles ap
      where ap.user_id = auth.uid()
        and ap.role = 'staff'
    )
    else false
  end;
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or _user_id is distinct from auth.uid() then false
    else exists (
      select 1
      from public.admin_profiles ap
      where ap.user_id = auth.uid()
        and ap.role in ('owner', 'admin', 'staff')
    )
  end;
$$;

-- 2. Keep anonymous menu browsing, but do not let anonymous sessions call has_role()
--    as a side-effect of the old mixed-role categories SELECT policy.
drop policy if exists "Public reads active categories" on public.categories;
drop policy if exists "Authenticated reads active categories" on public.categories;

create policy "Public reads active categories"
  on public.categories
  for select
  to anon
  using (is_active);

create policy "Authenticated reads active categories"
  on public.categories
  for select
  to authenticated
  using (is_active or public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. Staff/admin data policies must only run for authenticated sessions.
--    Anonymous public-menu policies remain unchanged.
alter policy "admins read profiles" on public.admin_profiles to authenticated;
alter policy "staff read own profile" on public.admin_profiles to authenticated;

alter policy "staff read bill audit events" on public.bill_audit_events to authenticated;

alter policy "admins manage bills" on public.bills to authenticated;
alter policy "staff read bills" on public.bills to authenticated;

alter policy "admins manage settings" on public.cafe_settings to authenticated;
alter policy "staff read settings" on public.cafe_settings to authenticated;

alter policy "admins manage tables" on public.cafe_tables to authenticated;
alter policy "staff read tables" on public.cafe_tables to authenticated;

alter policy "admins manage categories" on public.menu_categories to authenticated;
alter policy "admins manage options" on public.menu_item_options to authenticated;
alter policy "admins manage items" on public.menu_items to authenticated;

alter policy "admins read order items" on public.order_items to authenticated;
alter policy "staff read order items" on public.order_items to authenticated;

alter policy "staff and admins insert kitchen tickets" on public.order_kitchen_tickets to authenticated;
alter policy "staff and admins read kitchen tickets" on public.order_kitchen_tickets to authenticated;

alter policy "admins read orders" on public.orders to authenticated;
alter policy "admins update orders" on public.orders to authenticated;
alter policy "staff read orders" on public.orders to authenticated;

-- 4. Revoke default PUBLIC/anon execution from identity-aware role helpers.
--    The zero-argument helpers remain available to authenticated RLS policies and server RPCs.
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

revoke all on function public.is_staff(uuid) from public, anon;
grant execute on function public.is_staff(uuid) to authenticated, service_role;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

-- 5. Restrict staff/admin RPCs. Their function bodies still perform their own role checks.
revoke all on function public.cancel_bill(uuid, text) from public, anon;
grant execute on function public.cancel_bill(uuid, text) to authenticated, service_role;

revoke all on function public.create_manual_order(jsonb) from public, anon;
grant execute on function public.create_manual_order(jsonb) to authenticated, service_role;

revoke all on function public.edit_order_items(uuid, jsonb) from public, anon;
grant execute on function public.edit_order_items(uuid, jsonb) to authenticated, service_role;

revoke all on function public.get_bill_for_order(uuid) from public, anon;
grant execute on function public.get_bill_for_order(uuid) to authenticated, service_role;

revoke all on function public.record_bill_reprint(uuid, jsonb) from public, anon;
grant execute on function public.record_bill_reprint(uuid, jsonb) to authenticated, service_role;

revoke all on function public.update_staff_order_status(uuid, public.order_status, text) from public, anon;
grant execute on function public.update_staff_order_status(uuid, public.order_status, text) to authenticated, service_role;

-- Re-assert the restrictions established in migrations 0022/0023 and later RPC additions.
revoke all on function public.order_has_items(uuid) from public, anon;
grant execute on function public.order_has_items(uuid) to authenticated, service_role;

revoke all on function public.create_external_platform_order(jsonb) from public, anon;
grant execute on function public.create_external_platform_order(jsonb) to authenticated, service_role;

revoke all on function public.create_admin_credit_order(jsonb) from public, anon;
grant execute on function public.create_admin_credit_order(jsonb) to authenticated, service_role;

revoke all on function public.record_customer_payment(uuid, integer, text, text, text) from public, anon;
grant execute on function public.record_customer_payment(uuid, integer, text, text, text) to authenticated, service_role;

revoke all on function public.settle_admin_credit_payment(uuid, integer, text, text) from public, anon;
grant execute on function public.settle_admin_credit_payment(uuid, integer, text, text) to authenticated, service_role;

-- 6. Trigger/event-trigger entry points are not application RPCs.
--    PostgreSQL does not check EXECUTE privileges when firing an attached trigger.
revoke all on function public.log_order_status() from public, anon, authenticated, service_role;
revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;

-- 7. Explicitly document the intentionally public QR functions. Their table/public-token
--    validation remains inside the functions. Do not revoke these customer-facing RPCs.
grant execute on function public.place_public_order(jsonb) to anon, authenticated, service_role;
grant execute on function public.get_order_status(uuid, text) to anon, authenticated, service_role;
grant execute on function public.get_table_by_token(text) to anon, authenticated, service_role;

commit;
