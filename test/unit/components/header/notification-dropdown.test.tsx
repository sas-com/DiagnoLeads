/**
 * The bell's notification list (#431): a notification about a lead opens the lead page (in the
 * locale) and is marked read; the others are only marked read; the settings link keeps the
 * locale. Real next-intl messages; the notification hooks are mocked.
 */
import NotificationDropdown from '@/components/header/NotificationDropdown';
import enMessages from '@/locales/en/common.json';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
  notifications: [] as unknown[],
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
}));

vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({ data: mocks.notifications, isLoading: false }),
  useUnreadCount: () => ({
    data: {
      count: mocks.notifications.filter((n) => !(n as { read: boolean }).read).length,
    },
  }),
  useMarkAsRead: () => ({ mutate: mocks.markAsRead }),
  useMarkAllAsRead: () => ({ mutate: mocks.markAllAsRead, isPending: false }),
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));

const notification = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1',
  userId: 'u1',
  organizationId: ORG_ID,
  type: 'lead_handoff',
  title: '【引き継ぎ】架空商事 の引き継ぎ書',
  message: '初回商談の引き継ぎ書ができました',
  data: { leadId: LEAD_ID },
  read: false,
  readAt: null,
  createdAt: new Date(),
  ...overrides,
});

/** jsdom does not navigate; the address a click opens is the link's href */
const stopNavigation = (event: MouseEvent) => event.preventDefault();

beforeEach(() => {
  mocks.markAsRead.mockReset();
  mocks.markAllAsRead.mockReset();
  mocks.notifications = [notification()];
  document.addEventListener('click', stopNavigation);
});

afterEach(() => {
  document.removeEventListener('click', stopNavigation);
});

const renderOpen = async (locale: 'ja' | 'en' = 'ja') => {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? messages : enMessages}
      timeZone="Asia/Tokyo"
    >
      <NotificationDropdown />
    </NextIntlClientProvider>
  );
  await user.click(
    screen.getByRole('button', {
      name: (locale === 'ja' ? messages : enMessages).notifications.title,
    })
  );
  return user;
};

describe('NotificationDropdown', () => {
  it('opens the lead of a notification about one and marks it read', async () => {
    const user = await renderOpen();
    const link = screen.getByRole('link', { name: '【引き継ぎ】架空商事 の引き継ぎ書' });
    expect(link).toHaveAttribute('href', `/ja/leads/${LEAD_ID}`);

    await user.click(link);
    expect(mocks.markAsRead).toHaveBeenCalledWith({ notificationId: 'n1' });
    // The list closes on the way to the lead
    expect(screen.queryByRole('link', { name: /架空商事/ })).not.toBeInTheDocument();
  });

  it('opens a read one without marking it again', async () => {
    mocks.notifications = [notification({ read: true })];
    const user = await renderOpen();
    await user.click(screen.getByRole('link', { name: '【引き継ぎ】架空商事 の引き継ぎ書' }));
    expect(mocks.markAsRead).not.toHaveBeenCalled();
  });

  it('only marks the others read: no lead, or no usable lead id', async () => {
    mocks.notifications = [
      notification({ id: 'n2', type: 'system', title: '通知を一時停止しました', data: { limit: 'x' } }),
      notification({ id: 'n3', type: 'lead_created', title: '壊れたリンク', data: { leadId: 'x' } }),
    ];
    const user = await renderOpen();
    expect(screen.queryByRole('link', { name: '通知を一時停止しました' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '壊れたリンク' })).not.toBeInTheDocument();

    await user.click(screen.getByText('通知を一時停止しました'));
    expect(mocks.markAsRead).toHaveBeenCalledWith({ notificationId: 'n2' });
    // Still open
    expect(screen.getByText('壊れたリンク')).toBeInTheDocument();
  });

  it('marks read from the check button without opening the lead', async () => {
    const user = await renderOpen();
    await user.click(screen.getByRole('button', { name: messages.notifications.markAsRead }));
    expect(mocks.markAsRead).toHaveBeenCalledTimes(1);
    expect(mocks.markAsRead).toHaveBeenCalledWith({ notificationId: 'n1' });
    expect(screen.getByRole('link', { name: '【引き継ぎ】架空商事 の引き継ぎ書' })).toBeInTheDocument();
  });

  it('links the settings and the lead in the current locale', async () => {
    await renderOpen('en');
    expect(
      screen.getByRole('link', { name: enMessages.notifications.viewSettings })
    ).toHaveAttribute('href', '/en/settings#notifications');
    expect(screen.getByRole('link', { name: '【引き継ぎ】架空商事 の引き継ぎ書' })).toHaveAttribute(
      'href',
      `/en/leads/${LEAD_ID}`
    );
  });

  it('links the settings with the locale in Japanese too', async () => {
    await renderOpen();
    expect(
      screen.getByRole('link', { name: messages.notifications.viewSettings })
    ).toHaveAttribute('href', '/ja/settings#notifications');
  });
});
