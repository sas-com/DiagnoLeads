/**
 * Invite page (real next-intl messages; tRPC, session and navigation mocked)
 */
import { InviteAcceptance } from '@/components/features/members/invite-acceptance';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
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
  mutate: vi.fn(),
  preview: { data: undefined as unknown, isLoading: false },
  session: { data: null as unknown, isPending: false },
  acceptOptions: undefined as
    | { onSuccess: (data: { organizationId: string }) => void; onError: (e: Error) => void }
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
  authClient: { signOut: mocks.signOut },
}));
vi.mock('@/lib/context/organization-context', () => ({
  useOrganizationContext: () => ({ setOrganization: mocks.setOrganization }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <InviteAcceptance token={TOKEN} />
    </NextIntlClientProvider>
  );

describe('InviteAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview = { data: valid, isLoading: false };
    mocks.session = { data: null, isPending: false };
  });

  it('offers sign-up with the invited address, and sign-in, both coming back here', () => {
    renderPage();

    expect(
      screen.getByText('招待 太郎 さんから、「営業部」にメンバーとして招待されています。')
    ).toBeInTheDocument();
    const back = encodeURIComponent(`/ja/invite/${TOKEN}`);
    expect(screen.getByRole('link', { name: '新規登録して参加する' })).toHaveAttribute(
      'href',
      `/ja/signup?callbackUrl=${back}&email=new%40example.com`
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
