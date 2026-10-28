-- Migration 0022: Revoke Public Execution on order_has_items
-- Hardens public.order_has_items(uuid) by explicitly revoking default EXECUTE
-- privilege from pseudo-role PUBLIC and unauthenticated role anon while preserving
-- required grants for authenticated (for RLS policy evaluation) and service_role.

-- 1. Revoke default execute from PUBLIC and anon
revoke execute on function public.order_has_items(uuid) from public;
revoke execute on function public.order_has_items(uuid) from anon;

-- 2. Explicitly re-assert execute grants for authorized application roles
grant execute on function public.order_has_items(uuid) to authenticated;
grant execute on function public.order_has_items(uuid) to service_role;
