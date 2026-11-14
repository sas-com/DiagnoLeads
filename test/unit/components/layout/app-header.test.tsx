/**
 * The app top bar on a phone (#196): its buttons are at least 44px so a finger hits them. On any
 * page but the office, it leads into the full-screen office (#1162).
 * Real ja messages; the parts with data (search, organizations, notifications, user) are mocked.
 */
import AppHeader from '@/components/layout/AppHeader';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/ja/leads' }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => nav.pathname,
}));

vi.mock('@/context/SidebarContext', () => ({
  useSidebar: () => ({
    isMobileOpen: false,
    toggleSidebar: vi.fn(),
    toggleMobileSidebar: vi.fn(),
  }),
}));
vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('@/components/header/HeaderLeadSearch', () => ({ HeaderLeadSearch: () => null }));
vi.mock('@/components/header/NotificationDropdown', () => ({ default: () => null }));
vi.mock('@/components/header/UserDropdown', () => ({ default: () => null }));
vi.mock('@/components/dashboard/organization-switcher', () => ({
  OrganizationSwitcher: () => null,
}));
vi.mock('@/components/common/TestModeBadge', () => ({ TestModeBadge: () => null }));

const a11y = messages.header.a11y;

describe('AppHeader on a phone (#196)', () => {
  it('has 44px menu, more and theme buttons', () => {
    render(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <AppHeader />
      </NextIntlClientProvider>
    );
    for (const name of [a11y.toggleSidebar, a11y.moreMenu, a11y.themeToDark]) {
      expect(screen.getByRole('button', { name })).toHaveClass('h-11', 'w-11');
    }
  });
});

describe('the way into the office (#1162)', () => {
  const renderHeader = () =>
    render(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <AppHeader />
      </NextIntlClientProvider>
    );

  it('clocks in from any page of the normal view, into the full-screen office', () => {
    nav.pathname = '/ja/leads';
    renderHeader();
    const clockIn = screen.getByRole('link', { name: messages.header.enterOffice });
    expect(clockIn).toHaveAttribute('href', '/ja/office?source=login');
    // Hidden below 768px, where the full-screen office does not open
    expect(clockIn).toHaveClass('hidden', 'md:flex');
  });

  it('is not offered on the office page, which has its own way in', () => {
    nav.pathname = '/ja/office';
    renderHeader();
    expect(screen.queryByRole('link', { name: messages.header.enterOffice })).toBeNull();
  });
});
