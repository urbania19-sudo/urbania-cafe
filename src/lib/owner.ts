import { authDb } from '@/lib/supabase/auth-server';

export async function owner() {
  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db
    .from('admin_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  return data?.role === 'owner' || data?.role === 'admin' ? db : null;
}

export async function staffDb() {
  const db = await authDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db
    .from('admin_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  return data?.role === 'owner' || data?.role === 'admin' || data?.role === 'staff' ? db : null;
}
