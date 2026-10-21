import 'server-only';

import { createClient } from '@supabase/supabase-js';

export function adminDb() {
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server database is not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}
