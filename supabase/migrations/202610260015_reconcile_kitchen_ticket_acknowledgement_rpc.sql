-- Urbania Café — Migration 0015: Reconcile Kitchen Ticket Acknowledgement RPC
--
-- Migration 0014 was recorded before its five-argument RPC revision reached
-- this database. Reconcile the already-existing table/function without touching
-- migration history or ticket data.

create or replace function public.acknowledge_kitchen_ticket(
  p_order_id uuid,
  p_ticket_type text,
  p_items_snapshot jsonb,
  p_full_order_snapshot jsonb,
  p_expected_previous_ticket_id uuid
)
returns public.order_kitchen_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.order_kitchen_tickets;
  v_next_num int;
  v_latest_ticket_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Unauthorized: staff or admin role required';
  end if;

  -- Serialize acknowledgements per order before calculating the next ticket.
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if p_ticket_type not in ('new', 'addon', 'reprint') then
    raise exception 'Invalid ticket type: %', p_ticket_type;
  end if;

  select id
  into v_latest_ticket_id
  from public.order_kitchen_tickets
  where order_id = p_order_id
  order by ticket_number desc
  limit 1;

  select coalesce(max(ticket_number), 0) + 1
  into v_next_num
  from public.order_kitchen_tickets
  where order_id = p_order_id;

  if v_latest_ticket_id is distinct from p_expected_previous_ticket_id then
    raise exception 'Kitchen ticket changed; refresh before acknowledging';
  end if;

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

-- Remove the obsolete signature without CASCADE. This fails safely if another
-- database object depends on it, rather than hiding an incompatible dependency.
drop function if exists public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb);

revoke execute on function public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid) from public, anon, service_role;
grant execute on function public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid) to authenticated;

-- PostgREST must refresh its schema cache to resolve the new function signature.
notify pgrst, 'reload schema';
