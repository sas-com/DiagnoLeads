/**
 * What the dashboard showed, where it went (#1164, decision 2026-11-14-navigation-one-path): the
 * team's review on the analytics page (where things stand, the analytics panel, the meeting rate,
 * the pipeline), and the team's inbox on 今日 (the waiting requests, the newest leads). Real
 * next-intl messages; tRPC and charts mocked. Ported from the dashboard page's test.
 */
import {
  type CardState,
  PendingSection,
  RecentSection,
} from '@/components/dashboard/ax-dashboard-sections';
import { TeamReview, teamReviewDays } from '@/components/dashboard/team-review';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  data: undefined as unknown,
  dataUpdatedAt: 0,
  isError: false,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    analytics: {
      getDashboard: {
        useQuery: (input: unknown) => {
          mocks.query(input);
          return {
            data: mocks.data,
            dataUpdatedAt: mocks.dataUpdatedAt,
            isLoading: !mocks.data && !mocks.isError,
            isError: mocks.isError,
            isPlaceholderData: false,
            refetch: mocks.refetch,
          };
        },
      },
    },
    // The status block's figures (#410); the lists themselves are mocked below
    leadFollowUp: {
      dueTasks: { useQuery: () => ({ data: { total: 5 }, isLoading: false }) },
    },
    leads: {
      weekMeetings: { useQuery: () => ({ data: { total: 2 }, isLoading: false }) },
    },
  },
}));
// The meeting cards (#137) have their own tests (meeting-sections.test.tsx)
vi.mock('@/components/dashboard/meeting-sections', () => ({
  NextMeetingRateSection: ({ days }: { days: number }) => (
    <div data-testid="next-meeting-rate" data-days={days} />
  ),
}));
vi.mock('@/components/features/lead-follow-up/contact-quick-actions', () => ({
  ContactQuickActions: ({ leadId, leadLabel }: { leadId: string; leadLabel: string }) => (
    <div data-testid="contact-actions" data-lead={leadId}>
      {leadLabel}
    </div>
  ),
}));
vi.mock('@/components/charts', () => ({
  AreaChart: (props: { categories: string[]; colors: string[]; data: unknown[] }) => (
    <pre data-testid="area-chart">
      {JSON.stringify({ categories: props.categories, colors: props.colors, data: props.data })}
    </pre>
  ),
  BarChart: (props: { categories: string[]; colors: string[]; stacked?: boolean; data: unknown[] }) => (
    <pre data-testid="bar-chart">
      {JSON.stringify({
        categories: props.categories,
        colors: props.colors,
        stacked: props.stacked,
        data: props.data,
      })}
    </pre>
  ),
}));

const lead = (overrides: Record<string, unknown>) => ({
  id: 'lead-x',
  name: '担当 太郎',
  company: '会社',
  platform: 'as400',
  status: 'new',
  mql: false,
  consultation: false,
  createdAt: new Date('2026-10-01T03:00:00Z'),
  ...overrides,
});

const summary = {
  days: 30,
  newLeads: 6,
  previousNewLeads: 0,
  consultations: 3,
  previousConsultations: 1,
  mql: 4,
  previousMql: 5,
  fitOnly: 2,
  daily: [
    { date: '2026-10-15', leads: 1, consultations: 1 },
    { date: '2026-10-16', leads: 3, consultations: 1 },
  ],
  trend: {
    unit: 'day',
    points: [
      { start: '2026-10-15', end: '2026-10-15', leads: 1, consultations: 1 },
      { start: '2026-10-16', end: '2026-10-16', leads: 3, consultations: 1 },
    ],
  },
  statuses: [
    { status: 'new', count: 4 },
    { status: 'nurturing', count: 1 },
    { status: 'negotiating', count: 1 },
    { status: 'won', count: 0 },
    { status: 'lost', count: 0 },
  ],
  platforms: [
    { platform: 'as400', count: 3 },
    { platform: 'unknown', count: 1 },
  ],
  pendingConsultations: [
    {
      id: 'lead-1',
      name: '山田 太郎',
      company: '三田製作所',
      platform: 'as400',
      requestedAt: new Date('2026-09-25T02:00:00Z'),
      deadline: '2026/09/29',
      noAnswerCount: 2,
      overdue: true,
      due: 'overdue',
      businessDays: 5,
    },
    {
      id: 'lead-2',
      name: '佐藤 花子',
      company: '北辰工業',
      platform: 'acos',
      requestedAt: new Date('2026-10-14T02:00:00Z'),
      deadline: '2026/10/16',
      overdue: false,
      due: 'today',
      businessDays: 0,
    },
    {
      id: 'lead-4',
      name: '鈴木 一',
      company: '南星電機',
      platform: 'access',
      requestedAt: new Date('2026-10-15T02:00:00Z'),
      deadline: '2026/10/17',
      overdue: false,
      due: 'tomorrow',
      businessDays: 1,
    },
    {
      id: 'lead-5',
      name: '高木 二郎',
      company: '東邦精工',
      platform: 'other',
      requestedAt: new Date('2026-10-16T02:00:00Z'),
      deadline: '2026/10/21',
      overdue: false,
      due: 'later',
      businessDays: 3,
    },
  ],
  pendingConsultationTotal: 12,
  recentLeads: [
    lead({
      id: 'lead-3',
      name: '渡辺 恵',
      company: '大成化学',
      platform: 'other',
      status: 'nurturing',
      createdAt: new Date(),
    }),
    lead({
      id: 'lead-1',
      name: '山田 太郎',
      company: '三田製作所',
      consultation: true,
      mql: true,
      createdAt: new Date('2026-09-12T02:00:00Z'),
    }),
  ],
};

