-- Migration 0021: RLS Append Protection Hardening via Security Definer Helper
-- Solves the vulnerability where subquery `NOT EXISTS (SELECT 1 FROM public.order_items existing ...)`
-- inside an RLS check relies on caller's SELECT visibility. If existing items are invisible to the caller,
-- the subquery returns 0 rows, falsely allowing direct item appends.
-- Using a tightly scoped SECURITY DEFINER function guarantees evaluating table reality with bypassrls.

create or replace function public.order_has_items(p_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_items boolean;
begin
  -- 1. Authorization check: caller must be authenticated staff, admin, owner, or service_role
  if not (public.is_staff() or (auth.jwt()->>'role') = 'service_role') then
    -- Fail closed: unauthorized callers are treated as order having items, denying any append
    return true;
  end if;

  if p_order_id is null then
    return false;
  end if;

  select exists (
    select 1
    from public.order_items
    where order_id = p_order_id
  ) into v_has_items;

  return v_has_items;
end;
$$;

grant execute on function public.order_has_items(uuid) to authenticated;
grant execute on function public.order_has_items(uuid) to service_role;

-- 2. Re-create order_items INSERT policy using public.order_has_items
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
        -- Hardened: Evaluate table reality via security-definer helper, immune to caller SELECT visibility
        and not public.order_has_items(order_items.order_id)
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
