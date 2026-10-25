/**
 * Dashboard (real next-intl messages; tRPC, organization and charts mocked)
 */
import DashboardPage from '@/app/[locale]/(dashboard)/dashboard/page';
import {
  moveWidget,
  reconcileWidgetConfig,
  visibleWidgetIds,
} from '@/components/dashboard/widget-settings';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  data: undefined as unknown,
  dataUpdatedAt: 0,
  isError: false,
  organizationId: '660e8400-e29b-41d4-a716-446655440000' as string | null,
  canEdit: false,
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
vi.mock('@/hooks/use-leads', () => ({
  useLeadAccess: () => ({ canEdit: mocks.canEdit, canDelete: false }),
}));
// The follow-up parts have their own tests (test/unit/components/lead-follow-up)
vi.mock('@/components/features/lead-follow-up/due-tasks-section', () => ({
  DueTasksSection: () => <div data-testid="due-tasks" />,
}));
// The meeting cards (#137) have their own tests (meeting-sections.test.tsx)
vi.mock('@/components/dashboard/meeting-sections', () => ({
  WeekMeetingsSection: () => <div data-testid="week-meetings" />,
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
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: mocks.organizationId, isLoading: false }),
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

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <DashboardPage />
    </NextIntlClientProvider>
  );

const chartProps = () =>
  JSON.parse(screen.getByTestId('area-chart').textContent ?? '{}') as {
    categories: string[];
    colors: string[];
    data: Record<string, unknown>[];
  };
