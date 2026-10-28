-- Migration 0019: Orders and Order Items RLS Insert Policies and Admin Authorization Hardening
-- Allows authorized staff, admins, and owners to insert orders and order items under least-privilege rules
-- Hardens and reasserts public.is_admin() and public.is_staff() authorization functions

-- 1. Explicitly harden and ensure public.is_admin()
-- Checks that the authenticated user belongs to admin_profiles with role 'owner' or 'admin'.
-- Staff accounts (role 'staff') do NOT satisfy is_admin().
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- 2. Explicitly ensure public.is_staff()
-- Checks that the authenticated user belongs to admin_profiles with role 'owner', 'admin', or 'staff'.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role in ('owner', 'admin', 'staff')
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- 3. Tightened Orders INSERT Policy
-- Least-privilege direct table insert enforcement on public.orders:
-- 1) Staff & Admins can ONLY directly insert external delivery platform orders (Swiggy, Zomato, delivery_platform)
--    with payment_status = 'external', paid_paise = 0, and payment_method IS NULL.
-- 2) Owners & Admins can directly insert admin-credit orders with payment_status = 'unpaid',
--    paid_paise = 0, payment_method IS NULL, and referencing an authorized admin/owner user.
-- 3) Ordinary customer orders (QR and manual) CANNOT be directly inserted and must continue using their
--    respective security definer RPCs (place_public_order and create_manual_order).
-- 4) Staff cannot forge admin_credit orders, customer orders, or paid balances/methods.
drop policy if exists "staff and admins insert orders" on public.orders;
create policy "staff and admins insert orders"
  on public.orders
  for insert
  to authenticated
  with check (
    -- Condition 1: External delivery platform orders by authorized staff/admins
    (
      public.is_staff()
      and order_source in ('swiggy', 'zomato', 'delivery_platform')
      and payment_status = 'external'
      and paid_paise = 0
      and payment_method is null
    )
    or
    -- Condition 2: Admin credit orders by authorized owners/admins
    (
      public.is_admin()
      and order_source = 'admin_credit'
      and payment_status = 'unpaid'
      and paid_paise = 0
      and payment_method is null
      and admin_user_id is not null
      and exists (
        select 1
        from public.admin_profiles ap
        where ap.user_id = orders.admin_user_id
          and ap.role in ('owner', 'admin')
      )
    )
  );

-- 4. Tightened Order Items INSERT Policy
-- Allows direct item insertion ONLY for:
-- 1) External delivery platform orders (by authorized staff or admins).
-- 2) Admin credit orders (by authorized owners or admins).
-- Requires the target order to exist, be in an active state (not cancelled or completed),
-- and be unbilled (billed_at IS NULL and no non-cancelled bill exists).
-- Rejects direct staff item insertion into admin-credit orders, ordinary customer orders,
-- billed orders, cancelled orders, and completed orders.
drop policy if exists "staff and admins insert order items" on public.order_items;
create policy "staff and admins insert order items"
  on public.order_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.status not in ('CANCELLED', 'COMPLETED')
        and o.billed_at is null
        and not exists (
          select 1
          from public.bills b
          where b.order_id = o.id
            and b.status <> 'cancelled'
        )
        and (
          -- Branch A: External delivery platform order items by staff or admins
          (
            public.is_staff()
            and o.order_source in ('swiggy', 'zomato', 'delivery_platform')
          )
          or
          -- Branch B: Admin credit order items by owners or admins
          (
            public.is_admin()
            and o.order_source = 'admin_credit'
          )
        )
    )
  );

-- 5. Table privilege grants
grant insert on public.orders to authenticated;
grant insert on public.order_items to authenticated;
