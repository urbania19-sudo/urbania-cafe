-- Rollback Migration 0015: restore the prior four-argument acknowledgement RPC.
-- Roll this back only together with application code that calls the four-argument
-- signature; current application code requires the five-argument RPC.

drop function if exists public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid);

create function public.acknowledge_kitchen_ticket(
  p_order_id uuid,
  p_ticket_type text,
  p_items_snapshot jsonb,
  p_full_order_snapshot jsonb
)
returns public.order_kitchen_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.order_kitchen_tickets;
  v_next_num int;
begin
  if not public.is_staff() then
    raise exception 'Unauthorized: staff or admin role required';
  end if;

  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Order not found';
  end if;

  if p_ticket_type not in ('new', 'addon', 'reprint') then
    raise exception 'Invalid ticket type: %', p_ticket_type;
  end if;

  select coalesce(max(ticket_number), 0) + 1
  into v_next_num
  from public.order_kitchen_tickets
  where order_id = p_order_id;

  insert into public.order_kitchen_tickets (
    order_id,
    ticket_number,
    ticket_type,
    items_snapshot,
    full_order_snapshot,
    acknowledged_by
  ) values (
    p_order_id,
    v_next_num,
    p_ticket_type,
    coalesce(p_items_snapshot, '[]'::jsonb),
    coalesce(p_full_order_snapshot, '[]'::jsonb),
    auth.uid()
  )
  returning * into v_ticket;

  return v_ticket;
end $$;

revoke execute on function public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
