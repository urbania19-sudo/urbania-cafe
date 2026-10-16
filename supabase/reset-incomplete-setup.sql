-- Use ONLY during initial setup, before you have real café orders or user profiles.
-- Removes objects belonging to this application so the initial migration can run cleanly.
drop function if exists public.update_staff_order_status(uuid, public.order_status, text) cascade;
drop function if exists public.place_public_order(jsonb) cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.is_admin() cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.menu_item_options cascade;
drop table if exists public.menu_items cascade;
drop table if exists public.menu_categories cascade;
drop table if exists public.cafe_tables cascade;
drop table if exists public.admin_profiles cascade;
drop table if exists public.cafe_settings cascade;
drop sequence if exists public.order_number_seq cascade;
drop type if exists public.order_status cascade;
drop type if exists public.option_type cascade;
