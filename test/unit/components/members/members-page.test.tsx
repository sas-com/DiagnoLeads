/**
 * Members page (real ja messages, tRPC mocked) — Refs #163
 *
 * A refused invitation (e.g. an address outside the test mode domains) is shown in the dialog
 * under the email field instead of a toast far from it, and never as an unhandled rejection.
 */
import MembersPage from '@/app/[locale]/(dashboard)/settings/members/page';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const REFUSED = 'テスト中のため、@example.com のメールアドレスのみ登録できます';

type MutateOptions = { onSuccess?: () => void; onError?: (error: { message: string }) => void };
const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  inviteFails: true,
  toastError: vi.fn(),
  resend: undefined as undefined | ((invitation: { email: string; role: 'member' }) => void),
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID, isLoading: false }),
}));
vi.mock('@/hooks/use-members', () => ({
  useListMembers: () => ({
    isLoading: false,
    data: {
      total: 2,
      members: [
        {
          id: 'm-owner',
          role: 'owner',
          createdAt: '2026-10-16T00:00:00Z',
          user: { name: '山田 太郎', email: 'owner@example.com' },
        },
        {
          id: 'm-member',
          role: 'member',
          createdAt: '2026-10-16T00:00:00Z',
          user: { name: '鈴木 一郎', email: 'member@example.com' },
        },
      ],
    },
  }),
}));
vi.mock('@/components/features/members/pending-invitations', () => ({
  PendingInvitations: ({ onResend }: { onResend: typeof mocks.resend }) => {
    mocks.resend = onResend;
    return null;
  },
}));
vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), dismiss: vi.fn(), success: vi.fn(), error: mocks.toastError },
}));
vi.mock('@/lib/trpc/client', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    trpc: {
      useContext: () => ({
        members: { list: { invalidate: vi.fn() }, listInvitations: { invalidate: vi.fn() } },
      }),
      organizations: { getById: { useQuery: () => ({ data: { role: 'owner' }, isLoading: false }) } },
      health: {
        testMode: { useQuery: () => ({ data: { testMode: true, domains: ['example.com'] } }) },
      },
      members: {
        invite: {
          useMutation: () => ({
            isPending: false,
            mutate: (input: unknown, options?: MutateOptions) => {
              mocks.invite(input);
              if (mocks.inviteFails) options?.onError?.({ message: REFUSED });
              else options?.onSuccess?.();
            },
            mutateAsync: vi.fn(),
          }),
        },
        updateRole: { useMutation: mutation },
        remove: { useMutation: mutation },
      },
    },
  };
});

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <MembersPage />
    </NextIntlClientProvider>
  );

async function submitInvite(email: string) {
  await userEvent.click(screen.getByRole('button', { name: 'メンバーを招待' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('メールアドレス'), email);
  await userEvent.click(within(dialog).getByRole('button', { name: '招待を送信' }));
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inviteFails = true;
});

describe('MembersPage', () => {
  it('shows a refused invitation under the email field, inside the dialog', async () => {
    renderPage();
    const dialog = await submitInvite('someone@other-domain.test');

    expect(mocks.invite).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      email: 'someone@other-domain.test',
      role: 'member',
    });
    const error = within(dialog).getByRole('alert');
    expect(error).toHaveTextContent(`招待に失敗しました: ${REFUSED}`);
    const email = within(dialog).getByLabelText('メールアドレス');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email.getAttribute('aria-describedby')).toContain('invite-email-error');
    // Not a toast in the corner, and the dialog stays open with the address kept
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(email).toHaveValue('someone@other-domain.test');

    // Editing the address clears the message
    await userEvent.type(email, 'x');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says up front which addresses can be invited while testing', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'メンバーを招待' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('テスト中は @example.com のメールアドレスだけ招待できます')
    ).toBeInTheDocument();
  });

  it('still reports a failed resend from the pending list as a toast', () => {
    renderPage();
    mocks.resend?.({ email: 'someone@other-domain.test', role: 'member' });
    expect(mocks.toastError).toHaveBeenCalledWith(`招待に失敗しました: ${REFUSED}`);
  });

  it('uses Japanese for the member count and names the icon-only buttons', () => {
    renderPage();
    expect(screen.getByText('メンバー数')).toBeInTheDocument();
    expect(screen.queryByText('Total Members')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '鈴木 一郎 のロールを変更' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '鈴木 一郎 をメンバーから外す' })).toBeInTheDocument();
  });
});
