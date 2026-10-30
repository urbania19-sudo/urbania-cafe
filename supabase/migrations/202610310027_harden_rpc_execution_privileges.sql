-- Migration 0027: Harden exposed SECURITY DEFINER RPC execution privileges.
--
-- The production advisor found privileged SECURITY DEFINER routines inheriting EXECUTE
-- for anon from broad default privileges. This migration narrows the Data API surface,
-- preserves intentionally public token-based QR endpoints, and protects existing RLS.
--
-- Privilege/policy changes only. No application financial or order data is modified.

begin;

-- 1. Split the category read policy so anonymous menu reads do not need has_role().
-- Previously this combined anon/authenticated policy called has_role(auth.uid(), ...),
-- making that user-role lookup callable by anon as part of RLS evaluation.
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

revoke execute on function public.admin_list_staff() from public, anon;
revoke execute on function public.admin_set_role(text, public.app_role, boolean) from public, anon;
revoke execute on function public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid) from public, anon;

-- These helpers remain available to authenticated because existing RLS policies use
-- them. The category policy split removes anon's need to execute has_role().
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

revoke execute on function public.is_staff(uuid) from public, anon;
grant execute on function public.is_staff(uuid) to authenticated;

-- is_admin() and is_staff() (zero-argument forms) remain unchanged: multiple existing
-- policies are TO PUBLIC and invoke them to return false for anonymous requests.

-- 3. Re-assert least-privilege on functions introduced in migrations 0020-0021.
revoke execute on function public.create_external_platform_order(jsonb) from public, anon;
revoke execute on function public.create_admin_credit_order(jsonb) from public, anon;
revoke execute on function public.order_has_items(uuid) from public, anon;

-- 4. Trigger/event-trigger entry points are not RPCs. Existing triggers continue to
-- invoke them; clients must not call them directly.
revoke execute on function public.log_order_status() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.prevent_customer_payment_mutation() from public, anon, authenticated;

-- 5. Retain pre-0009 snapshots, but remove anon/authenticated Data API grants.
-- service_role retains SELECT-only access for privileged backup/recovery workflows.
revoke all privileges on table
  public._backup_pre_0009_admin_profiles,
  public._backup_pre_0009_bills,
  public._backup_pre_0009_cafe_settings,
  public._backup_pre_0009_cafe_tables,
  public._backup_pre_0009_menu_categories,
  public._backup_pre_0009_menu_item_options,
  public._backup_pre_0009_menu_items,
  public._backup_pre_0009_order_items,
  public._backup_pre_0009_orders
from public, anon, authenticated;

grant select on table
  public._backup_pre_0009_admin_profiles,
  public._backup_pre_0009_bills,
  public._backup_pre_0009_cafe_settings,
  public._backup_pre_0009_cafe_tables,
  public._backup_pre_0009_menu_categories,
  public._backup_pre_0009_menu_item_options,
  public._backup_pre_0009_menu_items,
  public._backup_pre_0009_order_items,
  public._backup_pre_0009_orders
to service_role;

-- 6. Prevent future SECURITY DEFINER functions created by migration owners from
-- automatically becoming callable by PUBLIC/anon/authenticated. New RPCs must add
-- explicit EXECUTE grants for each application role that needs them.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- 7. Preserve public customer QR endpoints; their calls are protected by opaque tokens
-- and input validation. No REVOKE is issued for these functions:
--   place_order(text, jsonb, text, integer, text)
--   place_public_order(jsonb)
--   get_order_status(uuid, text)
--   get_table_by_token(text)

commit;
