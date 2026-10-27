-- Migration 0018: payment reconciliation hardening
-- Safe to run after migrations 0016 and 0017. Does not write invented payment methods.

-- 1. Preserve legacy bill/order paid state while backfilling the new paid balance.
-- Before migration 0016, an issued bill had no payment-status field; the old workflow
-- treated issued bills as settled. Keep that historical convention, but leave method NULL
-- so reports classify the collection as unclassified rather than guessing Cash or UPI.
update public.bills
set paid_paise = total_paise,
    payment_status = 'paid',
    payment_method = null
where status = 'issued'
  and order_source in ('qr', 'manual')
  and payment_status = 'paid'
  and coalesce(paid_paise, 0) = 0;

update public.orders o
set paid_paise = o.total_paise,
    payment_status = 'paid',
    payment_method = null
where o.order_source in ('qr', 'manual')
  and o.payment_status = 'paid'
  and coalesce(o.paid_paise, 0) = 0
  and not exists (
    select 1 from public.bills b
    where b.order_id = o.id and b.status = 'cancelled'
  );

-- 2. Ensure external-platform orders are never treated as customer collections.
update public.orders
set payment_status = 'external', paid_paise = 0, payment_method = null
where order_source in ('swiggy', 'zomato', 'delivery_platform')
  and payment_status <> 'external';

update public.bills
set payment_status = 'external', paid_paise = 0, payment_method = null
where order_source in ('swiggy', 'zomato', 'delivery_platform')
  and status = 'issued'
  and payment_status <> 'external';

-- Admin credit is a receivable until settlement, not a customer cash collection.
update public.orders
set payment_status = 'unpaid', paid_paise = 0, payment_method = null
where order_source = 'admin_credit'
  and coalesce(paid_paise, 0) = 0
  and payment_status = 'paid';

update public.bills
set payment_status = 'unpaid', paid_paise = 0, payment_method = null
where order_source = 'admin_credit'
  and coalesce(paid_paise, 0) = 0
  and payment_status = 'paid';

-- 3. Make the customer payment ledger append-only for application roles.
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


-- New customer bills/orders begin unpaid until record_customer_payment succeeds.
-- Historical records were reconciled above before changing these defaults.
alter table public.bills alter column payment_status set default 'unpaid';
alter table public.orders alter column payment_status set default 'unpaid';
