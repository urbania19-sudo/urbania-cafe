import { redirect } from 'next/navigation';
import { authDb } from '@/lib/supabase/auth-server';
import LoginForm from '@/components/auth/LoginForm';

export const dynamic = 'force-dynamic';

export default async function StaffLogin() {
  let shouldRedirect = false;
  try {
    const db = await authDb();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (user) {
      const { data: profile } = await db
        .from('admin_profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
      if (profile) {
        shouldRedirect = true;
      }
    }
  } catch {
    // If auth service is unreachable, fall through to display login form
  }

  if (shouldRedirect) {
    redirect('/staff');
  }

  return <LoginForm portal="staff" />;
}
