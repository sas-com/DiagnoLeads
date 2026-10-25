/**
 * ResponseTimeChart in the page's language (#434): the buckets the server names and the counts.
 */
import { ResponseTimeChart } from '@/components/analytics/response-time-chart';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bars: [] as Record<string, unknown>[] }));
vi.mock('@/components/charts/bar-chart', () => ({
  BarChart: (props: Record<string, unknown>) => {
    mocks.bars.push(props);
    return null;
  },
}));

// The buckets of lib/features/analytics/response-time.ts
const data = [
  { period: '< 1 hour', count: 1200, percentage: 60, averageHours: 0.5 },
  { period: '1-24 hours', count: 500, percentage: 25, averageHours: 6 },
  { period: '1-3 days', count: 200, percentage: 10, averageHours: 40 },
  { period: '3+ days', count: 100, percentage: 5, averageHours: 100 },
];

beforeEach(() => {
  mocks.bars = [];
});

describe('ResponseTimeChart', () => {
  it.each([
    ['ja', ['1時間以内', '1-24時間', '1-3日', '3日以上'], 'リード数', '1,200件'],
    ['en', ['< 1 hour', '1-24 hours', '1-3 days', '3+ days'], 'Leads', '1,200'],
  ] as const)('names the buckets, the series and the counts in %s', (locale, periods, series, count) => {
    render(
      <NextIntlClientProvider locale={locale} messages={locale === 'ja' ? ja : en} timeZone="Asia/Tokyo">
        <ResponseTimeChart data={data} />
      </NextIntlClientProvider>
    );

    const bar = mocks.bars[0] as {
      data: Record<string, string | number>[];
      categories: string[];
      valueFormatter: (value: number) => string;
    };
    expect(bar.data.map((row) => row.period)).toEqual(periods);
    // The series name shows in the tooltip: never the internal key
    expect(bar.categories).toEqual([series]);
    expect(bar.data[0][series]).toBe(1200);
    expect(bar.valueFormatter(1200)).toBe(count);
    for (const period of periods) expect(screen.getByText(period)).toBeInTheDocument();
  });
});
