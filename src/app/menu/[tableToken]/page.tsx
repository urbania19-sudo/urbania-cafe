import MenuClient from '@/components/menu/MenuClient';
import { demoCategories, demoItems, demoTable } from '@/lib/demo-menu';
import { adminDb } from '@/lib/supabase/server';
import { getMenuCatalog } from '@/lib/menu-catalog';
import { isPreviewDemoMode } from '@/lib/preview-demo';
import { DEMO_TABLES } from '@/lib/demo-fixtures';

export const dynamic = 'force-dynamic';

type TableLookupResult =
  | { status: 'ok'; table: { label: string; qr_token: string } }
  | { status: 'invalid_format' }
  | { status: 'connection_error' }
  | { status: 'not_found' }
  | { status: 'inactive' };

export default async function MenuPage({
  params,
}: {
  params: Promise<{ tableToken: string }>;
}) {
  const { tableToken } = await params;

  if (tableToken === 'demo-table-1') {
    return (
      <MenuClient
        demo
        table={demoTable}
        categories={demoCategories}
        items={demoItems}
      />
    );
  }

  if (isPreviewDemoMode() || tableToken.startsWith('demo-')) {
    const demoT = DEMO_TABLES.find(
      (t) => t.qr_token === tableToken || (tableToken === 'demo-t1' && t.table_number === 1)
    );
    if (demoT) {
      return (
        <MenuClient
          demo
          table={{ label: demoT.label, qr_token: demoT.qr_token }}
          categories={demoCategories}
          items={demoItems}
        />
      );
    }
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return (
      <main className="shell">
        <h1>Menu unavailable</h1>
        <p>Please ask a staff member for assistance.</p>
      </main>
    );
  }

  let lookup: TableLookupResult;

  try {
    const { data, error } = await adminDb()
      .from('cafe_tables')
      .select('label,qr_token,is_active')
      .eq('qr_token', tableToken)
      .maybeSingle();

    if (error) {
      if (error.code === '22P02') {
        lookup = { status: 'invalid_format' };
      } else {
        console.error('[MenuPage] Database query error for tableToken:', error);
        lookup = { status: 'connection_error' };
      }
    } else if (!data) {
      lookup = { status: 'not_found' };
    } else if (!data.is_active) {
      lookup = { status: 'inactive' };
    } else {
      lookup = {
        status: 'ok',
        table: { label: data.label, qr_token: data.qr_token },
      };
    }
  } catch (err) {
    console.error('[MenuPage] Unexpected connection error:', err);
    lookup = { status: 'connection_error' };
  }

  if (lookup.status === 'invalid_format') {
    return (
      <main className="shell">
        <h1>Invalid QR code</h1>
        <p>This QR code format is not recognised. Please ask a staff member for the current table code.</p>
      </main>
    );
  }

  if (lookup.status === 'connection_error') {
    return (
      <main className="shell">
        <h1>Service temporarily unavailable</h1>
        <p>Could not verify table status due to a connection error. Please ask a staff member for assistance.</p>
      </main>
    );
  }

  if (lookup.status === 'not_found') {
    return (
      <main className="shell">
        <h1>This QR code is not active</h1>
        <p>Please ask a staff member for the current table code.</p>
      </main>
    );
  }

  if (lookup.status === 'inactive') {
    return (
      <main className="shell">
        <h1>This table is not active</h1>
        <p>This table is currently inactive. Please ask a staff member for the current table code.</p>
      </main>
    );
  }

  const { categories, items } = await getMenuCatalog();
  return (
    <MenuClient
      table={lookup.table}
      categories={categories}
      items={items}
    />
  );
}
