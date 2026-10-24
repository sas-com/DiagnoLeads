/**
 * "When to act" on the lead page (#151): the month, how it was worked out and the next action;
 * nothing without the dates; "not followed" for won leads and leads lost for another reason.
 */
import { ActTimingCard } from '@/components/features/act-timing/act-timing-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: { actTiming: { get: { useQuery: () => mocks.result } } },
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const data = (values: Record<string, unknown> = {}) => ({
  timing: {
    actBy: '2028-12',
    deadline: { month: '2030-03', source: 'retirement' },
    start: '2029-03',
    budgetPlanning: '2028-12',
    noticeOn: '2028-09-01',
  },
  followed: true,
  settings: { migrationMonths: 12, noticeMonths: 3 },
  task: { dueOn: '2028-09-01', done: false },
  ...values,
});

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <ActTimingCard organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.result = { data: data(), isError: false };
});

describe('ActTimingCard', () => {
  it('shows the month and how it was worked out', () => {
    renderCard();
    expect(screen.getByText('2028年12月')).toBeInTheDocument();
    expect(screen.getByText('担当者の退職予定：2030年3月（ヒアリング）')).toBeInTheDocument();
    expect(screen.getByText('移行に 12か月かかるとして、開始は 2029年3月')).toBeInTheDocument();
    expect(screen.getByText(/予算策定の時期 2028年12月/)).toBeInTheDocument();
    expect(screen.getByText(/再接触の「次の行動」を 2028\/09\/01 に入れています/)).toBeInTheDocument();
  });

  it('marks leads that are not followed, without the next action', () => {
    mocks.result = { data: data({ followed: false }), isError: false };
    renderCard();
    expect(screen.getByText(/対象外/)).toBeInTheDocument();
    expect(screen.queryByText(/次の行動/)).not.toBeInTheDocument();
  });

  it('shows nothing when the dates are unknown', () => {
    mocks.result = { data: data({ timing: null }), isError: false };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('says so in the card when it could not be loaded, with a retry (#431)', () => {
    const refetch = vi.fn();
    mocks.result = { data: undefined, isError: true, error: { data: undefined }, refetch };
    renderCard();
    expect(screen.getByRole('heading', { name: '動くべき時期' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした');
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('stays hidden from those who may not read it', () => {
    mocks.result = { data: undefined, isError: true, error: { data: { code: 'FORBIDDEN' } } };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
