-- Migration 0027: Harden exposed SECURITY DEFINER RPC execution privileges.
--
-- The production advisor found multiple SECURITY DEFINER routines that inherited
-- EXECUTE for anon through default privileges. Keep customer-facing QR endpoints
-- callable with their existing token validation, but restrict staff/admin operations
-- to signed-in users and remove direct execution on trigger-only helpers.
--
-- This migration changes privileges only. It does not mutate application data.

begin;

-- 1. Revoke unauthenticated execution from privileged application RPCs.
-- Existing authenticated grants are intentionally preserved; each function still
-- performs its own owner/admin/staff authorization check in the function body.
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

-- These look-up helpers accept an arbitrary user ID. They are not application
-- endpoints; do not let anon or regular authenticated users enumerate role membership.
revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.is_staff(uuid) from public, anon, authenticated;

-- 2. Re-assert least-privilege on functions introduced in migrations 0020-0021.
revoke execute on function public.create_external_platform_order(jsonb) from public, anon;
revoke execute on function public.create_admin_credit_order(jsonb) from public, anon;
revoke execute on function public.order_has_items(uuid) from public, anon;

-- 3. Trigger/event-trigger entry points are not RPCs. Their triggers continue to
-- invoke them as configured; application roles must not call them directly.
revoke execute on function public.log_order_status() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.prevent_customer_payment_mutation() from public, anon, authenticated;

-- 4. Keep archived pre-0009 snapshots in place, but remove direct Data API grants.
-- Their RLS has no policies by design; this is defense-in-depth for retained backups.
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

-- 5. Prevent future SECURITY DEFINER functions created by either migration owner
-- from automatically becoming callable by anon/authenticated/PUBLIC. New RPCs must
-- add explicit EXECUTE grants for the application roles that need them.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke execute on functions from public, anon, authenticated;

-- 6. Preserve the deliberately public QR/menu endpoints. Their inputs are protected
-- by unguessable table/public tokens and their own validation:
--   place_order(text, jsonb, text, integer, text)
--   place_public_order(jsonb)
--   get_order_status(uuid, text)
--   get_table_by_token(text)
-- No REVOKE is issued for these customer-facing entry points.

commit;
