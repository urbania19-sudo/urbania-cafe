import { redirect, notFound } from 'next/navigation';
import { authDb } from '@/lib/supabase/auth-server';
import ReceiptPrintView from '@/components/bills/ReceiptPrintView';
import { SAMPLE_BILL, type Bill } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export default async function BillPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{ reprint?: string }>;
}) {
  const { billId } = await params;
  const { reprint } = await searchParams;
  const isReprint = reprint === 'true';

  // Sample receipt for thermal printer testing (e.g. Fun Print MX11) without requiring auth or DB
  if (billId === 'sample') {
    return <ReceiptPrintView bill={SAMPLE_BILL} isReprint={isReprint} />;
  }

  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    redirect(`/staff/login?next=/staff/bills/${billId}/print${isReprint ? '?reprint=true' : ''}`);
  }

  const { data: profile } = await db
    .from('admin_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    redirect('/staff/login');
  }

  const { data: bill, error } = await db
    .from('bills')
    .select('*')
    .eq('id', billId)
    .maybeSingle();

  if (error || !bill) {
    notFound();
  }

  return <ReceiptPrintView bill={bill as unknown as Bill} isReprint={isReprint} />;
}
