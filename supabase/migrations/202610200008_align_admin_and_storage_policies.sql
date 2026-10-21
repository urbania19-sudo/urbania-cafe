-- Align admin authorization and menu image storage access.
-- This migration is additive and should be tested on a development database first.

begin;

-- Only owner/admin profiles should pass the admin authorization helper.
-- Previously any row in admin_profiles, including role='staff', returned true.
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

-- The Next.js app authorizes owners/admins through admin_profiles, but the old
-- Storage policies checked the separate legacy user_roles table. Align upload
-- permissions with the application's current role source of truth.
drop policy if exists "Admins write menu images" on storage.objects;
create policy "Admins write menu images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'menu-images'
    and public.is_admin()
  );

drop policy if exists "Admins update menu images" on storage.objects;
create policy "Admins update menu images"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'menu-images'
    and public.is_admin()
  )
  with check (
    bucket_id = 'menu-images'
    and public.is_admin()
  );

drop policy if exists "Admins delete menu images" on storage.objects;
create policy "Admins delete menu images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'menu-images'
    and public.is_admin()
  );

commit;
