-- Migration 0027: Harden exposed SECURITY DEFINER RPC execution privileges.
--
-- The production advisor found privileged SECURITY DEFINER routines inheriting EXECUTE
-- for anon from broad default privileges. This migration narrows the Data API surface,
-- preserves intentionally public token-based QR endpoints, and protects existing RLS.
--
-- Privilege/policy changes only. No application financial or order data is modified.

begin;

-- 1. Narrow internal-data RLS policies to authenticated users.
-- These policies were previously TO PUBLIC and used zero-argument role helpers.
-- Anonymous access already evaluated to false; making the role explicit preserves
-- authenticated staff/admin access while removing anon's need to execute those helpers.
drop policy if exists "admins read profiles" on public.admin_profiles;
create policy "admins read profiles"
  on public.admin_profiles for select to authenticated
  using (public.is_admin());

drop policy if exists "staff read bill audit events" on public.bill_audit_events;
create policy "staff read bill audit events"
  on public.bill_audit_events for select to authenticated
  using (public.is_staff());

drop policy if exists "admins manage bills" on public.bills;
create policy "admins manage bills"
  on public.bills for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff read bills" on public.bills;
create policy "staff read bills"
  on public.bills for select to authenticated
  using (public.is_staff());

drop policy if exists "admins manage settings" on public.cafe_settings;
create policy "admins manage settings"
  on public.cafe_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff read settings" on public.cafe_settings;
create policy "staff read settings"
  on public.cafe_settings for select to authenticated
  using (public.is_staff());

drop policy if exists "admins manage tables" on public.cafe_tables;
create policy "admins manage tables"
  on public.cafe_tables for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff read tables" on public.cafe_tables;
create policy "staff read tables"
  on public.cafe_tables for select to authenticated
  using (public.is_staff());

drop policy if exists "admins manage categories" on public.menu_categories;
create policy "admins manage categories"
  on public.menu_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage options" on public.menu_item_options;
create policy "admins manage options"
  on public.menu_item_options for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage items" on public.menu_items;
create policy "admins manage items"
  on public.menu_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins read order items" on public.order_items;
create policy "admins read order items"
  on public.order_items for select to authenticated
  using (public.is_admin());

drop policy if exists "staff read order items" on public.order_items;
create policy "staff read order items"
  on public.order_items for select to authenticated
  using (public.is_staff());

drop policy if exists "staff and admins insert kitchen tickets" on public.order_kitchen_tickets;
create policy "staff and admins insert kitchen tickets"
  on public.order_kitchen_tickets for insert to authenticated
  with check (public.is_staff());

drop policy if exists "staff and admins read kitchen tickets" on public.order_kitchen_tickets;
create policy "staff and admins read kitchen tickets"
  on public.order_kitchen_tickets for select to authenticated
  using (public.is_staff());

drop policy if exists "admins read orders" on public.orders;
create policy "admins read orders"
  on public.orders for select to authenticated
  using (public.is_admin());

drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders"
  on public.orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff read orders" on public.orders;
create policy "staff read orders"
  on public.orders for select to authenticated
  using (public.is_staff());

-- These two policies are added by earlier release migrations and must also be
-- authenticated-only before the role helper functions lose anonymous EXECUTE.
drop policy if exists "admins manage admin credit settlements" on public.admin_credit_settlements;
create policy "admins manage admin credit settlements"
  on public.admin_credit_settlements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff read customer payments" on public.customer_payments;
create policy "staff read customer payments"
  on public.customer_payments for select to authenticated
  using (public.is_staff());

-- Public menu visitors can read active categories only. Authenticated admins retain
-- visibility of inactive categories through the authenticated policy.
-- Optional legacy table public.categories: if present (e.g. production/restored environments),
-- safely harden its RLS policies using dynamic execution.
do $$
begin
  if to_regclass('public.categories') is not null then
    execute 'drop policy if exists "Public reads active categories" on public.categories;';
    execute 'drop policy if exists "Authenticated reads active categories" on public.categories;';

    execute 'create policy "Public reads active categories" on public.categories for select to anon using (is_active);';

    execute 'create policy "Authenticated reads active categories" on public.categories for select to authenticated using (is_active or public.has_role(auth.uid(), ''admin''::public.app_role));';
  end if;
end $$;

-- 2. Revoke anonymous execution from privileged application RPCs.
-- Authenticated grants are retained; function bodies continue to enforce their own
-- owner/admin/staff authorization checks.
revoke execute on function public.get_authorized_admins() from public, anon;
revoke execute on function public.settle_admin_credit_payment(uuid, integer, text, text) from public, anon;
revoke execute on function public.record_customer_payment(uuid, integer, text, text, text) from public, anon;

