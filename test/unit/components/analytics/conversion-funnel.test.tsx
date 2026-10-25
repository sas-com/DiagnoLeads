/**
 * ConversionFunnel in the page's language (#434): the texts that were English only, and the
 * numbers formatted for the locale.
 */
import { ConversionFunnel } from '@/components/analytics/conversion-funnel';
import type { ConversionFunnelData } from '@/lib/features/analytics/types/schemas';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

const funnel = (averageConversionDays: number): ConversionFunnelData => ({
  stages: [
    { name: 'new', count: 1200, cumulativeCount: 1200, percentage: 100, conversionRate: 100 },
    { name: 'won', count: 30, cumulativeCount: 30, percentage: 2.5, conversionRate: 2.5 },
  ],
  totalLeads: 1200,
  overallConversionRate: 2.5,
  averageConversionDays,
});

const renderIn = (locale: 'ja' | 'en', ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ja' ? ja : en} timeZone="Asia/Tokyo">
      {ui}
    </NextIntlClientProvider>
  );

describe('ConversionFunnel', () => {
  it.each([
    ['ja', '全体コンバージョン率', '成約までの平均：12.5日'],
    ['en', 'Overall Conversion Rate', 'Average conversion time: 12.5 days'],
  ] as const)('names the overall rate and the average time in %s', (locale, overall, average) => {
    renderIn(locale, <ConversionFunnel funnelData={funnel(12.46)} />);

    expect(screen.getByText(overall)).toBeInTheDocument();
    expect(screen.getByText(average)).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it.each([
    ['ja', '初回リードからの変換率'],
    ['en', 'From initial lead to conversion'],
  ] as const)('explains the rate when there is no average time yet (%s)', (locale, text) => {
    renderIn(locale, <ConversionFunnel funnelData={funnel(0)} />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each([
    ['ja', 'データがありません'],
    ['en', 'No data available'],
  ] as const)('says there is no data (%s)', (locale, text) => {
    renderIn(locale, <ConversionFunnel />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
