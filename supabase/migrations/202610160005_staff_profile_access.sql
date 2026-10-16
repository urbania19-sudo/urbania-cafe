-- Staff must be able to read their own role in order to open the staff queue.
create policy "staff read own profile" on public.admin_profiles
  for select using (user_id = auth.uid());