revoke execute on function public.cancel_bill(uuid, text) from public, anon;
revoke execute on function public.create_manual_order(jsonb) from public, anon;
revoke execute on function public.edit_order_items(uuid, jsonb) from public, anon;
revoke execute on function public.get_bill_for_order(uuid) from public, anon;
revoke execute on function public.generate_bill(uuid, text, numeric) from public, anon;
revoke execute on function public.record_bill_reprint(uuid, jsonb) from public, anon;
revoke execute on function public.update_staff_order_status(uuid, public.order_status, text) from public, anon;

revoke execute on function public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid) from public, anon;

-- Optional legacy administrative RPCs from production: guard with schema, signature, and type checks
do $$
begin
  if to_regprocedure('public.admin_list_staff()') is not null then
    execute 'revoke execute on function public.admin_list_staff() from public, anon;';
  end if;
  if to_regtype('public.app_role') is not null and to_regprocedure('public.admin_set_role(text, public.app_role, boolean)') is not null then
    execute 'revoke execute on function public.admin_set_role(text, public.app_role, boolean) from public, anon;';
  end if;
end $$;

-- Restrict role lookups to the caller's own user ID, except that an admin may
-- inspect another account. This prevents authenticated users from probing arbitrary
-- UUIDs through SECURITY DEFINER helper RPCs. RLS policies call these with auth.uid().
-- Optional legacy role table public.user_roles and enum type public.app_role:
do $$
begin
  if to_regtype('public.app_role') is not null and to_regclass('public.user_roles') is not null then
    execute $fn$
      create or replace function public.has_role(_user_id uuid, _role public.app_role)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public, pg_temp
      as $body$
        select case
          when auth.uid() is null or _user_id is null then false
          when _user_id = auth.uid() then exists (
            select 1 from public.user_roles
            where user_id = _user_id and role = _role
          )
          when exists (
            select 1 from public.admin_profiles requester
            where requester.user_id = auth.uid()
              and requester.role in ('owner', 'admin')
          ) then exists (
            select 1 from public.user_roles target
            where target.user_id = _user_id and target.role = _role
          )
          else false
        end;
      $body$;
    $fn$;

    execute $fn$
      create or replace function public.is_staff(_user_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public, pg_temp
      as $body$
        select case
          when auth.uid() is null or _user_id is null then false
          when _user_id = auth.uid() then exists (
            select 1 from public.user_roles where user_id = _user_id
          )
          when exists (
            select 1 from public.admin_profiles requester
            where requester.user_id = auth.uid()
              and requester.role in ('owner', 'admin')
          ) then exists (
            select 1 from public.user_roles target where target.user_id = _user_id
          )
          else false
        end;
      $body$;
    $fn$;

    execute 'revoke execute on function public.has_role(uuid, public.app_role) from public, anon;';
    execute 'grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;';

    execute 'revoke execute on function public.is_staff(uuid) from public, anon;';
    execute 'grant execute on function public.is_staff(uuid) to authenticated, service_role;';
  end if;
end $$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

-- 3. Re-assert least-privilege on functions introduced in migrations 0020-0021.
revoke execute on function public.create_external_platform_order(jsonb) from public, anon;
revoke execute on function public.create_admin_credit_order(jsonb) from public, anon;
revoke execute on function public.order_has_items(uuid) from public, anon;

-- 4. Trigger/event-trigger entry points are not RPCs. Existing triggers continue to
-- invoke them; clients must not call them directly.
revoke execute on function public.prevent_customer_payment_mutation() from public, anon, authenticated;

-- Optional legacy triggers from production: guard with schema and signature checks
do $$
begin
  if to_regprocedure('public.log_order_status()') is not null then
    execute 'revoke execute on function public.log_order_status() from public, anon, authenticated;';
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated;';
  end if;
end $$;

-- 5. Retain pre-0009 snapshots, but remove anon/authenticated Data API grants when
-- the historical tables exist. Clean local replay may not contain these production-
-- only archives. service_role receives SELECT-only access for backup/recovery.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    '_backup_pre_0009_admin_profiles',
    '_backup_pre_0009_bills',
    '_backup_pre_0009_cafe_settings',
    '_backup_pre_0009_cafe_tables',
    '_backup_pre_0009_menu_categories',
    '_backup_pre_0009_menu_item_options',
    '_backup_pre_0009_menu_items',
    '_backup_pre_0009_order_items',
    '_backup_pre_0009_orders'
  ] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format(
        'revoke all privileges on table public.%I from public, anon, authenticated',
        v_table
      );
      execute format(
        'grant select on table public.%I to service_role',
        v_table
      );
    end if;
  end loop;
end $$;

-- 6. Prevent future functions created by the migration owner from inheriting the
-- global PUBLIC EXECUTE grant and the schema-specific anon/authenticated grants.
-- PUBLIC must be revoked globally; a schema-scoped revoke cannot cancel that default.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- 7. Preserve public customer QR endpoints; their calls are protected by opaque tokens
-- and input validation. No REVOKE is issued for these functions:
--   place_order(text, jsonb, text, integer, text)
--   place_public_order(jsonb)
--   get_order_status(uuid, text)
--   get_table_by_token(text)

commit;
