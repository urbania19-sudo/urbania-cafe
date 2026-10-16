-- Staff must be able to read their own role and table labels in the live queue.
drop policy if exists "staff read own profile" on public.admin_profiles;
create policy "staff read own profile" on public.admin_profiles
  for select using (user_id = auth.uid());

drop policy if exists "staff read tables" on public.cafe_tables;
create policy "staff read tables" on public.cafe_tables
  for select using (public.is_staff());
