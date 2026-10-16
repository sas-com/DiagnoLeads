/**
 * Pending invitations and the link shown after inviting (real next-intl messages, tRPC mocked)
 */
import { InviteLinkResult } from '@/components/features/members/invite-link-result';
import { PendingInvitations } from '@/components/features/members/pending-invitations';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({
  list: { data: [] as unknown[] },
  revoke: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useContext: () => ({ members: { listInvitations: { invalidate: mocks.invalidate } } }),
    members: {
      listInvitations: { useQuery: () => mocks.list },
      revokeInvitation: { useMutation: () => ({ mutate: mocks.revoke, isPending: false }) },
    },
  },
}));

const wrap = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {node}
    </NextIntlClientProvider>
  );

describe('PendingInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list = {
      data: [
        {
          id: 'inv-1',
          email: 'new@example.com',
          role: 'admin',
          expiresAt: new Date('2026-10-22T01:00:00Z'),
          expired: false,
        },
        {
          id: 'inv-2',
          email: 'old@example.com',
          role: 'member',
          expiresAt: new Date('2026-10-01T01:00:00Z'),
          expired: true,
        },
      ],
    };
  });

  it('is hidden while there are no pending invitations', () => {
    mocks.list = { data: [] };
    const { container } = wrap(
      <PendingInvitations organizationId={ORG_ID} onResend={vi.fn()} resending={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists invitations, flags expired ones, and resends or revokes them', async () => {
    const onResend = vi.fn();
    const user = userEvent.setup();
    wrap(<PendingInvitations organizationId={ORG_ID} onResend={onResend} resending={false} />);

    expect(screen.getByRole('heading', { name: '招待中' })).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    expect(screen.getByText('管理者')).toBeInTheDocument();
    expect(screen.getByText('期限切れ')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'もう一度送る' })[1]);
    expect(onResend).toHaveBeenCalledWith({ email: 'old@example.com', role: 'member' });

    await user.click(screen.getAllByRole('button', { name: '取り消す' })[0]);
    expect(mocks.revoke).toHaveBeenCalledWith({ organizationId: ORG_ID, invitationId: 'inv-1' });
  });
});

describe('InviteLinkResult', () => {
  it('says the email was not sent and offers the link to copy', async () => {
    const user = userEvent.setup();
    // After setup(), which installs its own clipboard
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    wrap(
      <InviteLinkResult
        result={{ email: 'new@example.com', url: 'https://app/ja/invite/tok', emailSent: false }}
      />
    );

    expect(screen.getByText('招待メールを送れませんでした')).toBeInTheDocument();
    expect(screen.getByLabelText('招待リンク')).toHaveValue('https://app/ja/invite/tok');
    await user.click(screen.getByRole('button', { name: 'コピー' }));
    expect(writeText).toHaveBeenCalledWith('https://app/ja/invite/tok');
  });

  it('confirms the email when it was sent', () => {
    wrap(
      <InviteLinkResult
        result={{ email: 'new@example.com', url: 'https://app/ja/invite/tok', emailSent: true }}
      />
    );
    expect(screen.getByText('招待メールを送信しました')).toBeInTheDocument();
  });
});
