/**
 * The app top bar on a phone (#196): its buttons are at least 44px so a finger hits them.
 * Real ja messages; the parts with data (search, organizations, notifications, user) are mocked.
 */
import AppHeader from '@/components/layout/AppHeader';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

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
