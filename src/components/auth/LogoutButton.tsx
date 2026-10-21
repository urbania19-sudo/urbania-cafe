'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { browserDb } from '@/lib/supabase/browser';
import { clearLegacyAuthCookies } from '@/lib/supabase/cookie-config';

export default function LogoutButton({ to = '/admin/login' }: { to?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await browserDb().auth.signOut();
      clearLegacyAuthCookies();
    } finally {
      router.replace(to);
      router.refresh();
    }
  }
  return (
    <button className="chip" type="button" onClick={logout} disabled={busy}>
      {busy ? 'Signing out…' : 'Log out'}
    </button>
  );
}
