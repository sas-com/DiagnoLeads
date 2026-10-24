/**
 * Invite page (real next-intl messages; tRPC, session and navigation mocked)
 */
import { InviteAcceptance } from '@/components/features/members/invite-acceptance';
import messages from '@/locales/ja/common.json';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'invite-token-value-invite-token-value-abc';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const valid = {
  state: 'valid',
  organizationName: '営業部',
  inviterName: '招待 太郎',
  email: 'new@example.com',
  role: 'member',
  expiresAt: new Date('2026-10-22T01:00:00Z'),
};

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setOrganization: vi.fn(),
  signOut: vi.fn(),
  sendVerificationEmail: vi.fn(),
  getSession: vi.fn(),
  mutate: vi.fn(),
  preview: { data: undefined as unknown, isLoading: false },
  session: { data: null as unknown, isPending: false },
  acceptOptions: undefined as
    | {
        onSuccess: (data: { organizationId: string }) => void;
        onError: (e: { message: string; data?: { code: string } }) => void;
      }
    | undefined,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    invitations: {
      preview: { useQuery: () => mocks.preview },
      accept: {
        useMutation: (options: typeof mocks.acceptOptions) => {
          mocks.acceptOptions = options;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => mocks.session,
  authClient: {
    signOut: mocks.signOut,
    sendVerificationEmail: mocks.sendVerificationEmail,
    getSession: mocks.getSession,
  },
}));
vi.mock('@/lib/context/organization-context', () => ({
  useOrganizationContext: () => ({ setOrganization: mocks.setOrganization }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

const renderPage = ({ verificationFailed = false } = {}) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <InviteAcceptance token={TOKEN} verificationFailed={verificationFailed} />
    </NextIntlClientProvider>
  );

describe('InviteAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview = { data: valid, isLoading: false };
    mocks.session = { data: null, isPending: false };
    mocks.getSession.mockResolvedValue({ data: null, error: null });
  });

  it('offers sign-up with the invited address, and sign-in, both coming back here', () => {
    renderPage();

    expect(
      screen.getByText('招待 太郎 さんから、「営業部」にメンバーとして招待されています。')
    ).toBeInTheDocument();
    const back = encodeURIComponent(`/ja/invite/${TOKEN}`);
    expect(screen.getByRole('link', { name: '新規登録して参加する' })).toHaveAttribute(
      'href',
      `/ja/signup?callbackUrl=${back}&email=new%40example.com&invitation=${TOKEN}`
    );
    expect(
      screen.getByRole('link', { name: 'ログインして参加する（アカウントをお持ちの方）' })
    ).toHaveAttribute('href', `/ja/login?callbackUrl=${back}`);
  });

  it('joins with one click when signed in with the invited address, then opens the dashboard', async () => {
    mocks.session = { data: { user: { email: 'New@Example.com' } }, isPending: false };
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '参加する' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ token: TOKEN });

    mocks.acceptOptions?.onSuccess({ organizationId: ORG_ID });
    expect(mocks.setOrganization).toHaveBeenCalledWith(ORG_ID);
    expect(mocks.push).toHaveBeenCalledWith('/ja/dashboard');
  });

  describe('when the address must be verified first (#128)', () => {
    const required = { ...valid, emailVerificationRequired: true };
    beforeEach(() => {
      mocks.preview = { data: required, isLoading: false };
    });

    it('sends a verification email that comes back here instead of joining', async () => {
      mocks.session = {
        data: { user: { email: 'new@example.com', emailVerified: false } },
        isPending: false,
      };
      mocks.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
      const user = userEvent.setup();
      renderPage();

      expect(screen.queryByRole('button', { name: '参加する' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '確認メールを送る' }));
      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
        email: 'new@example.com',
        callbackURL: `/ja/invite/${TOKEN}`,
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        'new@example.com に確認メールを送りました。'
      );
      expect(screen.getByRole('button', { name: '確認メールをもう一度送る' })).toBeInTheDocument();
    });

    it('says so when the email could not be sent', async () => {
      mocks.session = {
        data: { user: { email: 'new@example.com', emailVerified: false } },
        isPending: false,
      };
      mocks.sendVerificationEmail.mockResolvedValue({ data: null, error: { status: 429 } });
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: '確認メールを送る' }));
      expect(screen.getByRole('alert')).toHaveTextContent('確認メールを送れませんでした。');
    });

    it('explains a verification link that came back expired or invalid', () => {
      mocks.session = {
        data: { user: { email: 'new@example.com', emailVerified: false } },
        isPending: false,
      };
      renderPage({ verificationFailed: true });

      expect(screen.getByRole('alert')).toHaveTextContent('確認のリンクの有効期限が切れているか');
    });

    it('offers to join on coming back from the link, although the session cookie is stale', async () => {
      mocks.session = {
        data: { user: { email: 'new@example.com', emailVerified: false } },
        isPending: false,
      };
      mocks.getSession.mockResolvedValue({
        data: { user: { email: 'new@example.com', emailVerified: true } },
        error: null,
      });
      renderPage();

      expect(await screen.findByRole('button', { name: '参加する' })).toBeInTheDocument();
      expect(mocks.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
    });

    it('joins once verified, and goes back to verifying if the server says otherwise', async () => {
      mocks.session = {
        data: { user: { email: 'new@example.com', emailVerified: true } },
        isPending: false,
      };
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: '参加する' }));
      expect(mocks.mutate).toHaveBeenCalledWith({ token: TOKEN });
      act(() =>
        mocks.acceptOptions?.onError({
          message: 'メールアドレスの確認が済んでいません。',
          data: { code: 'PRECONDITION_FAILED' },
        })
      );
      expect(screen.getByRole('button', { name: '確認メールを送る' })).toBeInTheDocument();
    });
  });

  it('joins without verifying while the setting is off', () => {
    mocks.session = {
      data: { user: { email: 'new@example.com', emailVerified: false } },
      isPending: false,
    };
    renderPage();

    expect(screen.getByRole('button', { name: '参加する' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '確認メールを送る' })).not.toBeInTheDocument();
  });

  it('asks someone signed in with another address to switch accounts', async () => {
    mocks.session = { data: { user: { email: 'other@example.com' } }, isPending: false };
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'いまは other@example.com でログインしています。この招待は new@example.com 宛てです。'
    );
    expect(screen.queryByRole('button', { name: '参加する' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ログアウトする' }));
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it.each([
    ['expired', 'この招待の有効期限が切れています。'],
    ['revoked', 'この招待は取り消されたか、新しい招待で置き換えられています。'],
    ['accepted', 'この招待はすでに使われています。'],
  ])('explains an invitation that can no longer be used (%s)', (state, text) => {
    mocks.preview = { data: { ...valid, state }, isLoading: false };
    renderPage();

    expect(screen.getByRole('heading', { name: 'この招待リンクは使えません' })).toBeInTheDocument();
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
  });

  it('explains an unknown link', () => {
    mocks.preview = { data: undefined, isLoading: false };
    renderPage();

    expect(screen.getByRole('heading', { name: 'この招待リンクは使えません' })).toBeInTheDocument();
  });
});
