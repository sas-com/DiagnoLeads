/**
 * The respondent's preferred dates on the lead page (#155): pick one and confirm it, with or
 * without the confirmation email; a confirmed meeting can be changed; the topics and the note
 * of #244; the warning for an unverified answer (#274). Made-up names.
 */
import { MeetingRequestCard } from '@/components/features/meeting-requests/meeting-request-card';
import enMessages from '@/locales/en/common.json';
import messages from '@/locales/ja/common.json';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  mutate: vi.fn(),
  invalidate: vi.fn(),
  /** The options the card gave the confirm mutation */
  confirmOptions: {} as { onSuccess?: (outcome: unknown) => void },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      meetingRequests: { get: { invalidate: mocks.invalidate } },
      leadFollowUp: { tasks: { invalidate: vi.fn() } },
    }),
    meetingRequests: {
      get: { useQuery: () => mocks.result },
      confirm: {
        useMutation: (options: typeof mocks.confirmOptions) => {
          mocks.confirmOptions = options;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const request = (values: Record<string, unknown> = {}) => ({
  candidates: [
    { date: '2026-10-20', time: '14:00' },
    { date: '2026-10-21', time: '10:00' },
  ],
  attendeeRoles: ['executive', 'it_staff'],
  meetingFormat: 'online',
  topics: [],
  topicNote: null,
  confirmed: null,
  confirmationEmailedAt: null,
  identityVerified: true,
  requestedAt: new Date('2026-10-16T01:00:00Z'),
  updatedAt: new Date('2026-10-16T01:00:00Z'),
  ...values,
});

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <MeetingRequestCard organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

const EMAIL = '回答者に確定の連絡をメールで送る';

const withRequest = (values: Record<string, unknown>) => ({
  data: { request: request(values), canEdit: true, emailConfigured: true },
  isError: false,
});

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
  toast.warning.mockReset();
  mocks.result = {
    data: { request: request(), canEdit: true, emailConfigured: true },
    isError: false,
  };
});

describe('MeetingRequestCard', () => {
  it('shows the topics and the note as plain text (#244)', () => {
    mocks.result = {
      data: {
        request: request({
          topics: ['result_detail', 'cost'],
          topicNote: '<b>移行</b>の時期\n来期の予算',
        }),
        canEdit: true,
        emailConfigured: true,
      },
      isError: false,
    };
    const { container } = renderCard();
    expect(screen.getByText('相談したい内容')).toBeInTheDocument();
    expect(screen.getByText('診断結果の詳しい説明、費用の目安')).toBeInTheDocument();
    const note = screen.getByText(/<b>移行<\/b>の時期/);
    expect(note).toHaveClass('whitespace-pre-wrap');
    expect(container.querySelector('b')).toBeNull();
  });

  it('joins the topics with the separator of the locale', () => {
    mocks.result = {
      data: {
        request: request({ topics: ['result_detail', 'cost'] }),
        canEdit: true,
        emailConfigured: true,
      },
      isError: false,
    };
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Tokyo">
        <MeetingRequestCard organizationId={ORG_ID} leadId={LEAD_ID} />
      </NextIntlClientProvider>
    );
    expect(screen.getByText('The diagnosis result in detail, Rough costs')).toBeInTheDocument();
  });

  it('says none when no topic was chosen and leaves the note out', () => {
    renderCard();
    expect(screen.getByText('相談したい内容')).toBeInTheDocument();
    expect(screen.queryByText('ご相談内容（自由記述）')).not.toBeInTheDocument();
  });

  it('shows the options, attendees and format, and confirms the picked one with the email', () => {
    renderCard();
    expect(screen.getByText('経営層・決裁者、情報システム部門の担当者')).toBeInTheDocument();
    expect(screen.getByText('オンライン')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'この日時で確定する' });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /2026\/10\/21.*10:00/ }));
    fireEvent.click(confirm);
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      candidateIndex: 1,
      candidate: { date: '2026-10-21', time: '10:00' },
      sendEmail: true,
    });
  });

  it('confirms without the email when unticked, or when email is not set up', () => {
    renderCard();
    fireEvent.click(screen.getByRole('checkbox', { name: '回答者に確定の連絡をメールで送る' }));
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'この日時で確定する' }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ candidateIndex: 0, sendEmail: false }));

    mocks.result = {
      data: { request: request(), canEdit: true, emailConfigured: false },
      isError: false,
    };
    renderCard();
    expect(screen.getByText(/メールの送信が設定されていないため/)).toBeInTheDocument();
  });

  it('shows a confirmed meeting, and lets it be changed', () => {
    mocks.result = {
      data: {
        request: request({
          confirmed: { date: '2026-10-20', time: '14:00', at: new Date('2026-10-16T02:00:00Z'), byName: '営業 太郎' },
          confirmationEmailedAt: new Date('2026-10-16T02:00:00Z'),
        }),
        canEdit: true,
        emailConfigured: true,
      },
      isError: false,
    };
    renderCard();
    expect(screen.getByText('確定')).toBeInTheDocument();
    expect(screen.getByText(/14:00〜 に確定（営業 太郎/)).toBeInTheDocument();
    expect(screen.getByText(/確定の連絡をメールで送りました/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '別の候補に変更する' }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('warns about an unverified answer and leaves the email unticked (#274)', () => {
    mocks.result = {
      data: {
        request: request({ identityVerified: false }),
        canEdit: true,
        emailConfigured: true,
      },
      isError: false,
    };
    renderCard();
    expect(screen.getByText('本人確認なし')).toBeInTheDocument();
    expect(screen.getByText('本人確認ができていない回答です')).toBeInTheDocument();
    expect(screen.getByText(/メールアドレスだけが一致した回答から届きました/)).toBeInTheDocument();
    const email = screen.getByRole('checkbox', { name: '回答者に確定の連絡をメールで送る' });
    expect(email).not.toBeChecked();
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'この日時で確定する' }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ sendEmail: false }));

    // Ticked by hand, it is sent
    fireEvent.click(email);
    fireEvent.click(screen.getByRole('button', { name: 'この日時で確定する' }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ sendEmail: true }));
  });

  it('shows no warning and ticks the email for a verified answer', () => {
    renderCard();
    expect(screen.queryByText('本人確認なし')).not.toBeInTheDocument();
    expect(screen.queryByText('本人確認ができていない回答です')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '回答者に確定の連絡をメールで送る' })).toBeChecked();
  });

  it('defaults the email from the request once it has loaded (#274)', () => {
    mocks.result = { data: undefined, isError: false };
    const view = renderCard();
    mocks.result = {
      data: {
        request: request({ identityVerified: false }),
        canEdit: true,
        emailConfigured: true,
      },
      isError: false,
    };
    view.rerender(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <MeetingRequestCard organizationId={ORG_ID} leadId={LEAD_ID} />
      </NextIntlClientProvider>
    );
    expect(
      screen.getByRole('checkbox', { name: '回答者に確定の連絡をメールで送る' })
    ).not.toBeChecked();
  });

  it('points the email and the confirm button at the warning, only when unverified (#274)', () => {
    mocks.result = withRequest({ identityVerified: false });
    const view = renderCard();
    const email = screen.getByRole('checkbox', { name: EMAIL });
    const confirm = screen.getByRole('button', { name: 'この日時で確定する' });
    const warningId = email.getAttribute('aria-describedby');
    expect(warningId).toBeTruthy();
    expect(confirm).toHaveAttribute('aria-describedby', warningId);
    expect(document.getElementById(warningId as string)).toHaveTextContent(
      '本人確認ができていない回答です'
    );
    view.unmount();

    mocks.result = withRequest({ identityVerified: true });
    renderCard();
    expect(screen.getByRole('checkbox', { name: EMAIL })).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('button', { name: 'この日時で確定する' })).not.toHaveAttribute(
      'aria-describedby'
    );
  });

  it('follows the request on a refetch while the email is untouched (#274)', () => {
    mocks.result = withRequest({ identityVerified: false });
    const view = renderCard();
    expect(screen.getByRole('checkbox', { name: EMAIL })).not.toBeChecked();
    // A verified answer replaced the preferences
    mocks.result = withRequest({ identityVerified: true });
    view.rerender(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <MeetingRequestCard organizationId={ORG_ID} leadId={LEAD_ID} />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole('checkbox', { name: EMAIL })).toBeChecked();
    expect(screen.queryByText('本人確認なし')).not.toBeInTheDocument();
  });

  it('says the preferences changed and reloads them when the confirmation is stale (#274)', () => {
    renderCard();
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'この日時で確定する' }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ candidateIndex: 0, candidate: { date: '2026-10-20', time: '14:00' } })
    );
    act(() => mocks.confirmOptions.onSuccess?.({ ok: false, reason: 'stale' }));
    expect(toast.warning).toHaveBeenCalledWith(
      '希望日時が更新されたため、確定していません。最新の候補を確認して、もう一度選んでください。'
    );
    expect(mocks.invalidate).toHaveBeenCalledWith({ organizationId: ORG_ID, leadId: LEAD_ID });
    // The pick is cleared: sales choose again from the new options
    expect(screen.getByRole('button', { name: 'この日時で確定する' })).toBeDisabled();
  });

  it('shows nothing for a lead without preferences', () => {
    mocks.result = { data: { request: null, canEdit: true, emailConfigured: true }, isError: false };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
