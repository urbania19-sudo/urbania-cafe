-- Creates the 5 café tables (with QR tokens) if they don't exist yet, then lists the menu links.
insert into public.cafe_tables(table_number,label)
select n,'Table '||n from generate_series(1,5) n
on conflict (table_number) do nothing;
select label,'https://urbania-cafe.vercel.app/menu/'||qr_token as menu_link,is_active from public.cafe_tables order by table_number;