const follows = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.data = summary;
    mocks.isError = false;
    mocks.organizationId = ORG_ID;
    mocks.canEdit = false;
  });

  it('shows each figure with its change from the previous period, never made-up changes', () => {
    renderPage();

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

  it('opens with where things stand: waiting requests, next actions and meetings, each a link (#410)', () => {
    renderPage();

    const status = within(screen.getByTestId('status-overview'));
    expect(status.getByRole('heading', { name: '対応状況' })).toBeInTheDocument();
    expect(status.getByRole('link', { name: /返信待ちの相談\s*12/ })).toHaveAttribute(
      'href',
      '/ja/leads?status=new&consult=1'
    );
    expect(status.getByRole('link', { name: /今日までの次の行動（自分）\s*5/ })).toHaveAttribute(
      'href',
      '#dashboard-today'
    );
    expect(status.getByRole('link', { name: /今週の商談\s*2/ })).toBeInTheDocument();
    expect(status.getByRole('link', { name: /リード一覧/ })).toHaveAttribute('href', '/ja/leads');
  });

  it('shows lateness in business days next to the deadline, linked to the lead', () => {
    renderPage();

    const overdue = screen.getByRole('link', { name: /5営業日超過.*期限 9\/29.*三田製作所/ });
    expect(overdue).toHaveAttribute('href', '/ja/leads/lead-1');
    expect(screen.getByRole('link', { name: /今日まで.*期限 10\/16.*北辰工業/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /明日まで.*期限 10\/17.*南星電機/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /あと3営業日.*期限 10\/21.*東邦精工/ })).toBeInTheDocument();
    // Requested date in the same M/D form
    expect(screen.getByText(/申込 9\/25/)).toBeInTheDocument();
  });

  it('links the rest of the waiting requests and the pipeline rows to the lead list', () => {
    renderPage();

    // Filtered lists (#131): the waiting requests, and one status per pipeline row
    expect(screen.getByRole('link', { name: 'ほか8件をリード一覧で見る' })).toHaveAttribute(
      'href',
      '/ja/leads?status=new&consult=1'
    );
    const rows = within(screen.getByTestId('pipeline')).getAllByRole('link');
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/ja/leads?status=new',
      '/ja/leads?status=nurturing',
      '/ja/leads?status=negotiating',
      '/ja/leads?status=won',
      '/ja/leads?status=lost',
    ]);
  });

  it('puts the period switch by the title, then the status, the waiting requests and the analytics', () => {
    renderPage();

    const period = screen.getByRole('group', { name: '集計期間' });
    const status = screen.getByTestId('status-overview');
    const pending = screen.getByRole('heading', { name: /連絡待ちの相談申込/ });
    const analytics = screen.getByTestId('analytics-panel');
    expect(follows(screen.getByRole('heading', { level: 1, name: 'ダッシュボード' }), period)).toBe(true);
    expect(follows(period, status)).toBe(true);
    expect(follows(status, pending)).toBe(true);
    expect(follows(pending, analytics)).toBe(true);
    expect(within(analytics).getByRole('link', { name: /分析/ })).toHaveAttribute('href', '/ja/analytics');
  });

  it('draws the figure of the period as a curve, switching between new leads and consultations', async () => {
    const user = userEvent.setup();
    renderPage();

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
    renderPage();

    expect(chartProps().data.map((d) => d.date)).toEqual(['7/19〜', '7/20〜']);
    expect(screen.getByText('直近90日・週ごと（日本時間）')).toBeInTheDocument();
  });

  it('dates the figures with the time they were fetched (DADS guidebook, #635)', () => {
    // 2026-10-25 05:07 UTC = 14:07 in Japan
    mocks.dataUpdatedAt = Date.UTC(2026, 9, 25, 5, 7);
    renderPage();
    expect(screen.getByText(/10\/25 14:07時点/)).toBeInTheDocument();
    mocks.dataUpdatedAt = 0;
  });

  it('lists recent leads by company with status, received time and the MQL tag, without scores', () => {
    renderPage();

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
    renderPage();

    const list = screen.getByTestId('recent-list');
    expect(list).toHaveClass('sm:hidden');
    const items = within(list).getAllByRole('link');
    expect(items[0]).toHaveAttribute('href', '/ja/leads/lead-3');
    expect(within(items[0]).getByText('大成化学')).toBeInTheDocument();
    expect(within(items[0]).getByText('ナーチャリング')).toBeInTheDocument();
    expect(within(items[1]).getByText('相談申込')).toBeInTheDocument();
  });

  it('puts "unknown" last with a gray bar', () => {
    renderPage();

    const unknown = screen.getByText('不明（AX診断以外）').closest('li');
    expect(unknown?.querySelector('.bg-gray-400')).not.toBeNull();
    const sources = within(screen.getByTestId('analytics-panel')).getAllByRole('listitem');
    expect(sources.at(-1)).toBe(unknown);
  });

  it('says so when there is nothing to show', () => {
    mocks.data = {
      ...summary,
      newLeads: 0,
      trend: { unit: 'day', points: summary.trend.points.map((p) => ({ ...p, leads: 0, consultations: 0 })) },
      platforms: [],
      pendingConsultations: [],
      pendingConsultationTotal: 0,
      recentLeads: [],
    };
    renderPage();

    expect(screen.getByText('連絡待ちの相談申込はありません')).toBeInTheDocument();
    expect(screen.getAllByText('この期間のリードはありません')).toHaveLength(2);
    expect(screen.getByText('まだリードがありません')).toBeInTheDocument();
    expect(screen.queryByText(/平均スコア/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('shows placeholders while loading, never an empty chart or "nothing waiting"', () => {
    mocks.data = undefined;
    renderPage();

    expect(screen.getAllByTestId('card-skeleton').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('chart-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('連絡待ちの相談申込はありません')).not.toBeInTheDocument();
    // The status block waits too, never showing 0 for the waiting requests
    expect(within(screen.getByTestId('status-overview')).queryByText('0')).not.toBeInTheDocument();
  });

  it('shows an error with a reload button in each card, never "nothing waiting"', async () => {
    const user = userEvent.setup();
    mocks.isError = true;
    mocks.data = undefined;
    renderPage();

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(4); // pending, recent, analytics, pipeline
    for (const alert of alerts) expect(alert).toHaveTextContent('読み込めませんでした');
    expect(screen.queryByText('連絡待ちの相談申込はありません')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();

    await user.click(within(alerts[0]).getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('asks to choose an organization when none is selected', () => {
    mocks.organizationId = null;
    mocks.data = undefined;
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('組織を選ぶと、ここにリードの状況が表示されます');
  });

  it('switches the period', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('radio', { name: '7日' }));
    expect(mocks.query).toHaveBeenLastCalledWith({ organizationId: ORG_ID, days: 7 });
  });

  it('orders the blocks by priority: what needs doing first, then the figures to look back on', () => {
    renderPage();

    const blocks = [
      screen.getByTestId('status-overview'),
      screen.getByRole('heading', { name: /連絡待ちの相談申込/ }),
      screen.getByTestId('due-tasks'),
      screen.getByTestId('week-meetings'),
      screen.getByRole('heading', { name: '最近のリード' }),
      screen.getByTestId('analytics-panel'),
      screen.getByTestId('next-meeting-rate'),
      screen.getByTestId('pipeline'),
    ];
    for (let i = 1; i < blocks.length; i++) expect(follows(blocks[i - 1], blocks[i])).toBe(true);
    const today = blocks[2];
    // The status block's "next actions" figure jumps to this list
    expect(today.closest('#dashboard-today')).not.toBeNull();
  });

  it('offers the one-tap contact buttons on each waiting request only to staff who can edit leads', () => {
    const { unmount } = renderPage();
    expect(screen.queryByTestId('contact-actions')).not.toBeInTheDocument();
    unmount();

    mocks.canEdit = true;
    renderPage();
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

  it('shows the meeting rate for the chosen period (#137)', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByTestId('next-meeting-rate')).toHaveAttribute('data-days', '30');
    await user.click(screen.getByRole('radio', { name: '7日' }));
    expect(screen.getByTestId('next-meeting-rate')).toHaveAttribute('data-days', '7');
  });

  it('lists every block in the customize dialog and saves the new order', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'カスタマイズ' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getAllByRole('switch')).toHaveLength(8);
    await user.click(dialog.getByRole('button', { name: '「パイプライン」を上へ' }));
    await user.click(dialog.getByRole('button', { name: '「対応状況」を下へ' }));
    await user.click(dialog.getByRole('button', { name: '保存' }));

    const status = screen.getByTestId('status-overview');
    const pending = screen.getByRole('heading', { name: /連絡待ちの相談申込/ });
    const pipeline = screen.getByTestId('pipeline');
    const rate = screen.getByTestId('next-meeting-rate');
    expect(follows(pending, status)).toBe(true);
    expect(follows(pipeline, rate)).toBe(true);
    expect(JSON.parse(localStorage.getItem('dashboard-widget-config-v3') ?? '[]')).toEqual([
      { id: 'pending', enabled: true, order: 0 },
      { id: 'status', enabled: true, order: 1 },
      { id: 'today', enabled: true, order: 2 },
      { id: 'meetings', enabled: true, order: 3 },
      { id: 'recent', enabled: true, order: 4 },
      { id: 'analytics', enabled: true, order: 5 },
      { id: 'pipeline', enabled: true, order: 6 },
      { id: 'meetingRate', enabled: true, order: 7 },
    ]);
  });

  it('hides a block, and the period switch once no shown block uses it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'カスタマイズ' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('switch', { name: 'アナリティクス' }));
    await user.click(dialog.getByRole('switch', { name: '次回日程の決定率' }));
    await user.click(dialog.getByRole('button', { name: '保存' }));

    expect(screen.queryByTestId('analytics-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-meeting-rate')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '集計期間' })).not.toBeInTheDocument();
    expect(screen.getByTestId('status-overview')).toBeInTheDocument();
  });

  it('carries hidden blocks over from the previous settings but uses the priority order', () => {
    localStorage.setItem(
      'dashboard-widget-config-v2',
      JSON.stringify([
        { id: 'kpis', enabled: false, order: 0 },
        { id: 'trend', enabled: false, order: 1 },
        { id: 'breakdown', enabled: false, order: 2 },
        { id: 'recent', enabled: true, order: 3 },
        { id: 'pending', enabled: true, order: 4 },
      ])
    );
    renderPage();

    // The analytics panel and the pipeline replace the three hidden widgets
    expect(screen.queryByTestId('analytics-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pipeline')).not.toBeInTheDocument();
    const pending = screen.getByRole('heading', { name: /連絡待ちの相談申込/ });
    expect(follows(pending, screen.getByRole('heading', { name: '最近のリード' }))).toBe(true);
    expect(follows(screen.getByTestId('status-overview'), pending)).toBe(true);
  });

  it('keeps hidden widgets from the oldest settings', () => {
    localStorage.setItem(
      'dashboard-widget-config',
      JSON.stringify([
        { id: 'kpis', enabled: true, order: 0 },
        { id: 'pending', enabled: true, order: 1 },
        { id: 'recent', enabled: false, order: 4 },
      ])
    );
    renderPage();

    expect(screen.queryByRole('heading', { name: '最近のリード' })).not.toBeInTheDocument();
    const pending = screen.getByRole('heading', { name: /連絡待ちの相談申込/ });
    expect(follows(pending, screen.getByTestId('analytics-panel'))).toBe(true);
  });
});

describe('reconcileWidgetConfig', () => {
  it('keeps saved choices, shows new widgets and drops removed ones', () => {
    const saved = [
      { id: 'kpis', enabled: false, order: 0 },
      { id: 'statusDonut', enabled: true, order: 1 },
    ];
    expect(reconcileWidgetConfig(saved, ['kpis', 'pending'])).toEqual([
      { id: 'kpis', enabled: false, order: 0 },
      { id: 'pending', enabled: true, order: 1 },
    ]);
    expect(reconcileWidgetConfig('broken', ['kpis'])).toEqual([{ id: 'kpis', enabled: true, order: 0 }]);
  });

  it('keeps the saved order when asked, new widgets at their default place', () => {
    const saved = [
      { id: 'recent', enabled: true, order: 0 },
      { id: 'kpis', enabled: false, order: 1 },
      { id: 'trend', enabled: true, order: 2 },
    ];
    expect(
      reconcileWidgetConfig(saved, ['pending', 'kpis', 'trend', 'recent'], { keepOrder: true })
    ).toEqual([
      { id: 'pending', enabled: true, order: 0 },
      { id: 'recent', enabled: true, order: 1 },
      { id: 'kpis', enabled: false, order: 2 },
      { id: 'trend', enabled: true, order: 3 },
    ]);
  });

  it('shows a widget that replaces earlier ones when any of them was shown', () => {
    const saved = [
      { id: 'trend', enabled: false, order: 0 },
      { id: 'kpis', enabled: true, order: 1 },
      { id: 'breakdown', enabled: false, order: 2 },
    ];
    const aliases = { analytics: ['trend', 'kpis'], pipeline: ['breakdown'] };
    expect(reconcileWidgetConfig(saved, ['analytics', 'pipeline', 'status'], { aliases })).toEqual([
      { id: 'analytics', enabled: true, order: 0 },
      { id: 'pipeline', enabled: false, order: 1 },
      { id: 'status', enabled: true, order: 2 },
    ]);
  });

  it('moves a widget one place and lists the shown ones in order', () => {
    const config = reconcileWidgetConfig([], ['a', 'b', 'c']);
    expect(visibleWidgetIds(moveWidget(config, 'c', -1))).toEqual(['a', 'c', 'b']);
    expect(moveWidget(config, 'a', -1)).toBe(config);
    expect(visibleWidgetIds([{ id: 'a', enabled: false, order: 0 }, ...config.slice(1)])).toEqual([
      'b',
      'c',
    ]);
  });
});
