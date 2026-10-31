-- Migration 0018: payment reconciliation hardening
-- Safe to run after migrations 0016 and 0017. Does not write invented payment methods or statuses.

-- 1. Ensure constraints and nullability allow accurate representation of historical uncertainty.
-- Cancelled historical bills have unverified payment status and must be allowed to be NULL.
alter table public.bills alter column payment_status drop not null;
alter table public.orders alter column payment_status drop not null;

alter table public.bills drop constraint if exists bills_payment_status_check;
alter table public.bills add constraint bills_payment_status_check
  check (payment_status is null or payment_status in ('unpaid', 'partially_paid', 'paid', 'external'));

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status is null or payment_status in ('unpaid', 'partially_paid', 'paid', 'external'));

-- 1b. Safety Gate: Abort if any order has multiple associated bills (ambiguous history).
-- Joining orders to bills requires a deterministic 1:1 relationship to prevent non-deterministic updates
-- or conflicting settlement balances. If duplicate bills exist, fail closed immediately.
do $$
declare
  v_dup_orders int;
  v_mixed_orders int;
  v_multi_issued int;
begin
  select count(*) into v_dup_orders
  from (
    select order_id
    from public.bills
    group by order_id
    having count(*) > 1
  ) dups;

  if v_dup_orders > 0 then
    select count(*) into v_multi_issued
    from (
      select order_id
      from public.bills
      where status = 'issued'
      group by order_id
      having count(*) > 1
    ) mi;

    select count(*) into v_mixed_orders
    from (
      select order_id
      from public.bills
      group by order_id
      having count(*) filter (where status = 'issued') > 0
         and count(*) filter (where status = 'cancelled') > 0
    ) mo;

    raise exception 'URB:ambiguous_multiple_bills_detected: % order(s) have multiple associated bills (multiple issued: %, mixed issued/cancelled: %). Manual reconciliation required before migration.',
      v_dup_orders, coalesce(v_multi_issued, 0), coalesce(v_mixed_orders, 0);
  end if;
end $$;

-- 2. Authoritative Backfill of Historical Issued Bills & Linked Orders
-- Under the pre-0016 operational convention, an issued bill represents a settled order.
-- Method is left NULL so reports classify the collection as unclassified rather than guessing Cash or UPI.
update public.bills
set paid_paise = total_paise,
    payment_status = 'paid',
    payment_method = null
where status = 'issued'
  and order_source in ('qr', 'manual')
  and (payment_status is null or payment_status <> 'paid' or coalesce(paid_paise, 0) <> total_paise);

-- Order paid balance must match the authoritative issued bill total (accounting for bill discounts).
-- This ensures that if a discount was applied at bill issuance (bills.total_paise < orders.total_paise),
-- the order does not falsely record the pre-discount value as collected money.
-- Orders without an issued bill or with a cancelled bill are strictly excluded.
update public.orders o
set paid_paise = b.total_paise,
    payment_status = 'paid',
    payment_method = null
from public.bills b
where b.order_id = o.id
  and b.status = 'issued'
  and o.order_source in ('qr', 'manual')
  and (o.payment_status is null or o.payment_status <> 'paid' or coalesce(o.paid_paise, 0) <> b.total_paise);

-- 3. Historical Cancelled Bills & Orders with Cancelled Bills
-- Historical cancellation does not prove whether money was collected or refunded.
-- To avoid falsely asserting that money was collected ('paid') or never collected ('unpaid'),
-- their payment_status is set to NULL (unknown/unreconciled) with paid_paise = 0.
update public.bills
set payment_status = null,
    paid_paise = 0,
    payment_method = null
where status = 'cancelled'
  and order_source in ('qr', 'manual')
  and (payment_status is not null or coalesce(paid_paise, 0) <> 0);

update public.orders o
set payment_status = null,
    paid_paise = 0,
    payment_method = null
from public.bills b
where b.order_id = o.id
  and b.status = 'cancelled'
  and o.order_source in ('qr', 'manual')
  and not exists (
    select 1 from public.bills b_issued
    where b_issued.order_id = o.id and b_issued.status = 'issued'
  )
  and (o.payment_status is not null or coalesce(o.paid_paise, 0) <> 0);

-- 4. Historical Orders Without Any Bill (Cancelled or Unbilled Completed/Active)
-- Orders that never had a bill issued were never billed or settled through POS.
-- They must strictly remain unpaid with paid_paise = 0.
update public.orders o
set payment_status = 'unpaid',
    paid_paise = 0,
    payment_method = null
where o.order_source in ('qr', 'manual')
  and not exists (
    select 1 from public.bills b where b.order_id = o.id
  )
  and (o.payment_status is null or o.payment_status <> 'unpaid' or coalesce(o.paid_paise, 0) <> 0);

-- 5. Ensure external-platform orders are never treated as in-store customer collections.
update public.orders
set payment_status = 'external', paid_paise = 0, payment_method = null
where order_source in ('swiggy', 'zomato', 'delivery_platform')
  and (payment_status <> 'external' or coalesce(paid_paise, 0) <> 0 or payment_method is not null);

update public.bills
set payment_status = 'external', paid_paise = 0, payment_method = null
where order_source in ('swiggy', 'zomato', 'delivery_platform')
  and (payment_status <> 'external' or coalesce(paid_paise, 0) <> 0 or payment_method is not null);

-- 6. Admin credit is a receivable until settlement, not a customer cash collection.
update public.orders
set payment_status = 'unpaid', paid_paise = 0, payment_method = null
where order_source = 'admin_credit'
  and coalesce(paid_paise, 0) = 0
  and (payment_status is null or payment_status <> 'unpaid' or payment_method is not null);

update public.bills
set payment_status = 'unpaid', paid_paise = 0, payment_method = null
where order_source = 'admin_credit'
  and coalesce(paid_paise, 0) = 0
  and (payment_status is null or payment_status <> 'unpaid' or payment_method is not null);

-- 7. Make the customer payment ledger append-only for application roles.
-- Payments are recorded through the SECURITY DEFINER RPC. Refunds must be represented
-- by a separate append-only refund transaction in a future migration, not by rewriting
-- an existing payment row.
create or replace function public.prevent_customer_payment_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'customer_payments is append-only; record corrections as a separate transaction';
end;
$$;

drop trigger if exists customer_payments_immutable on public.customer_payments;
create trigger customer_payments_immutable
before update or delete on public.customer_payments
for each row execute function public.prevent_customer_payment_mutation();

drop policy if exists "admins manage customer payments" on public.customer_payments;
drop policy if exists "staff read customer payments" on public.customer_payments;
create policy "staff read customer payments"
  on public.customer_payments for select
  using (public.is_staff());

revoke insert, update, delete on public.customer_payments from authenticated;
grant select on public.customer_payments to authenticated;
grant all on public.customer_payments to service_role;

-- 8. Set column defaults for new rows going forward.
alter table public.bills alter column payment_status set default 'unpaid';
alter table public.orders alter column payment_status set default 'unpaid';
