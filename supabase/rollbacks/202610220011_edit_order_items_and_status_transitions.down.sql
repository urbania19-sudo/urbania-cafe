-- Urbania Café — Rollback for Migration 0011
-- Reverts edit_order_items and restores update_staff_order_status to 0002 behavior

-- 1. Drop the edit_order_items function
drop function if exists public.edit_order_items(uuid, jsonb);

-- 2. Restore previous version of update_staff_order_status (from 202610160002_staff_roles.sql)
create or replace function public.update_staff_order_status(
  p_order_id uuid,
  p_next public.order_status,
  p_cancel_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_role text;
begin
  select role into v_role
  from public.admin_profiles
  where user_id = auth.uid();

  if v_role is null or v_role not in ('owner', 'admin', 'staff') then
    raise exception 'unauthorized';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  if (v_order.status, p_next) not in (
    ('NEW', 'ACCEPTED'),
    ('ACCEPTED', 'PREPARING'),
    ('PREPARING', 'READY'),
    ('READY', 'COMPLETED'),
    ('NEW', 'CANCELLED'),
    ('ACCEPTED', 'CANCELLED'),
    ('PREPARING', 'CANCELLED')
  ) then
    raise exception 'invalid transition';
  end if;

  if p_next = 'CANCELLED' and v_order.status <> 'NEW' and v_role not in ('owner', 'admin') then
    raise exception 'only owner/admin can cancel after accepted';
  end if;

  update public.orders
  set
    status = p_next,
    accepted_at = case when p_next = 'ACCEPTED' and accepted_at is null then now() else accepted_at end,
    completed_at = case when p_next = 'COMPLETED' then now() else completed_at end,
    cancelled_at = case when p_next = 'CANCELLED' then now() else cancelled_at end,
    cancellation_reason = case when p_next = 'CANCELLED' then left(p_cancel_reason, 300) else cancellation_reason end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;

revoke all on function public.update_staff_order_status(uuid, public.order_status, text) from public;
grant execute on function public.update_staff_order_status(uuid, public.order_status, text) to authenticated;
