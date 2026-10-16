/**
 * Builder diagnoses on the lead page (Refs #121): the card (full and compact for the slim
 * sheet), the answers tab and the timeline. Real ja messages, tRPC mocked, fictional data only.
 */
import { LeadActivityCard } from '@/components/features/lead-activity/lead-activity-card';
import { LeadDiagnosisAnswers } from '@/components/features/leads/detail/lead-diagnosis-answers';
import { LeadDiagnosisCard } from '@/components/features/leads/detail/lead-diagnosis-card';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const SUBMISSION = '44444444-4444-4444-8444-444444444444';

const mocks = vi.hoisted(() => ({
  events: [] as unknown[],
  answers: undefined as unknown,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leadActivity: {
      list: {
        useQuery: () => ({
          data: { items: mocks.events, nextCursor: null },
          isLoading: false,
          isError: false,
        }),
        useInfiniteQuery: () => ({
          data: { pages: [{ items: mocks.events, nextCursor: null }] },
          isLoading: false,
          isError: false,
          hasNextPage: false,
          isFetchingNextPage: false,
          refetch: vi.fn(),
          fetchNextPage: vi.fn(),
        }),
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

const summary = {
  diagnosisId: '55555555-5555-4555-8555-555555555555',
  slug: 'cloud-check',
  title: 'クラウド準備度チェック（テスト用）',
  version: 2,
  versionId: '66666666-6666-4666-8666-666666666666',
  submissionId: SUBMISSION,
  diagnosedAt: '2026-10-16T01:30:00.000Z',
  resultTypeId: 'planner',
  resultTypeName: '計画型',
  overall: 48,
  leadScore: 70,
  leadScoreReasons: ['担当者が100人以上', '今年中に移行の予定がある'],
  mqlLevel: 'interest',
  mqlQualified: true,
  mqlReasons: ['今年中に移行する予定（強いシグナル）', 'リードスコア 70 点（基準 50 点以上）'],
  consultationRequested: true,
};

const builderEvent = {
  id: `submission:${SUBMISSION}`,
  kind: 'diagnosis_submitted',
  at: new Date('2026-10-16T01:30:00Z'),
  actor: null,
  submissionId: SUBMISSION,
  verified: true,
  continuation: false,
  summary: {
    diagnosticKey: 'd:55555555-5555-4555-8555-555555555555',
    platform: null,
    difficulty: null,
    urgency: null,
    primaryChallenge: null,
    needsHearing: false,
    detailsAnswered: false,
    mqlLevel: 'interest',
    builder: { title: summary.title, version: 2, resultTypeName: '計画型', leadScore: 70 },
  },
};

const wrap = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {node}
    </NextIntlClientProvider>
  );

const value = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;

beforeEach(() => {
  mocks.events = [];
  mocks.answers = undefined;
});

describe('LeadDiagnosisCard: builder diagnosis', () => {
  it('shows the diagnosis, version, result, score with reasons and MQL with reasons', async () => {
    const onShowAnswers = vi.fn();
    wrap(<LeadDiagnosisCard responses={{ diagnosis: summary }} onShowAnswers={onShowAnswers} />);
    const block = screen.getByTestId('lead-builder-diagnosis');
    expect(
      within(block).getByRole('heading', { name: 'クラウド準備度チェック（テスト用） 第2版' })
    ).toBeInTheDocument();
    expect(value('結果タイプ')).toHaveTextContent('計画型');
    expect(screen.getByTestId('lead-builder-score')).toHaveTextContent(
      '70 / 100担当者が100人以上今年中に移行の予定がある'
    );
    expect(screen.getByTestId('lead-builder-mql')).toHaveTextContent(
      '関心あり（MQL）今年中に移行する予定（強いシグナル）・リードスコア 70 点（基準 50 点以上）'
    );
    expect(value('診断日時')).toHaveTextContent('2026/10/16 10:30');
    // Same badges as the AX diagnosis
    expect(screen.getByText('相談の申込みあり')).toBeInTheDocument();
    expect(screen.getByText('関心あり（MQL）', { selector: '[title]' })).toHaveAttribute(
      'title',
      expect.stringContaining('今年中に移行する予定')
    );
    // Nothing of the summary is repeated as other data
    expect(screen.queryByText(/その他のデータ/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /回答を見る/ }));
    expect(onShowAnswers).toHaveBeenCalledWith(SUBMISSION);
  });

  it('shows 適合 and 対象外 with their wording', () => {
    const { unmount } = wrap(
      <LeadDiagnosisCard
        responses={{ diagnosis: { ...summary, mqlLevel: 'fit', mqlQualified: false, mqlReasons: [] } }}
      />
    );
    expect(screen.getByText('適合', { selector: '[title]' })).toBeInTheDocument();
    expect(screen.getByTestId('lead-builder-mql')).toHaveTextContent(
      '適合必須条件は満たしています。関心を示す回答・行動はまだありません'
    );
    unmount();
    wrap(
      <LeadDiagnosisCard
        responses={{
          diagnosis: { ...summary, mqlLevel: 'none', mqlQualified: false, mqlReasons: [] },
        }}
      />
    );
    expect(screen.getByTestId('lead-builder-mql')).toHaveTextContent(
      '対象外診断の必須条件を満たしていません'
    );
    expect(screen.queryByText('関心あり（MQL）', { selector: '[title]' })).not.toBeInTheDocument();
  });

  it('has a compact version for the side panel with a link to the answers', () => {
    wrap(
      <LeadDiagnosisCard
        compact
        responses={{ diagnosis: summary }}
        answersHref={(id) => `/ja/leads/${LEAD_ID}?tab=diagnosis&submission=${id}`}
      />
    );
    const block = screen.getByTestId('lead-builder-diagnosis');
    expect(within(block).getByText('計画型 · リードスコア 70 / 100')).toBeInTheDocument();
    expect(within(block).getByText('関心あり（MQL）')).toBeInTheDocument();
    expect(within(block).getByRole('link')).toHaveAttribute(
      'href',
      `/ja/leads/${LEAD_ID}?tab=diagnosis&submission=${SUBMISSION}`
    );
    expect(screen.queryByText('結果タイプ')).not.toBeInTheDocument();
  });
});

describe('answers tab and timeline: builder submissions', () => {
  beforeEach(() => {
    mocks.events = [builderEvent];
    // Labels as getSubmissionAnswers builds them from the answered version
    mocks.answers = {
      answers: [
        {
          questionId: 'hosting',
          question: { ja: 'システムはどこで動いていますか', en: 'システムはどこで動いていますか' },
          detail: false,
          values: [{ value: 'onprem', label: { ja: '自社設備', en: '自社設備' } }],
        },
        {
          questionId: 'team_size',
          question: { ja: '担当者の人数', en: '担当者の人数' },
          detail: false,
          values: [{ value: '150', label: { ja: '150人', en: '150人' } }],
        },
      ],
    };
  });

  it('lists the submission with its diagnosis, version and MQL, and its labelled answers', () => {
    wrap(<LeadDiagnosisAnswers organizationId={ORG_ID} leadId={LEAD_ID} />);
    expect(screen.getByTestId('lead-answers-builder')).toHaveTextContent(
      'クラウド準備度チェック（テスト用） 第2版'
    );
    expect(screen.getByText('計画型')).toBeInTheDocument();
    expect(screen.getByText('関心あり（MQL）')).toBeInTheDocument();
    // The newest submission is open
    expect(screen.getByText('システムはどこで動いていますか')).toBeInTheDocument();
    expect(screen.getByText('自社設備')).toBeInTheDocument();
    expect(screen.getByText('150人')).toBeInTheDocument();
  });

  it('shows the builder submission in the timeline like an AX one, with the MQL level', () => {
    wrap(<LeadActivityCard leadId={LEAD_ID} />);
    expect(
      screen.getByText(
        'クラウド準備度チェック（テスト用） 第2版 / 結果: 計画型 / リードスコア: 70 / 100'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('関心あり（MQL）')).toBeInTheDocument();
    expect(screen.queryByText(/移行元/)).not.toBeInTheDocument();
  });

  it('shows the MQL level of an AX submission in the timeline too', () => {
    mocks.events = [
      {
        ...builderEvent,
        summary: {
          diagnosticKey: 'ax-migration',
          platform: 'as400',
          difficulty: 'high',
          urgency: 'medium',
          primaryChallenge: 'people',
          needsHearing: false,
          detailsAnswered: false,
          mqlLevel: 'fit',
        },
      },
    ];
    wrap(<LeadActivityCard leadId={LEAD_ID} />);
    expect(screen.getByText(/移行元: AS\/400/)).toBeInTheDocument();
    expect(screen.getByText('適合')).toBeInTheDocument();
  });
});
