/**
 * Site analytics page (#755): the total and its change, the pages by name, the switch to page
 * views, and the notice before measurement is on. Real ja messages, tRPC and charts mocked;
 * values are made up.
 */
import SiteAnalyticsPage from '@/app/[locale]/(dashboard)/analytics/site/page';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  input: null as unknown,
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    siteAnalytics: {
      overview: {
        useQuery: (input: unknown) => {
          mocks.input = input;
          return mocks.result;
        },
      },
    },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID, isLoading: false }),
}));
vi.mock('@/components/charts', () => ({
  AreaChart: () => <div data-testid="area-chart" />,
}));

const OVERVIEW = {
  from: '2026-10-24',
  to: '2026-10-30',
  days: [
    { day: '2026-10-29', visitors: 2, pageviews: 3 },
    { day: '2026-10-30', visitors: 10, pageviews: 30 },
  ],
  totals: { visitors: 12, pageviews: 33 },
  previous: { visitors: 10, pageviews: 33 },
  pages: [
    { path: '/ja/ax-migration', pageType: 'ax-lp', title: null, visitors: 9, pageviews: 10 },
    { path: '/ja/d/dx-check', pageType: 'diagnosis', title: '架空の DX 診断', visitors: 3, pageviews: 23 },
  ],
  lastRecordedDay: '2026-10-30',
};

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <SiteAnalyticsPage />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.result = { data: OVERVIEW, isLoading: false, isError: false };
});

describe('SiteAnalyticsPage', () => {
  it('shows the visitors of the last 30 days, the change and the pages by name', () => {
    renderPage();
    expect(mocks.input).toEqual({ organizationId: ORG_ID, days: 30 });
    expect(screen.getByTestId('site-total')).toHaveTextContent('12');
    expect(screen.getByText(/前の期間より20%増/)).toBeInTheDocument();
    expect(screen.getByText(/10\/30まで記録/)).toBeInTheDocument();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(screen.getByText(/同じ人が別の日に来ると/)).toBeInTheDocument();

    const pages = within(screen.getByTestId('site-pages')).getAllByRole('listitem');
    expect(pages[0]).toHaveTextContent('AX マイグレーション（メイン LP）');
    expect(pages[0]).toHaveTextContent('/ja/ax-migration');
    expect(pages[1]).toHaveTextContent('架空の DX 診断');
    expect(screen.queryByText(/まだ訪問の記録がありません/)).not.toBeInTheDocument();
  });

  it('switches to page views and orders the pages by them', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('指標'), 'pageviews');
    expect(screen.getByTestId('site-total')).toHaveTextContent('33');
    expect(screen.getByText(/前の期間と同じ/)).toBeInTheDocument();
    expect(screen.queryByText(/同じ人が別の日に来ると/)).not.toBeInTheDocument();
    const pages = within(screen.getByTestId('site-pages')).getAllByRole('listitem');
    expect(pages[0]).toHaveTextContent('架空の DX 診断');
  });

  it('asks for another period', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: '過去7日間' }));
    expect(mocks.input).toEqual({ organizationId: ORG_ID, days: 7 });
  });

  it('says nothing is recorded yet before measurement is on', () => {
    mocks.result = {
      data: {
        ...OVERVIEW,
        days: OVERVIEW.days.map((day) => ({ ...day, visitors: 0, pageviews: 0 })),
        totals: { visitors: 0, pageviews: 0 },
        previous: { visitors: 0, pageviews: 0 },
        pages: [],
        lastRecordedDay: null,
      },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText(/まだ訪問の記録がありません/)).toBeInTheDocument();
    expect(screen.getByTestId('site-total')).toHaveTextContent('0');
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('site-pages')).not.toBeInTheDocument();
  });

  it('says when the numbers cannot be read', () => {
    mocks.result = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした');
  });
});
