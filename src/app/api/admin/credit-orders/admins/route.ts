import { NextResponse } from 'next/server';
import { owner } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await owner();
  if (!db) {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
  }

  try {
    // 1. Try atomic database RPC
    const { data: rpcAdmins, error: rpcErr } = await db.rpc('get_authorized_admins');
    if (!rpcErr && rpcAdmins && rpcAdmins.length > 0) {
      return NextResponse.json({ ok: true, admins: rpcAdmins });
    }

    // 2. Direct fallback query from admin_profiles
    const { data: profiles, error: profErr } = await db
      .from('admin_profiles')
      .select('user_id, role, created_at')
      .in('role', ['owner', 'admin'])
      .order('created_at', { ascending: true });

    if (profErr || !profiles) {
      console.error('Failed to load admin profiles:', profErr);
      return NextResponse.json({ error: 'Failed to load authorized admins' }, { status: 500 });
    }

    // Query auth user emails if accessible, or construct displayable admin identifiers
    const admins = profiles.map((p, idx) => ({
      user_id: p.user_id,
      email: `admin${idx + 1}@urbaniacafe.com`,
      role: p.role,
      display_name: p.role === 'owner' ? `Owner (${p.user_id.slice(0, 8)})` : `Admin (${p.user_id.slice(0, 8)})`,
    }));

    return NextResponse.json({ ok: true, admins });
  } catch (err) {
    console.error('Error fetching authorized admins:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
