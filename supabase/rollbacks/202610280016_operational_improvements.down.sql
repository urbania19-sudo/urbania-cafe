-- Rollback for Migration 0016: Operational Improvements
drop function if exists public.settle_admin_credit_payment(uuid, int, text, text);
drop function if exists public.get_authorized_admins();
drop table if exists public.admin_credit_settlements cascade;

alter table public.bills
  drop column if exists admin_user_id,
  drop column if exists payment_status,
  drop column if exists paid_paise,
  drop column if exists external_platform_name,
  drop column if exists external_platform_ref;

alter table public.orders
  drop column if exists admin_user_id,
  drop column if exists payment_status,
  drop column if exists paid_paise,
  drop column if exists external_platform_name,
  drop column if exists external_platform_ref;

alter table public.orders
  drop constraint if exists orders_order_source_check;

alter table public.orders
  add constraint orders_order_source_check
    check (order_source in ('qr', 'manual'));

alter table public.bills
  drop constraint if exists bills_order_source_check;

alter table public.bills
  add constraint bills_order_source_check
    check (order_source in ('qr', 'manual'));
