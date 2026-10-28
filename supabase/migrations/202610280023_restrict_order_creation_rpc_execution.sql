-- Migration 0023: Restrict Order Creation RPC Execution Privileges
-- Hardens public.create_external_platform_order(jsonb) and
-- public.create_admin_credit_order(jsonb) by revoking default EXECUTE
-- privilege from pseudo-role PUBLIC and unauthenticated role anon.
-- Explicitly preserves EXECUTE for authenticated application users and service_role.

-- 1. Restrict create_external_platform_order(jsonb)
revoke execute on function public.create_external_platform_order(jsonb) from public;
revoke execute on function public.create_external_platform_order(jsonb) from anon;
grant execute on function public.create_external_platform_order(jsonb) to authenticated;
grant execute on function public.create_external_platform_order(jsonb) to service_role;

-- 2. Restrict create_admin_credit_order(jsonb)
revoke execute on function public.create_admin_credit_order(jsonb) from public;
revoke execute on function public.create_admin_credit_order(jsonb) from anon;
grant execute on function public.create_admin_credit_order(jsonb) to authenticated;
grant execute on function public.create_admin_credit_order(jsonb) to service_role;
