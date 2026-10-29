-- Urbania Café — Migration 0016: Operational Improvements
-- Feature 1: Admin Credit Orders & Payment Settlements
-- Feature 2: Swiggy & Zomato Delivery Platform Orders
-- Additive only. Fully backward compatible with existing schema.

-- 1. Extend orders table for Admin Credit & External Delivery Platforms
alter table public.orders
  drop constraint if exists orders_order_source_check;

alter table public.orders
  add constraint orders_order_source_check
    check (order_source in ('qr', 'manual', 'admin_credit', 'swiggy', 'zomato', 'delivery_platform'));

alter table public.orders
  add column if not exists admin_user_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_status text default 'unpaid'
    check (payment_status is null or payment_status in ('unpaid', 'partially_paid', 'paid', 'external')),
  add column if not exists paid_paise int not null default 0 check (paid_paise >= 0),
  add column if not exists external_platform_name text,
  add column if not exists external_platform_ref text;

create index if not exists orders_admin_credit_idx on public.orders (admin_user_id, payment_status)
  where order_source = 'admin_credit';
create index if not exists orders_external_platform_idx on public.orders (external_platform_name, external_platform_ref)
  where order_source in ('swiggy', 'zomato', 'delivery_platform');

-- 2. Extend bills table for parity and audit
alter table public.bills
  drop constraint if exists bills_order_source_check;

alter table public.bills
  add constraint bills_order_source_check
    check (order_source in ('qr', 'manual', 'admin_credit', 'swiggy', 'zomato', 'delivery_platform'));

alter table public.bills
  add column if not exists admin_user_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_status text default 'unpaid'
    check (payment_status is null or payment_status in ('unpaid', 'partially_paid', 'paid', 'external')),
  add column if not exists paid_paise int not null default 0 check (paid_paise >= 0),
  add column if not exists external_platform_name text,
  add column if not exists external_platform_ref text;

-- 3. Admin Credit Settlements Table
create table if not exists public.admin_credit_settlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  amount_paise int not null check (amount_paise > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'upi', 'bank_transfer', 'other')),
  notes text,
  received_by uuid references auth.users(id) on delete set null,
  settled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists admin_credit_settlements_order_id_idx on public.admin_credit_settlements(order_id);
create index if not exists admin_credit_settlements_admin_user_id_idx on public.admin_credit_settlements(admin_user_id);
create index if not exists admin_credit_settlements_settled_at_idx on public.admin_credit_settlements(settled_at desc);

alter table public.admin_credit_settlements enable row level security;

drop policy if exists "admins manage admin credit settlements" on public.admin_credit_settlements;
create policy "admins manage admin credit settlements" on public.admin_credit_settlements
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert on public.admin_credit_settlements to authenticated;
grant all on public.admin_credit_settlements to service_role;

-- 4. RPC: get_authorized_admins()
-- Safely lists registered owners/admins without hardcoding names
create or replace function public.get_authorized_admins()
returns table (
  user_id uuid,
  email text,
  role text,
  display_name text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not (public.is_admin() or public.is_staff()) then
    raise exception 'forbidden: staff or admin access required';
  end if;

  return query
  select
    ap.user_id,
    coalesce(u.email, 'admin@urbaniacafe.com')::text as email,
    ap.role::text,
    coalesce(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      split_part(u.email, '@', 1),
      'Administrator'
    )::text as display_name
  from public.admin_profiles ap
  left join auth.users u on u.id = ap.user_id
  where ap.role in ('owner', 'admin')
  order by ap.created_at asc;
end;
$$;

grant execute on function public.get_authorized_admins() to authenticated;

-- 5. RPC: settle_admin_credit_payment()
-- Atomically settles full or partial payment for an admin credit order
create or replace function public.settle_admin_credit_payment(
  p_order_id uuid,
  p_amount_paise int,
  p_payment_method text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_order public.orders;
  v_settlement public.admin_credit_settlements;
  v_new_paid int;
  v_new_status text;
  v_outstanding int;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin privileges required';
  end if;

  if p_amount_paise <= 0 then
    raise exception 'payment amount must be greater than zero';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found';
  end if;

  if v_order.order_source <> 'admin_credit' then
    raise exception 'order % is not an admin credit order', v_order.order_number;
  end if;

  if v_order.status = 'CANCELLED' then
    raise exception 'cannot settle payment for cancelled order';
  end if;

  v_outstanding := v_order.total_paise - v_order.paid_paise;
  if p_amount_paise > v_outstanding then
    raise exception 'settlement amount (₹%) exceeds outstanding balance of ₹%',
      (p_amount_paise / 100.0)::numeric(10,2),
      (v_outstanding / 100.0)::numeric(10,2);
  end if;

  v_new_paid := v_order.paid_paise + p_amount_paise;
  if v_new_paid >= v_order.total_paise then
    v_new_status := 'paid';
  else
    v_new_status := 'partially_paid';
  end if;

  insert into public.admin_credit_settlements(
    order_id,
    admin_user_id,
    amount_paise,
    payment_method,
    notes,
    received_by,
    settled_at
  ) values (
    v_order.id,
    v_order.admin_user_id,
    p_amount_paise,
    p_payment_method,
    p_notes,
    auth.uid(),
    now()
  ) returning * into v_settlement;

  update public.orders
  set paid_paise = v_new_paid,
      payment_status = v_new_status
  where id = v_order.id;

  update public.bills
  set paid_paise = v_new_paid,
      payment_status = v_new_status
  where order_id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'settlement_id', v_settlement.id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'amount_paise', p_amount_paise,
    'paid_paise', v_new_paid,
    'total_paise', v_order.total_paise,
    'payment_status', v_new_status,
    'settled_at', v_settlement.settled_at
  );
end;
$$;

grant execute on function public.settle_admin_credit_payment(uuid, int, text, text) to authenticated;
