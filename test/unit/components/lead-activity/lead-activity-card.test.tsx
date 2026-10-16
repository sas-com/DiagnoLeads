/**
 * Activity card on the lead details (real next-intl messages, tRPC mocked) — Refs #101
 */
import { LeadActivityCard } from '@/components/features/lead-activity/lead-activity-card';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const SUBMISSION_ID = '880e8400-e29b-41d4-a716-446655440000';

const mocks = vi.hoisted(() => ({
  listInputs: [] as unknown[],
  list: {} as Record<string, unknown>,
  fetchNextPage: vi.fn(),
  answers: undefined as unknown,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leadActivity: {
      list: {
        useInfiniteQuery: (input: unknown) => {
          mocks.listInputs.push(input);
          return {
            isLoading: false,
            isError: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            refetch: vi.fn(),
            fetchNextPage: mocks.fetchNextPage,
            ...mocks.list,
          };
        },
      },
      submissionAnswers: {
        useQuery: () => ({ data: mocks.answers, isLoading: false, isError: false }),
      },
    },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));

const diagnosis = (overrides: Record<string, unknown> = {}) => ({
  id: `submission:${SUBMISSION_ID}`,
  kind: 'diagnosis_submitted',
  at: new Date('2026-10-05T01:00:00Z'),
  actor: null,
  submissionId: SUBMISSION_ID,
  verified: false,
  continuation: false,
  summary: {
    diagnosticKey: 'ax-migration',
    platform: 'as400',
    difficulty: 'high',
    urgency: 'medium',
    primaryChallenge: 'people',
    needsHearing: false,
    detailsAnswered: false,
  },
  ...overrides,
});

const update = {
  id: 'audit:1',
  kind: 'lead_updated',
  at: new Date('2026-10-06T01:00:00Z'),
  actor: { id: 'u1', name: '営業 一郎' },
  changes: [
    { field: 'dealPhase', before: 'initial_hearing', after: 'proposal' },
    { field: 'mqlQualified', before: false, after: true },
    { field: 'lostReason', before: 'budget', after: null },
  ],
};

const pages = (...items: unknown[]) => ({ pages: [{ items, nextCursor: null }] });

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadActivityCard leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listInputs = [];
  mocks.list = {};
  mocks.answers = undefined;
});

describe('LeadActivityCard', () => {
  it('marks an unverified diagnosis and explains it', () => {
    mocks.list = { data: pages(diagnosis()) };
    renderCard();

    expect(screen.getByText('Web診断の回答')).toBeInTheDocument();
    expect(screen.getByText('本人未確認')).toBeInTheDocument();
    expect(
      screen.getByText('同じメールアドレスからの回答。リードの項目は変更していません')
    ).toBeInTheDocument();
    expect(
      screen.getByText('移行元: AS/400（IBM i） / 難易度: 高 / 緊急度: 中 / 主な課題: ヒト：人に依存した基幹システム')
    ).toBeInTheDocument();
    // Absolute time in Japan (10:00 JST)
    expect(screen.getByText(/2026\/10\/05 10:00/)).toBeInTheDocument();
  });

  it('marks a continuation, and no unverified badge on a verified diagnosis', () => {
    mocks.list = { data: pages(diagnosis({ verified: true, continuation: true })) };
    renderCard();

    expect(screen.queryByText('本人未確認')).not.toBeInTheDocument();
    expect(screen.getByText('同じ画面から続けて診断')).toBeInTheDocument();
  });

  it('lists the changed fields of a staff update with labels and the actor', () => {
    mocks.list = { data: pages(update) };
    renderCard();

    expect(screen.getByText('リードを更新')).toBeInTheDocument();
    expect(screen.getByText('初回ヒアリング → 提案')).toBeInTheDocument();
    expect(screen.getByText('フェーズ:', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('未判定 → MQL')).toBeInTheDocument();
    expect(screen.getByText('予算 → 未設定')).toBeInTheDocument();
    expect(screen.getByText(/営業 一郎/)).toBeInTheDocument();
  });

  it('opens the answers of a diagnosis', async () => {
    mocks.list = { data: pages(diagnosis({ verified: true })) };
    mocks.answers = {
      answers: [
        {
          questionId: 'platform',
          question: { ja: '移行を検討しているシステムは？', en: 'Which system?' },
          detail: false,
          values: [{ value: 'as400', label: { ja: 'AS/400（IBM i）', en: 'AS/400 (IBM i)' } }],
        },
      ],
    };
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: '回答を見る' }));
    expect(screen.getByText('移行を検討しているシステムは？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回答を閉じる' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('filters by kind', async () => {
    mocks.list = { data: pages(update) };
    renderCard();
    expect(mocks.listInputs.at(-1)).not.toHaveProperty('types');

    await userEvent.click(screen.getByRole('button', { name: '診断・相談' }));
    expect(mocks.listInputs.at(-1)).toMatchObject({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      types: ['diagnosis_submitted', 'consultation_requested', 'details_answered'],
    });
    expect(screen.getByRole('button', { name: '診断・相談' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('loads more when there is a next page', async () => {
    mocks.list = { data: pages(update), hasNextPage: true };
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'もっと見る' }));
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('hides "show more" on the last page', () => {
    mocks.list = { data: pages(update) };
    renderCard();
    expect(screen.queryByRole('button', { name: 'もっと見る' })).not.toBeInTheDocument();
  });

  it('shows empty, loading and error states', async () => {
    mocks.list = { data: pages() };
    const { unmount } = renderCard();
    expect(screen.getByText('まだ履歴はありません。')).toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    mocks.list = { data: undefined, isError: true, refetch };
    renderCard();
    expect(screen.getByText('活動履歴を読み込めませんでした。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalled();
  });
});
