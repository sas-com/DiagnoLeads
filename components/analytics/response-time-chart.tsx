'use client';

import { BarChart } from '@/components/charts/bar-chart';
import type { ResponseTimeData } from '@/lib/features/analytics/types/schemas';
import { useTranslations } from 'next-intl';

/** Message keys of the buckets the server names (HOUR_BUCKETS, lib/features/analytics) */
const PERIOD_KEYS: Record<string, string> = {
  '< 1 hour': 'withinHour',
  '1-24 hours': 'withinDay',
  '1-3 days': 'withinThreeDays',
  '3+ days': 'overThreeDays',
};

interface ResponseTimeChartProps {
  data: ResponseTimeData[];
  isLoading?: boolean;
}

/**
 * ResponseTimeChart - Bar chart showing response time distribution
 * Displays how quickly leads are being responded to
 */
export function ResponseTimeChart({ data, isLoading = false }: ResponseTimeChartProps) {
  const t = useTranslations('settings.analytics');

  if (isLoading) {
    return (
      <div className="h-64 space-y-4">
        {[...Array(4)].map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders that are never reordered and have no identity
          <div key={i} className="flex items-center gap-3">
            <div className="w-20 h-4 bg-gray-200 animate-pulse rounded" />
            <div className="flex-1 h-8 bg-gray-200 animate-pulse rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <p className="text-gray-500">{t('noData')}</p>
      </div>
    );
  }

  // Localize period labels
  const localizeLabel = (period: string): string => {
    const key = PERIOD_KEYS[period];
    return key ? t(`responseTimePeriods.${key}`) : period;
  };

  // Map data for chart with localized labels; the series name shows in the tooltip
  const series = t('charts.leads');
  const chartData = data.map((item) => ({
    period: localizeLabel(item.period),
    [series]: item.count,
    percentage: item.percentage,
    averageHours: item.averageHours,
  }));

  const valueFormatter = (value: number) => t('leadCount', { count: value });

  return (
    <div className="h-64">
      <BarChart
        className="h-full"
        data={chartData}
        index="period"
        categories={[series]}
        colors={['emerald']}
        valueFormatter={valueFormatter}
        showLegend={false}
        showAnimation={true}
        layout="vertical"
      />
      {/* Summary stats below chart */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {data.map((item, index) => (
          <div key={item.period} className="text-center">
            <div className="text-xs text-gray-500">{chartData[index].period}</div>
            <div className="text-sm font-semibold">{item.percentage}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
