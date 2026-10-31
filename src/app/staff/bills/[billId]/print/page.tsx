import { redirect, notFound } from 'next/navigation';
import { authDb } from '@/lib/supabase/auth-server';
import ReceiptPrintView from '@/components/bills/ReceiptPrintView';
import { SAMPLE_BILL, type Bill } from '@/lib/billing';
import { isPreviewDemoMode } from '@/lib/preview-demo';
import PreviewDemoBanner from '@/components/demo/PreviewDemoBanner';
import { DEMO_BILLS } from '@/lib/demo-fixtures';

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

  const isDemo = isPreviewDemoMode();
  if (isDemo) {
    if (billId === 'sample' || billId === '00000000-0000-0000-0000-000000000000') {
      return (
        <>
          <PreviewDemoBanner />
          <ReceiptPrintView bill={SAMPLE_BILL} isReprint={isReprint} />
        </>
      );
    }
    const demoBill = DEMO_BILLS.find((b) => b.id === billId || b.bill_number === billId);
    if (!demoBill) {
      notFound();
    }
    return (
      <>
        <PreviewDemoBanner />
        <ReceiptPrintView bill={demoBill} isReprint={isReprint} />
      </>
    );
  }

  // Sample receipt for thermal printer testing (e.g. Fun Print MX11) without requiring auth or DB
  if (billId === 'sample' || billId === '00000000-0000-0000-0000-000000000000') {
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
