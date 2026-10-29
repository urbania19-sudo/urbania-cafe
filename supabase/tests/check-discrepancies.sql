select count(*)
from public.bills b
join public.orders o on o.id = b.order_id
where b.status = 'issued'
  and b.order_source in ('qr', 'manual')
  and coalesce(o.paid_paise, 0) <> coalesce(b.paid_paise, 0);
