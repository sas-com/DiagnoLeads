/**
 * Analytics page (real ja messages; data hooks and charts mocked) — Refs #163
 *
 * The period-over-period changes were fixed numbers in the code, so none is shown until they
 * are computed from real data (#138). 流入元 comes from inflow_source, cost and agencies from
 * the cost / agency recorded on leads, and the response time waits for first contacts (#136).
 */
import AnalyticsPage from '@/app/[locale]/(dashboard)/analytics/page';
import en from '@/locales/en/common.json';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({
  donuts: [] as Record<string, unknown>[],
  data: {} as Record<string, unknown>,
}));
const { query, live } = vi.hoisted(() => ({
  query: (data: unknown) => () => ({ data, isLoading: false }),
  // Data a test can replace through mocks.data
  live: (key: string, fallback: () => unknown) => () => ({
    data: key in mocks.data ? mocks.data[key] : fallback(),
    isLoading: false,
  }),
}));

const COST = {
  leadCount: 14,
  costedLeadCount: 4,
  sqlCount: 2,
  wonCount: 1,
  totalCost: 120000,
  costPerSql: 60000,
  costPerWon: 120000,
  bySource: [
    {
      source: 'telemarketing_agency',
      leadCount: 4,
      costedLeadCount: 4,
      sqlCount: 2,
      wonCount: 1,
      totalCost: 120000,
      costPerSql: 60000,
      costPerWon: 120000,
    },
    {
      source: 'unset',
      leadCount: 10,
      costedLeadCount: 0,
      sqlCount: 0,
      wonCount: 0,
      totalCost: 0,
      costPerSql: null,
      costPerWon: null,
    },
  ],
};
const AGENCIES = [
  {
    agencyName: 'テレアポ株式会社',
    leadCount: 4,
    sqlCount: 1,
    sqlRate: 25,
    wonCount: 1,
    costedLeadCount: 4,
    totalCost: 120000,
    costPerSql: 120000,
  },
];

vi.mock('@/hooks/use-analytics', () => ({
  useOverview: query({
    totalLeads: 14,
    newLeadsThisMonth: 7,
    conversionRate: 14.3,
    mqlLevels: { interest: 3, fit: 2, none: 4, unknown: 5 },
    mqlRate: 21.43,
    leadsByStatus: { new: 5, nurturing: 2, negotiating: 3, won: 2, lost: 2 },
  }),
  useLeadTrend: query([]),
  useSourceBreakdown: query([
    { source: 'lp_organic', count: 8, percentage: 57.1 },
    { source: 'unset', count: 6, percentage: 42.9 },
  ]),
  useStatusBreakdown: query([
    { status: 'new', count: 5, percentage: 50 },
    { status: 'won', count: 2, percentage: 20 },
    { status: 'lost', count: 3, percentage: 30 },
  ]),
  useConversionFunnel: query(undefined),
  useResponseTime: live('responseTime', () => ({
    status: 'pending',
    reason: 'first_contact_not_recorded',
  })),
  useAcquisitionCost: live('cost', () => COST),
  useAgencyPerformance: live('agencies', () => AGENCIES),
}));
vi.mock('@/hooks/use-export', () => ({
  useExport: () => ({
    exportAnalyticsReport: vi.fn(),
    exportAnalyticsJSON: vi.fn(),
    exportAnalyticsPDF: vi.fn(),
    isExporting: false,
  }),
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID, isLoading: false }),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
// Covered by agency-contract-report-card.test.tsx; it reads tRPC directly
vi.mock('@/app/[locale]/(dashboard)/analytics/_components/agency-contract-report-card', () => ({
  AgencyContractReportCard: () => null,
}));
vi.mock('@/components/charts', () => ({
  AreaChart: () => <div data-testid="area-chart" />,
  ChartLegend: ({ categories }: { categories: string[] }) => (
    <div data-testid="chart-legend">{categories.join(',')}</div>
  ),
  DonutChart: (props: Record<string, unknown>) => {
    mocks.donuts.push(props);
    return <div data-testid="donut-chart" />;
  },
}));

const renderPage = (locale: 'ja' | 'en' = 'ja') =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? messages : en}
      timeZone="Asia/Tokyo"
    >
      <AnalyticsPage />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.donuts = [];
  mocks.data = {};
});

