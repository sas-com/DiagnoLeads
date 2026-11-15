/**
 * The analytics page reads its tab and period from the address and writes them back (#1216), so
 * a link from the marketing room's boards, back and reload show the same figures.
 * (Real ja messages; data hooks and charts mocked. The page's figures: analytics-page.test.tsx.)
 */
import AnalyticsPage from '@/app/[locale]/(dashboard)/analytics/page';
import { useAnalyticsPageQuery } from '@/app/[locale]/(dashboard)/analytics/_components/use-analytics-page-query';
import messages from '@/locales/ja/common.json';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({
  // The address the page is at (without '?')
  search: '',
  replace: vi.fn(),
  push: vi.fn(),
  // The period each data hook was last asked for
  ranges: {} as Record<string, unknown>,
}));

vi.mock('next/navigation', async () => {
  const { searchParamsCache } = await import('@/test/mocks/next-navigation');
  // One object for every render, like Next's useRouter (#636)
  const router = { replace: mocks.replace, push: mocks.push };
  // A new object only when mocks.search changes, like Next's useSearchParams (#719)
  const searchParamsFor = searchParamsCache();
  return {
    useSearchParams: () => searchParamsFor(mocks.search),
    usePathname: () => '/ja/analytics',
    useRouter: () => router,
  };
});
vi.mock('@/hooks/use-analytics', () => {
  const hook = (name: string) => (_organizationId: string, range: unknown) => {
    mocks.ranges[name] = range;
    return { data: undefined, isLoading: true };
  };
  return {
    useOverview: hook('overview'),
    useLeadTrend: hook('trend'),
    useSourceBreakdown: hook('sources'),
    useStatusBreakdown: hook('status'),
    useConversionFunnel: hook('funnel'),
    useResponseTime: hook('responseTime'),
    useAcquisitionCost: hook('cost'),
    useAgencyPerformance: hook('agencies'),
  };
});
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
  useCurrentOrganization: () => ({ organization: { id: ORG_ID, name: '架空商事' }, isLoading: false }),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/app/[locale]/(dashboard)/analytics/_components/agency-contract-report-card', () => ({
  AgencyContractReportCard: () => null,
}));
vi.mock('@/app/[locale]/(dashboard)/analytics/_components/delivery-report-cards', () => ({
  DeliveryReportCards: () => null,
}));
vi.mock('@/components/charts', () => ({
  AreaChart: () => null,
  ChartLegend: () => null,
  DonutChart: () => null,
}));

const page = () => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    <AnalyticsPage />
  </NextIntlClientProvider>
);
const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent;
const askedRanges = () => new Set(Object.values(mocks.ranges));

beforeEach(() => {
  mocks.search = '';
  mocks.ranges = {};
  mocks.replace.mockReset();
  mocks.push.mockReset();
});

describe('AnalyticsPage and its address (#1216)', () => {
  it('opens at the overview of the last 30 days when the address says nothing', () => {
    render(page());
    expect(selectedTab()).toBe('概要');
    expect(askedRanges()).toEqual(new Set(['30d']));
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('opens at the tab and the period of the address', () => {
    mocks.search = 'tab=funnel&range=90d';
    render(page());
    expect(selectedTab()).toBe('ファネル');
    // Every figure of the page is asked for that period
    expect(Object.keys(mocks.ranges)).toHaveLength(8);
    expect(askedRanges()).toEqual(new Set(['90d']));
    // Reading the address does not rewrite it
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('opens where the boards of the marketing room point: the sources of the last 30 days', () => {
    mocks.search = 'tab=sources&range=30d';
    render(page());
    expect(selectedTab()).toBe('流入元');
    expect(askedRanges()).toEqual(new Set(['30d']));
  });

  it('falls back to its start for values it does not know', () => {
    mocks.search = 'tab=nowhere&range=1y';
    render(page());
    expect(selectedTab()).toBe('概要');
    expect(askedRanges()).toEqual(new Set(['30d']));
  });

  it('shows a chosen tab at once and writes it to the address without a history entry', async () => {
    const user = userEvent.setup();
    mocks.search = 'range=90d';
    render(page());
    await user.click(screen.getByRole('tab', { name: '流入元' }));
    // The address has not changed yet (the router is a mock): the page does not wait for it
    expect(selectedTab()).toBe('流入元');
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/ja/analytics?range=90d&tab=sources', {
      scroll: false,
    });
    expect(mocks.push).not.toHaveBeenCalled();
    // The period stays
    expect(askedRanges()).toEqual(new Set(['90d']));
  });

  it('takes the start values out of the address again', async () => {
    const user = userEvent.setup();
    mocks.search = 'tab=sources';
    render(page());
    await user.click(screen.getByRole('tab', { name: '概要' }));
    expect(mocks.replace).toHaveBeenCalledWith('/ja/analytics', { scroll: false });
  });

  it('follows the address when it changes from elsewhere (back, forward)', () => {
    mocks.search = 'tab=sources';
    const view = render(page());
    expect(selectedTab()).toBe('流入元');
    mocks.search = 'tab=funnel&range=7d';
    view.rerender(page());
    expect(selectedTab()).toBe('ファネル');
    expect(askedRanges()).toEqual(new Set(['7d']));
    mocks.search = '';
    view.rerender(page());
    expect(selectedTab()).toBe('概要');
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

describe('useAnalyticsPageQuery (#1216)', () => {
  it('changes the period at once, keeps the tab, and writes both to the address', () => {
    mocks.search = 'tab=funnel';
    const { result } = renderHook(() => useAnalyticsPageQuery());
    expect(result.current).toMatchObject({ tab: 'funnel', range: '30d' });
    act(() => result.current.setRange('all'));
    expect(result.current).toMatchObject({ tab: 'funnel', range: 'all' });
    expect(mocks.replace).toHaveBeenCalledWith('/ja/analytics?tab=funnel&range=all', {
      scroll: false,
    });
  });

  it('does nothing for the value it already shows, or for a tab that does not exist', () => {
    mocks.search = 'tab=sources&range=90d';
    const { result } = renderHook(() => useAnalyticsPageQuery());
    act(() => result.current.setTab('sources'));
    act(() => result.current.setRange('90d'));
    act(() => result.current.setTab('nowhere'));
    expect(result.current).toMatchObject({ tab: 'sources', range: '90d' });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('keeps its own change when the address catches up, and follows a later change of the address', () => {
    const { result, rerender } = renderHook(() => useAnalyticsPageQuery());
    act(() => result.current.setTab('performance'));
    // The router arrives at what was asked
    mocks.search = 'tab=performance';
    rerender();
    expect(result.current.tab).toBe('performance');
    // Back to the address before
    mocks.search = '';
    rerender();
    expect(result.current.tab).toBe('overview');
    expect(mocks.replace).toHaveBeenCalledTimes(1);
  });

  it('builds on the latest address when two changes follow each other', () => {
    const { result } = renderHook(() => useAnalyticsPageQuery());
    act(() => {
      result.current.setTab('sources');
    });
    act(() => {
      result.current.setRange('7d');
    });
    expect(result.current).toMatchObject({ tab: 'sources', range: '7d' });
    expect(mocks.replace).toHaveBeenLastCalledWith('/ja/analytics?tab=sources&range=7d', {
      scroll: false,
    });
  });
});
