insert into public.cafe_settings(cafe_name,tagline) values ('Urbania Café',null);
insert into public.cafe_tables(table_number,label,qr_token) values
  (1,'Table 1','1ea49749-1919-4fcd-b606-0293b512ef7c'),
  (2,'Table 2','8f4145e8-6647-4024-855a-b17514785e90'),
  (3,'Table 3','590a15e2-41ad-483e-9574-f689a6864834'),
  (4,'Table 4','221a75ff-d6dd-4840-ac26-64a0d79f5ecd'),
  (5,'Table 5','471f411b-3ce4-42b4-946d-e647e3da521b')
on conflict (table_number) do update set qr_token = excluded.qr_token, label = excluded.label;
insert into public.menu_categories(name,slug,sort_order) values ('Coffee','coffee',1),('Small plates','small-plates',2),('Desserts','desserts',3);
insert into public.menu_items(category_id,name,description,price_paise,is_veg,sort_order) select id,'Classic Cappuccino','Sample menu item',18000,true,1 from public.menu_categories where slug='coffee';
insert into public.menu_items(category_id,name,description,price_paise,is_veg,sort_order) select id,'Masala Toastie','Sample menu item',22000,true,1 from public.menu_categories where slug='small-plates';
insert into public.menu_items(category_id,name,description,price_paise,is_veg,sort_order) select id,'Flat White','Sample menu item',19000,true,2 from public.menu_categories where slug='coffee';
insert into public.menu_items(category_id,name,description,price_paise,is_veg,sort_order) select id,'Iced Mocha','Sample menu item',24000,true,3 from public.menu_categories where slug='coffee';
insert into public.menu_items(category_id,name,description,price_paise,is_veg,sort_order) select id,'Pesto Chicken Sandwich','Sample menu item',29000,false,2 from public.menu_categories where slug='small-plates';
insert into public.menu_items(category_id,name,description,price_paise,is_veg,sort_order) select id,'Crispy Fries','Sample menu item',16000,true,3 from public.menu_categories where slug='small-plates';
insert into public.menu_items(category_id,name,description,price_paise,is_veg,sort_order) select id,'Chocolate Brownie','Sample menu item',15000,true,1 from public.menu_categories where slug='desserts';
insert into public.menu_items(category_id,name,description,price_paise,is_veg,sort_order) select id,'Burnt Basque Cheesecake','Sample menu item',21000,true,2 from public.menu_categories where slug='desserts';
