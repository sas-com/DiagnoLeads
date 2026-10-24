/**
 * Objection card on the lead page (#157): the signals, the picked objections and NG phrases,
 * the open-schedule message with its date, and the takeaway. Playbook rows are made up.
 */
import { ObjectionCard } from '@/components/features/objection-card/objection-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown>, mutate: vi.fn() }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ leadFollowUp: { tasks: { invalidate: vi.fn() } } }),
    objectionCard: { get: { useQuery: () => mocks.result } },
    leadFollowUp: { createTask: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) } },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const data = (values: Record<string, unknown> = {}) => ({
  hasPlaybook: true,
  signals: [{ reason: 'budget', sources: ['hearing', 'diagnosis'] }],
  objections: [
    { customer: '高い', response: '小さく始める段階導入', note: '', reasons: ['budget'], matched: ['budget'] },
  ],
  ngPhrases: [{ ng: '絶対', alternative: '多くの場合', reasons: [] }],
  scheduleTemplate: '',
  // Friday: three business days later is Wednesday 10-21
  today: '2026-10-16',
  canAddTakeaway: true,
  ...values,
});

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <ObjectionCard organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.result = { data: data(), isError: false };
});

describe('ObjectionCard', () => {
  it('shows the signals, the objections that fit and the NG phrases', () => {
    renderCard();
    expect(screen.getByText('予算（ヒアリング・Web診断）')).toBeInTheDocument();
    expect(screen.getByText('「高い」')).toBeInTheDocument();
    expect(screen.getByText('小さく始める段階導入')).toBeInTheDocument();
    expect(screen.getByText('該当：予算')).toBeInTheDocument();
    expect(screen.getByText('絶対')).toBeInTheDocument();
  });

  it('writes the open-schedule message for a date three business days ahead', () => {
    renderCard();
    expect(screen.getByLabelText('連絡する期限')).toHaveValue('2026-10-21');
    expect(screen.getByText(/10月21日\(水\)までにご連絡いたします/)).toBeInTheDocument();
  });

  it('uses the playbook wording and adds a takeaway for the chosen date', () => {
    mocks.result = { data: data({ scheduleTemplate: '{date}にお電話します' }), isError: false };
    renderCard();
    fireEvent.change(screen.getByLabelText('連絡する期限'), { target: { value: '2026-10-23' } });
    expect(screen.getByText('10月23日(金)にお電話します')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '持ち帰り事項に入れる' }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      kind: 'takeaway',
      title: '次回の日程を連絡する（10月23日(金)まで）',
      dueOn: '2026-10-23',
    });
  });

  it('points to the playbook when none is registered, and hides from those who may not read it', () => {
    mocks.result = { data: data({ hasPlaybook: false, objections: [], ngPhrases: [] }), isError: false };
    const { unmount } = renderCard();
    expect(screen.getByRole('link', { name: '営業の手引きを開く' })).toHaveAttribute(
      'href',
      '/ja/settings/ax-playbook'
    );
    unmount();
    mocks.result = { data: undefined, isError: true, error: { data: { code: 'FORBIDDEN' } } };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('says so in the card when it could not be loaded, with a retry (#431)', () => {
    const refetch = vi.fn();
    mocks.result = {
      data: undefined,
      isError: true,
      error: { data: { code: 'INTERNAL_SERVER_ERROR' } },
      refetch,
    };
    renderCard();
    expect(screen.getByRole('heading', { name: '切り返しカード' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした');
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
