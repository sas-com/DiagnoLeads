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
    { name: 'lead', count: 900, cumulativeCount: 1200, percentage: 100, conversionRate: 100 },
    { name: 'mql', count: 200, cumulativeCount: 300, percentage: 25, conversionRate: 25 },
    { name: 'deal', count: 40, cumulativeCount: 100, percentage: 8.33, conversionRate: 33.33 },
    { name: 'sql', count: 30, cumulativeCount: 60, percentage: 5, conversionRate: 60 },
    { name: 'won', count: 30, cumulativeCount: 30, percentage: 2.5, conversionRate: 50 },
  ],
  totalLeads: 1200,
  nurturingCount: 45,
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

  // The stages of the lead lifecycle, 再育成 beside them (#802)
  it('shows the lifecycle stages and the nurtured leads apart', () => {
    renderIn('ja', <ConversionFunnel funnelData={funnel(0)} />);

    for (const label of ['リード', 'MQL（関心あり）', '商談', 'SQL（適格）', '受注']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByTestId('funnel-nurturing')).toHaveTextContent(
      '再育成（ナーチャリング）中のリード：45件'
    );
    expect(screen.queryByText('ナーチャリング')).not.toBeInTheDocument();
  });

  it.each([
    ['ja', 'データがありません'],
    ['en', 'No data available'],
  ] as const)('says there is no data (%s)', (locale, text) => {
    renderIn(locale, <ConversionFunnel />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
