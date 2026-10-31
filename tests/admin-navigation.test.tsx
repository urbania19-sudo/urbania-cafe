// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminNav, { AdminNavTab } from '@/components/admin/AdminNav';
import fs from 'fs';
import path from 'path';

describe('Admin Navigation & Admin Credit Visibility', () => {
  const allTabs: { tab: AdminNavTab; label: string; href: string }[] = [
    { tab: 'today', label: 'Today’s service', href: '/admin' },
    { tab: 'menu', label: 'Menu & prices', href: '/admin/menu' },
    { tab: 'tables', label: 'Table QR codes', href: '/admin/tables' },
    { tab: 'settings', label: 'Settings & FSSAI', href: '/admin/settings' },
    { tab: 'reports', label: 'Audit & Reports', href: '/admin/reports' },
    { tab: 'credit-orders', label: 'Admin Credit', href: '/admin/credit-orders' },
  ];

  it('renders all 6 owner navigation tabs plus the Open staff queue link', () => {
    render(<AdminNav activeTab="today" />);

    // Verify all 6 main admin tabs exist
    allTabs.forEach(({ label, href }) => {
      const link = screen.getByRole('link', { name: label });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', href);
    });

    // Verify Open staff queue link exists
    const staffQueueLink = screen.getByRole('link', { name: 'Open staff queue' });
    expect(staffQueueLink).toBeInTheDocument();
    expect(staffQueueLink).toHaveAttribute('href', '/staff');
  });

  it('always keeps Admin Credit visible regardless of the active tab', () => {
    allTabs.forEach(({ tab }) => {
      const { unmount } = render(<AdminNav activeTab={tab} />);
      const adminCreditLink = screen.getByRole('link', { name: 'Admin Credit' });
      expect(adminCreditLink).toBeInTheDocument();
      expect(adminCreditLink).toHaveAttribute('href', '/admin/credit-orders');
      unmount();
    });
  });

  it('sets aria-current="page" and active styling exclusively on the active tab', () => {
    allTabs.forEach(({ tab, label }) => {
      const { unmount } = render(<AdminNav activeTab={tab} />);

      const activeLink = screen.getByRole('link', { name: label });
      expect(activeLink).toHaveAttribute('aria-current', 'page');
      expect(activeLink.style.background).toBe('var(--accent)');
      expect(activeLink.style.fontWeight).toBe('700');

      // Check other tabs do NOT have aria-current
      allTabs
        .filter((t) => t.tab !== tab)
        .forEach((inactive) => {
          const inactiveLink = screen.getByRole('link', { name: inactive.label });
          expect(inactiveLink).not.toHaveAttribute('aria-current');
          expect(inactiveLink.style.background).not.toBe('var(--accent)');
        });

      unmount();
    });
  });

  it('supports responsive mobile wrapping with flex-wrap and gap', () => {
    const { container } = render(<AdminNav activeTab="today" />);
    const nav = container.querySelector('nav');
    expect(nav).toBeInTheDocument();
    expect(nav?.style.display).toBe('flex');
    expect(nav?.style.flexWrap).toBe('wrap');
    expect(nav?.style.gap).toBe('8px');
  });

  it('ensures all 6 admin pages incorporate AdminNav with the appropriate activeTab', () => {
    const adminPages: { file: string; expectedTab: AdminNavTab }[] = [
      { file: 'src/app/admin/page.tsx', expectedTab: 'today' },
      { file: 'src/app/admin/menu/page.tsx', expectedTab: 'menu' },
      { file: 'src/app/admin/tables/page.tsx', expectedTab: 'tables' },
      { file: 'src/app/admin/settings/page.tsx', expectedTab: 'settings' },
      { file: 'src/app/admin/reports/page.tsx', expectedTab: 'reports' },
      { file: 'src/app/admin/credit-orders/page.tsx', expectedTab: 'credit-orders' },
    ];

    adminPages.forEach(({ file, expectedTab }) => {
      const fullPath = path.resolve(process.cwd(), file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Verify AdminNav is imported
      expect(content).toMatch(/import\s+AdminNav\s+from\s+['"]@\/components\/admin\/AdminNav['"]/);

      // Verify AdminNav is rendered with correct activeTab
      expect(content).toContain(`<AdminNav activeTab="${expectedTab}" />`);
    });
  });
});
