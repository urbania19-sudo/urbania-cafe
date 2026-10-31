-- Rollback for Migration 0017: Offline Customer Payment Methods
drop function if exists public.record_customer_payment(uuid, int, text, text, text);
drop table if exists public.customer_payments;
alter table public.bills drop column if exists payment_method;
alter table public.orders drop column if exists payment_method;
