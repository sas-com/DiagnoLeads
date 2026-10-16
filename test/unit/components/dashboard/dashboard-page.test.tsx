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
            isLoading: !mocks.data && !mocks.isError,
            isError: mocks.isError,
            isPlaceholderData: false,
            refetch: mocks.refetch,
          };
        },
      },
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
  score: 50,
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
  averageScore: 77,
  previousAverageScore: 70,
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
      score: 58,
      status: 'nurturing',
      createdAt: new Date(),
    }),
    lead({
      id: 'lead-1',
      name: '山田 太郎',
      company: '三田製作所',
      score: 88,
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
  JSON.parse(screen.getByTestId('bar-chart').textContent ?? '{}') as {
    categories: string[];
    colors: string[];
    stacked: boolean;
    data: Record<string, unknown>[];
  };

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
    // New leads 6 vs 0: a change, but no percent against nothing
    expect(screen.getByText('+6件')).toBeInTheDocument();
    expect(screen.getByText('前の30日間 0件')).toBeInTheDocument();
    // Consultations 3 vs 1, MQL 4 vs 5
    expect(screen.getByText('+2件')).toBeInTheDocument();
    expect(screen.getByText('前の30日間 1件 → +200%')).toBeInTheDocument();
    expect(screen.getByText('−1件')).toBeInTheDocument();
    expect(screen.getByText('前の30日間 5件 → −20%')).toBeInTheDocument();
    // MQL counts 関心あり only; 適合 only is a separate line (#139)
    expect(screen.getByText('MQL（関心あり）')).toBeInTheDocument();
    expect(screen.getByText('ほかに適合のみ 2件')).toBeInTheDocument();
    // Average score: points, no percent
    expect(screen.getByText('+7')).toBeInTheDocument();
    expect(screen.getByText('前の30日間 70')).toBeInTheDocument();
    expect(screen.queryByText(/前月比/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+15\.3%/)).not.toBeInTheDocument();
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
    const pipeline = screen.getByRole('heading', { name: 'いまのパイプライン' }).closest('div.rounded-lg');
    expect(pipeline).not.toBeNull();
    const rows = within(pipeline as HTMLElement).getAllByRole('link');
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/ja/leads?status=new',
      '/ja/leads?status=nurturing',
      '/ja/leads?status=negotiating',
      '/ja/leads?status=won',
      '/ja/leads?status=lost',
    ]);
  });

  it('puts the waiting requests first and the period switch right above the figures', () => {
    renderPage();

    const pending = screen.getByRole('heading', { name: /連絡待ちの相談申込/ });
    const period = screen.getByRole('group', { name: '集計期間' });
    const firstKpi = screen.getByRole('heading', { name: '新規リード' });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(pending, period)).toBe(true);
    expect(follows(period, firstKpi)).toBe(true);
    expect(screen.getAllByText('直近30日').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText('全期間')).toBeInTheDocument();
  });

  it('stacks consultation requests under the other new leads, without red or blue', () => {
    renderPage();

    const chart = chartProps();
    expect(chart.stacked).toBe(true);
    expect(chart.categories).toEqual(['相談申込', 'その他']);
    expect(chart.colors).toEqual(['teal', 'lightGray']);
    expect(chart.data).toEqual([
      { date: '10/15', 相談申込: 1, その他: 0 },
      { date: '10/16', 相談申込: 1, その他: 2 },
    ]);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      '直近30日の新規リードは4件（うち相談申込2件）。最も多かったのは10/16の3件です'
    );
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
    expect(screen.getByText('週ごと（月曜はじまり・日本時間）')).toBeInTheDocument();
  });

  it('lists recent leads by company with status, received time and highlighted scores', () => {
    renderPage();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('大成化学')).toBeInTheDocument();
    expect(within(rows[1]).getByText('渡辺 恵')).toBeInTheDocument();
    expect(within(rows[1]).getByText('ナーチャリング')).toHaveClass('bg-yellow-100');
    expect(within(rows[1]).getByText(/^今日 \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(rows[2]).getByText('9/12')).toBeInTheDocument();
    expect(within(rows[2]).getByText('MQL')).toBeInTheDocument();
    expect(within(rows[2]).getByText('88')).toHaveAttribute('title', '注目（スコア70以上またはMQL）');
    expect(within(rows[1]).getByText('58')).not.toHaveAttribute('title');
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
    expect(unknown?.querySelector('.bg-gray-500')).not.toBeNull();
  });

  it('says so when there is nothing to show', () => {
    mocks.data = {
      ...summary,
      newLeads: 0,
      averageScore: null,
      previousAverageScore: null,
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
    expect(screen.getByText('前の30日間 スコアなし')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('shows placeholders while loading, never an empty chart or "nothing waiting"', () => {
    mocks.data = undefined;
    renderPage();

    expect(screen.getAllByTestId('card-skeleton').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId('chart-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('連絡待ちの相談申込はありません')).not.toBeInTheDocument();
    // The cards that follow the period already name it; only the pipeline is all time
    expect(screen.getAllByText('直近30日')).toHaveLength(2);
    expect(screen.getAllByText('全期間')).toHaveLength(1);
  });

  it('shows an error with a reload button in each card, never "nothing waiting"', async () => {
    const user = userEvent.setup();
    mocks.isError = true;
    mocks.data = undefined;
    renderPage();

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(6); // pending, figures, trend, pipeline, sources, recent
    for (const alert of alerts) expect(alert).toHaveTextContent('読み込めませんでした');
    expect(screen.queryByText('連絡待ちの相談申込はありません')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();

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

  it('puts the next actions due today right after the waiting requests', () => {
    renderPage();

    const pending = screen.getByRole('heading', { name: /連絡待ちの相談申込/ });
    const today = screen.getByTestId('due-tasks');
    const firstKpi = screen.getByRole('heading', { name: '新規リード' });
    expect(Boolean(pending.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(today.compareDocumentPosition(firstKpi) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
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

  it('reorders widgets from the customize dialog with buttons', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'カスタマイズ' }));
    await user.click(screen.getByRole('button', { name: '「最近のリード」を上へ' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    const recent = screen.getByRole('heading', { name: '最近のリード' });
    const pipeline = screen.getByRole('heading', { name: 'いまのパイプライン' });
    expect(Boolean(recent.compareDocumentPosition(pipeline) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(JSON.parse(localStorage.getItem('dashboard-widget-config-v2') ?? '[]')).toEqual([
      { id: 'pending', enabled: true, order: 0 },
      { id: 'today', enabled: true, order: 1 },
      { id: 'kpis', enabled: true, order: 2 },
      { id: 'trend', enabled: true, order: 3 },
      { id: 'recent', enabled: true, order: 4 },
      { id: 'breakdown', enabled: true, order: 5 },
    ]);
  });

  it('keeps hidden widgets from older settings but uses the new order', () => {
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
    const firstKpi = screen.getByRole('heading', { name: '新規リード' });
    expect(Boolean(pending.compareDocumentPosition(firstKpi) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
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
