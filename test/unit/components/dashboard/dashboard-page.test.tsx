/**
 * Dashboard (real next-intl messages; tRPC, organization and charts mocked)
 */
import DashboardPage from '@/app/[locale]/(dashboard)/dashboard/page';
import { reconcileWidgetConfig } from '@/components/dashboard/widget-settings';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  data: undefined as unknown,
  isError: false,
  organizationId: '660e8400-e29b-41d4-a716-446655440000' as string | null,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    analytics: {
      getDashboard: {
        useQuery: (input: unknown) => {
          mocks.query(input);
          return { data: mocks.data, isLoading: false, isError: mocks.isError };
        },
      },
    },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: mocks.organizationId, isLoading: false }),
}));
vi.mock('@/components/charts', () => ({
  BarChart: ({ categories }: { categories: string[] }) => <div data-testid="bar-chart">{categories.join(',')}</div>,
}));

const summary = {
  days: 30,
  newLeads: 6,
  previousNewLeads: 0,
  consultations: 3,
  previousConsultations: 1,
  mql: 4,
  previousMql: 2,
  averageScore: 77,
  daily: [
    { date: '2026-10-15', leads: 1, consultations: 1 },
    { date: '2026-10-16', leads: 2, consultations: 0 },
  ],
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
      requestedAt: new Date('2026-10-12T02:00:00Z'),
      deadline: '2026/10/14',
      overdue: true,
    },
    {
      id: 'lead-2',
      name: '佐藤 花子',
      company: '北辰工業',
      platform: 'acos',
      requestedAt: new Date('2026-10-15T02:00:00Z'),
      deadline: '2099/10/19',
      overdue: false,
    },
  ],
  pendingConsultationTotal: 10,
  recentLeads: [
    {
      id: 'lead-3',
      name: '渡辺 恵',
      company: '大成化学',
      platform: 'other',
      score: 58,
      consultation: false,
      createdAt: new Date('2026-10-16T03:00:00Z'),
    },
    {
      id: 'lead-1',
      name: '山田 太郎',
      company: '三田製作所',
      platform: 'as400',
      score: 88,
      consultation: true,
      createdAt: new Date('2026-10-12T02:00:00Z'),
    },
  ],
};

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <DashboardPage />
    </NextIntlClientProvider>
  );

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.data = summary;
    mocks.isError = false;
    mocks.organizationId = ORG_ID;
  });

  it('shows real figures with the previous period, never made-up changes', () => {
    renderPage();

    expect(mocks.query).toHaveBeenCalledWith({ organizationId: ORG_ID, days: 30 });
    expect(screen.getByText('前の30日間：0')).toBeInTheDocument();
    expect(screen.getByText('前の30日間：1')).toBeInTheDocument();
    expect(screen.getByText('前の30日間：2')).toBeInTheDocument();
    expect(screen.queryByText(/前月比/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+15\.3%/)).not.toBeInTheDocument();
  });

  it('lists consultation requests waiting for contact, overdue first, linked to the lead', () => {
    renderPage();

    const overdue = screen.getByRole('link', { name: /期限切れ（10\/14）.*三田製作所/ });
    expect(overdue).toHaveAttribute('href', '/ja/leads?leadId=lead-1');
    expect(screen.getByRole('link', { name: /10\/19まで.*北辰工業/ })).toBeInTheDocument();
    expect(screen.getByText('ほか8件')).toBeInTheDocument();
  });

  it('names migration sources and marks consultation requests among recent leads', () => {
    renderPage();

    const table = screen.getByRole('table');
    expect(within(table).getByText('渡辺 恵')).toBeInTheDocument();
    expect(within(table).getByText('相談申込')).toBeInTheDocument();
    expect(screen.getAllByText('AS/400（IBM i）').length).toBeGreaterThan(0);
    expect(screen.getByText('不明（AX診断以外）')).toBeInTheDocument();
  });

  it('says so when there is nothing to show', () => {
    mocks.data = {
      ...summary,
      newLeads: 0,
      averageScore: null,
      daily: summary.daily.map((d) => ({ ...d, leads: 0, consultations: 0 })),
      platforms: [],
      pendingConsultations: [],
      pendingConsultationTotal: 0,
      recentLeads: [],
    };
    renderPage();

    expect(screen.getByText('連絡待ちの相談申込はありません')).toBeInTheDocument();
    expect(screen.getAllByText('この期間のリードはありません')).toHaveLength(2);
    expect(screen.getByText('まだリードがありません')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('asks to choose an organization when none is selected', () => {
    mocks.organizationId = null;
    mocks.data = undefined;
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('組織を選ぶと、ここにリードの状況が表示されます');
  });

  it('says when the figures could not be loaded', () => {
    mocks.isError = true;
    mocks.data = undefined;
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('ダッシュボードの数字を読み込めませんでした');
  });

  it('switches the period', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('radio', { name: '7日' }));
    expect(mocks.query).toHaveBeenLastCalledWith({ organizationId: ORG_ID, days: 7 });
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
});
