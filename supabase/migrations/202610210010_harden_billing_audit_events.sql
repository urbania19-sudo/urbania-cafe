-- Urbania Café — Migration 0010: Harden Bill Audit Events Immutability & Access Control
-- Additive only. Revokes direct insert/update/delete privileges on bill_audit_events from authenticated users.

begin;

-- Revoke direct mutation rights on bill_audit_events
revoke insert, update, delete on public.bill_audit_events from public, authenticated;

-- Ensure select is granted to authenticated staff/admins
grant select on public.bill_audit_events to authenticated;
grant all on public.bill_audit_events to service_role;

-- Drop insecure direct insert and manage policies if they exist
drop policy if exists "staff insert bill audit events" on public.bill_audit_events;
drop policy if exists "admins manage bill audit events" on public.bill_audit_events;

-- Ensure read-only policy for staff and admins
drop policy if exists "staff read bill audit events" on public.bill_audit_events;
create policy "staff read bill audit events" on public.bill_audit_events
  for select using (public.is_staff());

commit;
