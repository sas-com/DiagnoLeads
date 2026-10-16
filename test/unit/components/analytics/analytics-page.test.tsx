/**
 * Analytics page (real ja messages; data hooks and charts mocked) — Refs #163
 *
 * The period-over-period changes were fixed numbers in the code, so none is shown until they
 * are computed from real data (#138).
 */
import AnalyticsPage from '@/app/[locale]/(dashboard)/analytics/page';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({ donuts: [] as Record<string, unknown>[] }));
const { query } = vi.hoisted(() => ({
  query: (data: unknown) => () => ({ data, isLoading: false }),
}));

vi.mock('@/hooks/use-analytics', () => ({
  useOverview: query({
    totalLeads: 14,
    newLeadsThisMonth: 7,
    conversionRate: 14.3,
    averageScore: 65,
    leadsByStatus: { new: 5, nurturing: 2, negotiating: 3, won: 2, lost: 2 },
  }),
  useLeadTrend: query([]),
  useSourceBreakdown: query([
    { source: 'website', count: 8, percentage: 57.1 },
    { source: 'api', count: 6, percentage: 42.9 },
  ]),
  useStatusBreakdown: query([
    { status: 'new', count: 5, percentage: 50 },
    { status: 'won', count: 2, percentage: 20 },
    { status: 'lost', count: 3, percentage: 30 },
  ]),
  useConversionFunnel: query(undefined),
  useScoreDistribution: query([]),
  useResponseTime: query([]),
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

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <AnalyticsPage />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.donuts = [];
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

  it('labels the sources in Japanese under the 流入元 tab', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '流入元' }));
    const sourceDonut = mocks.donuts.find((donut) => donut.height === 256) as Record<
      string,
      unknown
    >;
    expect(sourceDonut.showLegend).toBe(false);
    expect(sourceDonut.data).toEqual([
      { name: 'ウェブサイト', value: 8 },
      { name: 'API', value: 6 },
    ]);
    expect(screen.getAllByText('ウェブサイト').length).toBeGreaterThan(0);
    expect(screen.queryByText('website')).not.toBeInTheDocument();
  });
});
