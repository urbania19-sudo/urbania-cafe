import Link from 'next/link';

export type AdminNavTab =
  | 'today'
  | 'menu'
  | 'tables'
  | 'settings'
  | 'reports'
  | 'credit-orders';

const NAV_ITEMS: { tab: AdminNavTab; label: string; href: string }[] = [
  { tab: 'today', label: 'Today’s service', href: '/admin' },
  { tab: 'menu', label: 'Menu & prices', href: '/admin/menu' },
  { tab: 'tables', label: 'Table QR codes', href: '/admin/tables' },
  { tab: 'settings', label: 'Settings & FSSAI', href: '/admin/settings' },
  { tab: 'reports', label: 'Audit & Reports', href: '/admin/reports' },
  { tab: 'credit-orders', label: 'Admin Credit', href: '/admin/credit-orders' },
];

export default function AdminNav({ activeTab }: { activeTab: AdminNavTab }) {
  const activeStyle = {
    background: 'var(--accent)',
    color: '#2b1b16',
    fontWeight: 700,
    borderColor: 'var(--accent)',
  };

  return (
    <nav
      className="admin-nav"
      aria-label="Owner navigation"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '12px 0',
        margin: '12px 0 20px',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.tab === activeTab;
        return (
          <Link
            key={item.tab}
            className="chip"
            href={item.href}
            style={isActive ? activeStyle : undefined}
            aria-current={isActive ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
      <Link className="chip" href="/staff">
        Open staff queue
      </Link>
    </nav>
  );
}
