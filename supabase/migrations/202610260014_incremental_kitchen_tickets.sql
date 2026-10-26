-- Urbania Café — Migration 0014: Incremental Kitchen Tickets & Acknowledgments
-- Additive only. Preserves all existing tables, rows, policies, and workflows.

create table if not exists public.order_kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  ticket_number int not null default 1,
  ticket_type text not null check (ticket_type in ('new', 'addon', 'reprint')),
  items_snapshot jsonb not null default '[]'::jsonb,
  full_order_snapshot jsonb not null default '[]'::jsonb,
  acknowledged_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_kitchen_tickets_order_created_idx 
  on public.order_kitchen_tickets(order_id, created_at desc);

alter table public.order_kitchen_tickets enable row level security;

-- Policies for order_kitchen_tickets
create policy "staff and admins read kitchen tickets"
  on public.order_kitchen_tickets
  for select
  using (public.is_staff());

create policy "staff and admins insert kitchen tickets"
  on public.order_kitchen_tickets
  for insert
  with check (public.is_staff());

-- Add atomic RPC function to record an acknowledged kitchen ticket
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

revoke execute on function public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid) from public;
grant execute on function public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid) to authenticated;