const wrap = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {node}
    </NextIntlClientProvider>
  );
const renderReview = (days: 7 | 30 | 90 = 30) =>
  wrap(<TeamReview organizationId={ORG_ID} days={days} />);
const cardState = (): CardState => (mocks.data ? 'ready' : mocks.isError ? 'error' : 'loading');
type Summary = Parameters<typeof PendingSection>[0]['data'];
const renderPending = (canRecordContact = false) =>
  wrap(
    <PendingSection
      state={cardState()}
      data={mocks.data as Summary}
      onRetry={mocks.refetch}
      organizationId={ORG_ID}
      canRecordContact={canRecordContact}
    />
  );
const renderRecent = () =>
  wrap(<RecentSection state={cardState()} data={mocks.data as Summary} onRetry={mocks.refetch} />);

const chartProps = () =>
  JSON.parse(screen.getByTestId('area-chart').textContent ?? '{}') as {
    categories: string[];
    colors: string[];
    data: Record<string, unknown>[];
  };
const follows = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = summary;
  mocks.isError = false;
  mocks.dataUpdatedAt = 0;
});

describe('the team review on the analytics page', () => {
  it('reads the days of the period chosen on the page, "all" as the longest', () => {
    expect(['7d', '30d', '90d', 'all'].map(teamReviewDays)).toEqual([7, 30, 90, 90]);
    renderReview(7);
    expect(mocks.query).toHaveBeenLastCalledWith({ organizationId: ORG_ID, days: 7 });
    expect(screen.getByTestId('next-meeting-rate')).toHaveAttribute('data-days', '7');
  });

  it('shows each figure with its change from the previous period, never made-up changes', () => {
    renderReview();

    expect(mocks.query).toHaveBeenCalledWith({ organizationId: ORG_ID, days: 30 });
    const insights = within(screen.getByTestId('insights'));
    expect(insights.getByRole('heading', { name: '過去30日間のインサイト' })).toBeInTheDocument();
    // New leads 6 vs 0: up, but no percent against nothing; the previous value is still named
    const leads = insights.getByText('新規リードが前の30日間より増えました').parentElement as HTMLElement;
    expect(within(leads).getByText('6件')).toBeInTheDocument();
    expect(within(leads).queryByText(/%/)).not.toBeInTheDocument();
    expect(within(leads).getByText('前の30日間 0件')).toBeInTheDocument();
    // Consultations 3 vs 1, MQL 4 vs 5 (関心あり only, 適合のみ beside it, #139)
    const consultations = insights.getByText('相談申込が前の30日間より増えました')
      .parentElement as HTMLElement;
    expect(within(consultations).getByText(/200\.0%/)).toHaveClass('text-[var(--color-semantic-success-2)]');
    const mql = insights.getByText('MQL（関心あり）が前の30日間より減りました').parentElement as HTMLElement;
    expect(within(mql).getByText(/20\.0%/)).toHaveClass('text-[var(--color-semantic-error-1)]');
    expect(within(mql).getByText('前の30日間 5件 / ほかに適合のみ 2件')).toBeInTheDocument();
    // No average score: the MQL level is the sign of how promising leads are (#447)
    expect(insights.queryByText(/平均スコア/)).not.toBeInTheDocument();
    expect(screen.queryByText(/前月比/)).not.toBeInTheDocument();
  });

  it('opens with where things stand, each figure a link: the next actions open 今日 (#410, #1164)', () => {
    renderReview();

    const status = within(screen.getByTestId('status-overview'));
    expect(status.getByRole('heading', { name: '対応状況' })).toBeInTheDocument();
    expect(status.getByRole('link', { name: /返信待ちの相談\s*12/ })).toHaveAttribute(
      'href',
      '/ja/leads?status=new&consult=1'
    );
    expect(status.getByRole('link', { name: /今日までの次の行動（自分）\s*5/ })).toHaveAttribute(
      'href',
      '/ja/today'
    );
    expect(status.getByRole('link', { name: /今週の商談\s*2/ })).toBeInTheDocument();
    expect(status.getByRole('link', { name: /リード一覧/ })).toHaveAttribute('href', '/ja/leads');
  });

  it('orders the status, the analytics panel, the meeting rate and the pipeline, with no link to itself', () => {
    renderReview();

    const blocks = [
      screen.getByTestId('status-overview'),
      screen.getByTestId('analytics-panel'),
      screen.getByTestId('next-meeting-rate'),
      screen.getByTestId('pipeline'),
    ];
    for (let i = 1; i < blocks.length; i++) expect(follows(blocks[i - 1], blocks[i])).toBe(true);
    // It stands on the analytics page: no link to it
    expect(
      within(screen.getByTestId('analytics-panel')).queryByRole('link', { name: /分析/ })
    ).not.toBeInTheDocument();
  });

  it('links each pipeline row to the lead list', () => {
    renderReview();

    const rows = within(screen.getByTestId('pipeline')).getAllByRole('link');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/ja/leads?status=new',
      '/ja/leads?status=nurturing',
      '/ja/leads?status=negotiating',
      '/ja/leads?status=won',
      '/ja/leads?status=lost',
    ]);
  });

  it('draws the figure of the period as a curve, switching between new leads and consultations', async () => {
    const user = userEvent.setup();
    renderReview();

    const panel = within(screen.getByTestId('analytics-panel'));
    expect(panel.getByText('4')).toBeInTheDocument();
    expect(chartProps()).toEqual({
      categories: ['新規リード数'],
      colors: ['key'],
      data: [
        { date: '10/15', 新規リード数: 1 },
        { date: '10/16', 新規リード数: 3 },
      ],
    });
    expect(panel.getByRole('img')).toHaveAccessibleName('直近30日の新規リード数は4件');

    await user.selectOptions(panel.getByRole('combobox', { name: '表示する数' }), 'consultations');
    expect(chartProps().data).toEqual([
      { date: '10/15', 相談申込数: 1 },
      { date: '10/16', 相談申込数: 1 },
    ]);
    expect(panel.getByText('2')).toBeInTheDocument();
  });

  it('labels weekly bars for 90 days', () => {
    mocks.data = {
      ...summary,
      days: 90,
      trend: {
        unit: 'week',
        points: [
          { start: '2026-07-19', end: '2026-07-19', leads: 1, consultations: 0 },
          { start: '2026-07-20', end: '2026-07-26', leads: 5, consultations: 2 },
        ],
      },
    };
    renderReview(90);

    expect(chartProps().data.map((d) => d.date)).toEqual(['7/19〜', '7/20〜']);
    expect(screen.getByText('直近90日・週ごと（日本時間）')).toBeInTheDocument();
  });

  it('dates the figures with the time they were fetched (DADS guidebook, #635)', () => {
    // 2026-10-25 05:07 UTC = 14:07 in Japan
    mocks.dataUpdatedAt = Date.UTC(2026, 9, 25, 5, 7);
    renderReview();
    expect(screen.getByText(/10\/25 14:07時点/)).toBeInTheDocument();
  });

  it('puts "unknown" last with a gray bar', () => {
    renderReview();

    const unknown = screen.getByText('不明（AX診断以外）').closest('li');
    expect(unknown?.querySelector('.bg-gray-400')).not.toBeNull();
    const sources = within(screen.getByTestId('analytics-panel')).getAllByRole('listitem');
    expect(sources.at(-1)).toBe(unknown);
  });

  it('says so when the period has no leads', () => {
    mocks.data = {
      ...summary,
      newLeads: 0,
      trend: { unit: 'day', points: summary.trend.points.map((p) => ({ ...p, leads: 0, consultations: 0 })) },
      platforms: [],
    };
    renderReview();

    expect(screen.getAllByText('この期間のリードはありません')).toHaveLength(2);
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('shows placeholders while loading, never an empty chart or a 0 for the waiting requests', () => {
    mocks.data = undefined;
    renderReview();

    expect(screen.getByTestId('chart-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('status-overview')).queryByText('0')).not.toBeInTheDocument();
  });

  it('shows an error with a reload button in the analytics panel and the pipeline', async () => {
    const user = userEvent.setup();
    mocks.isError = true;
    mocks.data = undefined;
    renderReview();

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) expect(alert).toHaveTextContent('読み込めませんでした');
    await user.click(within(alerts[0]).getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('the waiting requests on 今日', () => {
  it('shows lateness in business days next to the deadline, linked to the lead', () => {
    renderPending();

    const overdue = screen.getByRole('link', { name: /5営業日超過.*期限 9\/29.*三田製作所/ });
    expect(overdue).toHaveAttribute('href', '/ja/leads/lead-1');
    expect(screen.getByRole('link', { name: /今日まで.*期限 10\/16.*北辰工業/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /明日まで.*期限 10\/17.*南星電機/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /あと3営業日.*期限 10\/21.*東邦精工/ })).toBeInTheDocument();
    // Requested date in the same M/D form
    expect(screen.getByText(/申込 9\/25/)).toBeInTheDocument();
  });

  it('links the rest of the waiting requests to the lead list', () => {
    renderPending();
    expect(screen.getByRole('link', { name: 'ほか8件をリード一覧で見る' })).toHaveAttribute(
      'href',
      '/ja/leads?status=new&consult=1'
    );
  });

  it('offers the one-tap contact buttons on each waiting request only to staff who can edit leads', () => {
    const { unmount } = renderPending(false);
    expect(screen.queryByTestId('contact-actions')).not.toBeInTheDocument();
    unmount();

    renderPending(true);
    const actions = screen.getAllByTestId('contact-actions');
    expect(actions.map((a) => a.getAttribute('data-lead'))).toEqual(
      (summary.pendingConsultations as { id: string }[]).map((p) => p.id)
    );
    expect(actions[0]).toHaveTextContent('三田製作所');
    // The buttons sit beside the link to the lead, not inside it
    expect(actions[0].closest('a')).toBeNull();
    expect(screen.getByText(/「電話した」「メールした」を記録すると一覧から外れます（「つながらなかった」は残ります）/)).toBeInTheDocument();
    // Calls that did not get through keep the request waiting, with the count
    expect(screen.getAllByText(/^不通 \d+回$/).map((e) => e.textContent)).toEqual(['不通 2回']);
  });

  it('says so when nothing is waiting, and never while loading or failing', async () => {
    mocks.data = { ...summary, pendingConsultations: [], pendingConsultationTotal: 0 };
    const first = renderPending();
    expect(screen.getByText('連絡待ちの相談申込はありません')).toBeInTheDocument();
    first.unmount();

    mocks.data = undefined;
    const loading = renderPending();
    expect(screen.getAllByTestId('card-skeleton').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('連絡待ちの相談申込はありません')).not.toBeInTheDocument();
    loading.unmount();

    const user = userEvent.setup();
    mocks.isError = true;
    renderPending();
    expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした');
    expect(screen.queryByText('連絡待ちの相談申込はありません')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('the newest leads on 今日', () => {
  it('lists recent leads by company with status, received time and the MQL tag, without scores', () => {
    renderRecent();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('大成化学')).toBeInTheDocument();
    expect(within(rows[1]).getByText('渡辺 恵')).toBeInTheDocument();
    expect(within(rows[1]).getByText('ナーチャリング')).toHaveClass('bg-yellow-100');
    expect(within(rows[1]).getByText(/^今日 \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(rows[2]).getByText('9/12')).toBeInTheDocument();
    expect(within(rows[2]).getByText('MQL')).toBeInTheDocument();
    // The score column is gone (#447)
    expect(within(table).queryByRole('columnheader', { name: /スコア/ })).not.toBeInTheDocument();
  });

  it('renders recent leads as a two-line list for phones', () => {
    renderRecent();

    const list = screen.getByTestId('recent-list');
    expect(list).toHaveClass('sm:hidden');
    const items = within(list).getAllByRole('link');
    expect(items[0]).toHaveAttribute('href', '/ja/leads/lead-3');
    expect(within(items[0]).getByText('大成化学')).toBeInTheDocument();
    expect(within(items[0]).getByText('ナーチャリング')).toBeInTheDocument();
    expect(within(items[1]).getByText('相談申込')).toBeInTheDocument();
  });

  it('says so when there is no lead yet', () => {
    mocks.data = { ...summary, recentLeads: [] };
    renderRecent();
    expect(screen.getByText('まだリードがありません')).toBeInTheDocument();
  });
});
