select count(*)
from public.bills b
where b.status = 'cancelled'
  and b.payment_status = 'paid';
