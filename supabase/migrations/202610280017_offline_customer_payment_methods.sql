-- Migration 0017: Offline Customer Payment Methods (Cash & Online/UPI)
-- Additive only. Fully backward compatible with existing schema.

-- 1. Add payment_method to public.bills and public.orders
alter table public.bills
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('cash', 'upi', 'online', 'card', 'other'));

alter table public.orders
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('cash', 'upi', 'online', 'card', 'other'));

-- 2. Customer Payments Table for Immutable Transaction History
create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_method text not null check (payment_method in ('cash', 'upi', 'online', 'card', 'other')),
  amount_paise int not null check (amount_paise > 0),
  status text not null default 'completed' check (status in ('completed', 'refunded', 'pending', 'failed')),
  notes text,
  received_by uuid references auth.users(id) on delete set null,
  idempotency_key text unique,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Indexes for efficient querying & reports reconciliation
create index if not exists customer_payments_bill_id_idx on public.customer_payments (bill_id);
create index if not exists customer_payments_order_id_idx on public.customer_payments (order_id);
create index if not exists customer_payments_paid_at_idx on public.customer_payments (paid_at desc);
create index if not exists customer_payments_method_idx on public.customer_payments (payment_method, status);

grant select on public.customer_payments to authenticated;
grant all on public.customer_payments to service_role;

alter table public.customer_payments enable row level security;

drop policy if exists "staff read customer payments" on public.customer_payments;
create policy "staff read customer payments" on public.customer_payments
  for select using (public.is_staff());

drop policy if exists "admins manage customer payments" on public.customer_payments;
create policy "admins manage customer payments" on public.customer_payments
  for all using (public.is_admin()) with check (public.is_admin());

-- 3. Atomic RPC: record_customer_payment()
-- Atomically records a full or partial customer payment against an issued bill,
-- verifies remaining balance, updates bills and orders, and prevents duplicates via idempotency_key.
create or replace function public.record_customer_payment(
  p_bill_id uuid,
  p_amount_paise int,
  p_payment_method text,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_bill record;
  v_existing_payment record;
  v_payment record;
  v_method text;
  v_remaining_paise int;
  v_new_paid_paise int;
  v_new_status text;
begin
  -- 1. Authorization
  if not (public.is_staff() or (auth.jwt()->>'role') = 'service_role') then
    raise exception 'URB:forbidden';
  end if;

  -- 2. Idempotency: return existing record if key is already processed
  if p_idempotency_key is not null and trim(p_idempotency_key) != '' then
    select * into v_existing_payment from public.customer_payments where idempotency_key = trim(p_idempotency_key);
    if found then
      -- An idempotency key may only replay the exact same bill/amount/method operation.
      -- Reusing a key for a different payment must not silently return another bill.
      if v_existing_payment.bill_id <> p_bill_id
         or v_existing_payment.amount_paise <> p_amount_paise
         or v_existing_payment.payment_method <> (
           case when lower(trim(p_payment_method)) = 'online'
             then 'upi'
             else lower(trim(p_payment_method))
           end
         ) then
        raise exception 'URB:idempotency_conflict';
      end if;
      select * into v_bill from public.bills where id = v_existing_payment.bill_id;
      return jsonb_build_object(
        'ok', true,
        'already_recorded', true,
        'payment', to_jsonb(v_existing_payment),
        'bill', to_jsonb(v_bill)
      );
    end if;
  end if;

  -- 3. Lock target bill
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then
    raise exception 'URB:not_found';
  end if;

  if v_bill.status = 'cancelled' then
    raise exception 'URB:cannot_pay_cancelled_bill';
  end if;

  -- 4. Validate amount against remaining balance
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'URB:invalid_amount';
  end if;

  v_remaining_paise := greatest(0, v_bill.total_paise - coalesce(v_bill.paid_paise, 0));
  if p_amount_paise > v_remaining_paise then
    raise exception 'URB:amount_exceeds_remaining_balance';
  end if;

  -- 5. Normalize payment method
  v_method := lower(trim(p_payment_method));
  if v_method = 'online' then
    v_method := 'upi';
  end if;
  if v_method not in ('cash', 'upi', 'card', 'other') then
    raise exception 'URB:invalid_payment_method';
  end if;

  -- 6. Insert immutable customer payment record
  insert into public.customer_payments (
    bill_id,
    order_id,
    payment_method,
    amount_paise,
    status,
    notes,
    received_by,
    idempotency_key,
    paid_at
  ) values (
    v_bill.id,
    v_bill.order_id,
    v_method,
    p_amount_paise,
    'completed',
    nullif(trim(p_notes), ''),
    v_uid,
    nullif(trim(p_idempotency_key), ''),
    now()
  )
  returning * into v_payment;

  -- 7. Update bill & order totals and statuses
  v_new_paid_paise := coalesce(v_bill.paid_paise, 0) + p_amount_paise;
  if v_new_paid_paise >= v_bill.total_paise then
    v_new_status := 'paid';
  else
    v_new_status := 'partially_paid';
  end if;

  update public.bills
  set paid_paise = v_new_paid_paise,
      payment_status = v_new_status,
      payment_method = v_method,
      updated_at = now()
  where id = v_bill.id
  returning * into v_bill;

  update public.orders
  set paid_paise = v_new_paid_paise,
      payment_status = v_new_status,
      payment_method = v_method
  where id = v_bill.order_id;

  return jsonb_build_object(
    'ok', true,
    'already_recorded', false,
    'payment', to_jsonb(v_payment),
    'bill', to_jsonb(v_bill)
  );
end;
$$;

grant execute on function public.record_customer_payment(uuid, int, text, text, text) to authenticated, service_role;
