/**
 * Appointment review card on the lead page (#149): conditions of the contract, the deadline in
 * business days, every condition answered before saving, the reason and the claim only for a
 * failed appointment, and the "recorded late" mark. Made-up names.
 */
import { AppointmentReviewCard } from '@/components/features/appointment-reviews/appointment-review-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  mutate: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      appointmentReviews: { get: { invalidate: vi.fn() } },
      agencyContracts: { report: { invalidate: vi.fn() } },
    }),
    appointmentReviews: {
      get: { useQuery: () => mocks.result },
      save: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
    },
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const context = (values: Record<string, unknown> = {}) => ({
  applicable: true,
  agencyName: '代行A',
  rule: { contractId: 'c1', criteria: ['決裁者が同席した', '機種を確認できた'], returnDeadlineBusinessDays: 1 },
  // Friday
  firstMeetingOn: '2026-10-16',
  review: null,
  today: '2026-10-16',
  canEdit: true,
  ...values,
});

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <AppointmentReviewCard organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

const answer = (label: string, choice: '満たした' | '満たさなかった') =>
  fireEvent.click(
    within(screen.getByRole('group', { name: label })).getByRole('radio', { name: choice })
  );

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.result = { data: context(), isError: false };
});

describe('AppointmentReviewCard', () => {
  it('shows the conditions of the contract and the deadline in business days', () => {
    renderCard();
    expect(screen.getByText('アポの条件の確認')).toBeInTheDocument();
    expect(screen.getByText('決裁者が同席した')).toBeInTheDocument();
    // Fri meeting, 1 business day: Monday
    expect(screen.getByText(/2026\/10\/19まで（あと1営業日）/)).toBeInTheDocument();
    expect(screen.getByText('最初のヒアリングの日を初期値にしています。')).toBeInTheDocument();
  });

  it('saves only once every condition is answered, with the reason and claim of a failure', () => {
    renderCard();
    const save = screen.getByRole('button', { name: '記録する' });
    expect(save).toBeDisabled();
    expect(screen.queryByLabelText('不備の理由')).not.toBeInTheDocument();

    answer('決裁者が同席した', '満たさなかった');
    expect(save).toBeDisabled();
    answer('機種を確認できた', '満たした');
    expect(save).toBeEnabled();

    fireEvent.change(screen.getByLabelText('不備の理由'), { target: { value: '決裁者が欠席' } });
    fireEvent.click(save);
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      meetingOn: '2026-10-16',
      checks: [
        { label: '決裁者が同席した', met: false },
        { label: '機種を確認できた', met: true },
      ],
      defectReason: '決裁者が欠席',
      claim: null,
    });
  });

  it('uses the standard conditions and no deadline without a contract', () => {
    mocks.result = {
      data: context({ rule: { contractId: null, criteria: [], returnDeadlineBusinessDays: null } }),
      isError: false,
    };
    renderCard();
    expect(screen.getByText(/この時期の契約が登録されていない/)).toBeInTheDocument();
    expect(screen.getByText('所定の時間話せた')).toBeInTheDocument();
    expect(screen.getByText('期限の決まりなし')).toBeInTheDocument();
  });

  it('shows a saved review, marked when it was recorded after the deadline', () => {
    mocks.result = {
      data: context({
        today: '2026-10-21',
        review: {
          meetingOn: '2026-10-16',
          deadlineOn: '2026-10-19',
          checks: [{ label: '決裁者が同席した', met: false }],
          conditionsMet: false,
          defectReason: '決裁者が欠席',
          claim: 'retake',
          recordedLate: true,
          updatedAt: new Date('2026-10-21T01:00:00Z'),
          updatedByName: '営業 太郎',
        },
      }),
      isError: false,
    };
    renderCard();
    expect(screen.getByText('条件を満たさなかったアポ')).toBeInTheDocument();
    expect(screen.getByText('期限後に記録')).toBeInTheDocument();
    expect(screen.getByText(/期限を過ぎています/)).toBeInTheDocument();
    expect(screen.getByLabelText('不備の理由')).toHaveValue('決裁者が欠席');
    expect(screen.getByRole('button', { name: '記録を更新' })).toBeEnabled();
  });

  it('shows nothing for a lead that did not come from an agency', () => {
    mocks.result = { data: { applicable: false, canEdit: true }, isError: false };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