describe('AnalyticsPage', () => {
  it('shows the KPI values without any period-over-period change', () => {
    renderPage();
    expect(screen.getByText('総リード数')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.queryByText('前期間比')).not.toBeInTheDocument();
    // The old fixed numbers
    for (const fake of ['15.3%', '23.1%', '8.2%', '5.1%']) {
      expect(screen.queryByText(new RegExp(fake.replace('.', '\\.')))).not.toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/[+-]\d+(\.\d+)?%/);
  });

  it('shows no average score and no score distribution: the MQL level is the sign (#447)', () => {
    renderPage();
    expect(screen.queryByText(/平均スコア/)).not.toBeInTheDocument();
    expect(screen.queryByText(/スコア分布/)).not.toBeInTheDocument();
    expect(screen.queryByText(/リードの質/)).not.toBeInTheDocument();
  });

  it('shows the MQL (interested) count and rate at the top, and the leads per MQL level (#605)', () => {
    renderPage();
    const kpi = screen.getByText('MQL（関心あり）').closest('div.p-6') as HTMLElement;
    expect(within(kpi).getByText('3')).toBeInTheDocument();
    expect(within(kpi).getByText('すべての期間のリードの 21.4%')).toBeInTheDocument();

    expect(screen.getByTestId('mql-levels')).toHaveTextContent('MQL段階の内訳');
    for (const [level, label, count, rate] of [
      ['interest', '関心あり（MQL）', '3件', '21.4%'],
      ['fit', '適合', '2件', '14.3%'],
      ['none', '対象外', '4件', '28.6%'],
      ['unknown', '診断なし', '5件', '35.7%'],
    ]) {
      const row = screen.getByTestId(`mql-level-${level}`);
      expect(row).toHaveTextContent(label);
      expect(row).toHaveTextContent(count);
      expect(row).toHaveTextContent(rate);
      // Opens the lead list filtered by the level
      expect(row).toHaveAttribute('href', `/ja/leads?level=${level}`);
    }
  });

  it('shows the status donut without its overlapping legend, colored per status', () => {
    renderPage();
    const statusDonut = mocks.donuts[0];
    expect(statusDonut.showLegend).toBe(false);
    expect(statusDonut.data).toEqual([
      { name: '新規', value: 5 },
      { name: '成約', value: 2 },
      { name: '失注', value: 3 },
    ]);
    expect(statusDonut.colors).toEqual(['blue', 'violet', 'gray']);
    // Says which leads the ring counts (it follows the period, the cards below do not)
    expect(screen.getByText('過去30日に登録されたリード')).toBeInTheDocument();
  });

  it.each([
    ['ja', '合計', '1,234件', '5件'],
    ['en', 'Total', '1,234', '5'],
  ] as const)('counts leads in the page language (%s, #434)', (locale, total, formatted, newLeads) => {
    renderPage(locale);
    const statusDonut = mocks.donuts[0] as {
      totalLabel: string;
      valueFormatter: (value: number) => string;
    };
    expect(statusDonut.totalLabel).toBe(total);
    expect(statusDonut.valueFormatter(1234)).toBe(formatted);
    // The status list of the overview
    expect(screen.getAllByText(newLeads).length).toBeGreaterThan(0);
    if (locale === 'en') expect(document.body.textContent).not.toMatch(/件/);
  });

  it('labels the 流入元 in Japanese, 未設定 last', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '流入元' }));
    const sourceDonut = mocks.donuts.find((donut) => donut.height === 256) as Record<
      string,
      unknown
    >;
    expect(sourceDonut.showLegend).toBe(false);
    expect(sourceDonut.data).toEqual([
      { name: 'LP（自然検索）', value: 8 },
      { name: '未設定', value: 6 },
    ]);
    expect(screen.getByText('過去30日に登録されたリードの流入元')).toBeInTheDocument();
    expect(screen.queryByText('lp_organic')).not.toBeInTheDocument();
    expect(screen.queryByText('ウェブサイト')).not.toBeInTheDocument();
  });

  it('shows the acquisition cost recorded on leads, without any unit-price input', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '流入元' }));
    const table = screen.getByText('流入元別の獲得費用').closest('div')?.parentElement as HTMLElement;
    const rows = within(table).getAllByRole('row');
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells(rows[1])).toEqual([
      '営業代行（テレアポ）',
      '4',
      '2',
      '1',
      '￥120,000',
      '￥60,000',
      '￥120,000',
    ]);
    // No SQL / no win: a dash, not a made-up figure; leads without a cost are flagged
    expect(cells(rows[2])).toEqual(['未設定費用未記録 10 件', '10', '0', '0', '￥0', '—', '—']);
    expect(cells(rows[3])[0]).toBe('合計');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByText(/ROI/)).not.toBeInTheDocument();
  });

  // What the deals brought in (#448): only when the figures carry the deals (canReadDeals)
  it('shows the won amount and ROI per 流入元, with a dash when nothing was spent', async () => {
    const returns = (wonAmount: number, roi: number | null) => ({
      dealCount: 2,
      wonDealCount: 1,
      wonAmount,
      costPerWonDeal: roi === null ? 0 : 120000,
      roi,
      medianDaysToWin: 21,
    });
    mocks.data.cost = {
      ...COST,
      deals: returns(600000, 5),
      bySource: [
        { ...COST.bySource[0], deals: returns(600000, 5) },
        { ...COST.bySource[1], deals: returns(0, null) },
      ],
    };
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '流入元' }));
    const table = screen.getByTestId('deal-returns');
    expect(table).toHaveTextContent('受注と費用対効果');
    const rows = within(table).getAllByRole('row');
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells(rows[1])).toEqual([
      '営業代行（テレアポ）',
      '2',
      '1',
      '￥600,000',
      '￥120,000',
      '5倍',
      '21日',
    ]);
    // No acquisition cost: no ROI to show
    expect(cells(rows[2])[5]).toBe('—');
    expect(cells(rows[3])[0]).toBe('合計');
  });

  it('hides the won amounts from those who may not read deals', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '流入元' }));
    expect(screen.queryByTestId('deal-returns')).not.toBeInTheDocument();
  });

  it('shows agency SQL rate and cost per SQL, or says there is no agency data', async () => {
    const { unmount } = renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '流入元' }));
    const row = screen.getByText('テレアポ株式会社').closest('tr') as HTMLElement;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['テレアポ株式会社', '4', '1', '25.0%', '1', '￥120,000', '￥120,000']);
    unmount();

    mocks.data = { agencies: [], cost: { ...COST, leadCount: 0, bySource: [] } };
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '流入元' }));
    expect(
      screen.getByText('この期間に代行会社名を記録したリードはありません。')
    ).toBeInTheDocument();
    expect(screen.queryByText('テレアポ株式会社')).not.toBeInTheDocument();
  });

  it('shows the response time as 準備中 instead of a number until first contacts are recorded', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'パフォーマンス' }));
    expect(screen.getByText('準備中（初回連絡の記録の追加後に表示）')).toBeInTheDocument();
    // The KPIs are at the top of the page, not repeated in the tab (#605)
    expect(screen.queryByText('パフォーマンスの概要')).not.toBeInTheDocument();
  });
});
