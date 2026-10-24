/**
 * UserDropdown: the signed-in user's initials and name, the menu, closing it, and signing out
 * (#27)
 */
import UserDropdown from '@/components/header/UserDropdown';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: { data: null as unknown },
  signOut: vi.fn(),
  push: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    useSession: () => mocks.session,
    signOut: mocks.signOut,
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

const signedInAs = (user: { name?: string | null; email?: string | null } | null) => {
  mocks.session = { data: user ? { user } : null };
};

const renderDropdown = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <UserDropdown />
      <p>外側</p>
    </NextIntlClientProvider>
  );

/** The button that opens the menu (it shows the initials) */
const toggle = () => screen.getAllByRole('button')[0];

/**
 * The whole text of the avatar: the first span in the button. The name and email are <p>, so a
 * name that contains the initials (山田, User) cannot make the assertion pass.
 */
const initialsIn = (button: HTMLElement) => button.querySelector('span')?.textContent;

/** jsdom cannot open another page; the menu's own click handlers still run */
const stayOnPage = (event: MouseEvent) => {
  if ((event.target as Element | null)?.closest('a')) event.preventDefault();
};

describe('UserDropdown', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    signedInAs({ name: 'Taro Yamada', email: 'taro@example.com' });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    document.addEventListener('click', stayOnPage);
  });
  afterEach(() => {
    consoleError.mockRestore();
    document.removeEventListener('click', stayOnPage);
  });

  it('shows the initials of the first and last name, the name and the email', () => {
    renderDropdown();

    expect(initialsIn(toggle())).toBe('TY');
    expect(toggle()).toHaveTextContent('Taro Yamada');
    expect(toggle()).toHaveTextContent('taro@example.com');
  });

  it('takes the first two letters of a single name', () => {
    signedInAs({ name: '山田太郎', email: 'yamada@example.com' });
    renderDropdown();
    expect(initialsIn(toggle())).toBe('山田');

    signedInAs({ name: 'hanako', email: 'h@example.com' });
    renderDropdown();
    expect(initialsIn(screen.getAllByRole('button')[1])).toBe('HA');
  });

  it('falls back to the email without a name', () => {
    signedInAs({ name: null, email: 'sales@example.com' });
    renderDropdown();

    expect(initialsIn(toggle())).toBe('SA');
    expect(toggle()).toHaveTextContent('sales');
  });

  it('shows a placeholder before the session is known', () => {
    signedInAs(null);
    renderDropdown();

    expect(initialsIn(toggle())).toBe('U');
    expect(toggle()).toHaveTextContent('User');
  });

  it('opens the menu with links to the personal and organization settings', async () => {
    const user = userEvent.setup();
    renderDropdown();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await user.click(toggle());

    expect(screen.getByRole('link', { name: '個人設定' })).toHaveAttribute('href', '/ja/settings');
    expect(screen.getByRole('link', { name: '組織設定' })).toHaveAttribute(
      'href',
      '/ja/settings/organization'
    );
  });

  it('closes the menu on a second click, on a link, and on a click outside', async () => {
    const user = userEvent.setup();
    renderDropdown();

    await user.click(toggle());
    await user.click(toggle());
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await user.click(toggle());
    await user.click(screen.getByRole('link', { name: '個人設定' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await user.click(toggle());
    await user.click(screen.getByRole('link', { name: '組織設定' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await user.click(toggle());
    await user.click(screen.getByText('外側'));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('stays open on a click inside the menu', async () => {
    const user = userEvent.setup();
    renderDropdown();

    await user.click(toggle());
    await user.click(screen.getAllByText('taro@example.com')[1]);
    expect(screen.getByRole('link', { name: '組織設定' })).toBeInTheDocument();
  });

  it('signs out and goes to the login page', async () => {
    mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
    const user = userEvent.setup();
    renderDropdown();

    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'ログアウト' }));

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/ja/login'));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('stays on the page and says so when signing out is refused', async () => {
    mocks.signOut.mockResolvedValue({ data: null, error: { status: 500 } });
    const user = userEvent.setup();
    renderDropdown();

    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'ログアウト' }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('ログアウトに失敗しました。')
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('says so when signing out fails on the network', async () => {
    mocks.signOut.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderDropdown();

    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'ログアウト' }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('ログアウトに失敗しました。')
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
