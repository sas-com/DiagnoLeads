'use client';

/**
 * Site analytics (#755, Epic #411): visitors and page views of the organization's public pages,
 * from the site's own measurement (#412). Laid out after STUDIO's analytics, styled with DADS
 * through components/studio and the shared AreaChart.
 */

import { AreaChart } from '@/components/charts';
import {
  STUDIO_PAGE_CLASS,
  StudioBarRow,
  StudioLinkButton,
  StudioPageHeader,
  StudioPanel,
  StudioSection,
} from '@/components/studio';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useOrganization } from '@/hooks/use-organization';
import { periodDelta, shortDay } from '@/lib/features/analytics/dashboard-format';
import {
  SITE_ANALYTICS_PERIODS,
  type SiteAnalyticsPeriod,
} from '@/lib/features/site-analytics/schemas';
import type { SitePageTotal } from '@/lib/features/site-analytics/service';
import { trpc } from '@/lib/trpc/client';
import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

type Metric = 'visitors' | 'pageviews';

const CHART_HEIGHT = 240;

export default function SiteAnalyticsPage() {
  const t = useTranslations('siteAnalytics');
  const locale = useLocale();
  const { organizationId } = useOrganization();
  const [days, setDays] = useState<SiteAnalyticsPeriod>(30);
  const [metric, setMetric] = useState<Metric>('visitors');
  const selectId = useId();

  const overview = trpc.siteAnalytics.overview.useQuery(
    { organizationId: organizationId ?? '', days },
    { enabled: !!organizationId }
  );
  const data = overview.data;
  const loading = overview.isLoading;
  const number = (value: number) => value.toLocaleString(locale);

  const total = data ? data.totals[metric] : 0;
  const change = data ? periodDelta(data.totals[metric], data.previous[metric]) : null;
  const metricLabel = t(`metric.${metric}`);
  const chartData = (data?.days ?? []).map((day) => ({
    date: shortDay(day.day),
    [metricLabel]: day[metric],
  }));
  const pageTotal = (data?.pages ?? []).reduce((sum, page) => sum + page[metric], 0);
  const pageName = (page: SitePageTotal) => page.title ?? t(`pageType.${page.pageType}`);

  return (
    <div className={STUDIO_PAGE_CLASS}>
      <StudioPageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <ToggleGroup
            type="single"
            size="sm"
            value={String(days)}
            onValueChange={(value) => {
              if (value) setDays(Number(value) as SiteAnalyticsPeriod);
            }}
            aria-label={t('periodLabel')}
          >
            {SITE_ANALYTICS_PERIODS.map((value) => (
              <ToggleGroupItem key={value} value={String(value)}>
                {t('period', { days: value })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />

      <div className="mt-10 space-y-10 sm:mt-14 sm:space-y-14">
        {!loading && data && data.lastRecordedDay === null && (
          <output className="block rounded-md border border-gray-200 p-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
            {t('notMeasured')}
          </output>
        )}

        <StudioSection
          title={t('overview')}
          action={
            <StudioLinkButton href={`/${locale}/analytics`}>{t('toAnalytics')}</StudioLinkButton>
          }
        >
          <StudioPanel>
            {overview.isError ? (
              <p role="alert" className="text-sm text-gray-700 dark:text-gray-300">
                {t('error')}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_19rem]">
                <div className="min-w-0">
                  <div className="relative inline-flex items-center">
                    <label htmlFor={selectId} className="sr-only">
                      {t('metricLabel')}
                    </label>
                    <select
                      id={selectId}
                      value={metric}
                      onChange={(event) => setMetric(event.target.value as Metric)}
                      className="cursor-pointer appearance-none border-0 bg-transparent p-0 pr-5 text-base font-bold text-gray-900 dark:text-gray-50"
                    >
                      <option value="visitors">{t('metric.visitors')}</option>
                      <option value="pageviews">{t('metric.pageviews')}</option>
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-gray-500"
                      aria-hidden="true"
                    />
                  </div>
                  <div
                    className="mt-4 text-4xl font-bold tabular-nums text-gray-900 dark:text-gray-50"
                    data-testid="site-total"
                  >
                    {loading ? <Skeleton className="h-10 w-20" /> : number(total)}
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t('periodRange', { days })}
                    {change && change.rate !== null && (
                      <>
                        <span aria-hidden="true"> ／ </span>
                        {t(`change.${change.type}`, { rate: Math.abs(change.rate) })}
                      </>
                    )}
                    {data?.lastRecordedDay && (
                      <>
                        <span aria-hidden="true"> ／ </span>
                        {t('updatedOn', { day: shortDay(data.lastRecordedDay) })}
                      </>
                    )}
                  </p>
                  <div className="mt-6" style={{ height: CHART_HEIGHT }}>
                    {loading ? (
                      <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />
                    ) : total === 0 ? (
                      <p className="flex h-full items-center justify-center rounded-md bg-gray-50 text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                        {t('empty')}
                      </p>
                    ) : (
                      <div
                        role="img"
                        aria-label={t('chartLabel', {
                          metric: metricLabel,
                          days,
                          total: number(total),
                        })}
                        className="h-full"
                      >
                        <AreaChart
                          data={chartData}
                          index="date"
                          categories={[metricLabel]}
                          colors={['key']}
                          integerValues
                          maxCategoryLabels={6}
                          showLegend={false}
                          height={CHART_HEIGHT}
                        />
                      </div>
                    )}
                  </div>
                  {metric === 'visitors' && (
                    <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                      {t('visitorsNote')}
                    </p>
                  )}
                </div>

                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-50">
                    {t('pagesTitle', { metric: metricLabel })}
                  </h3>
                  {loading ? (
                    <div className="mt-4 space-y-4">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : !data || data.pages.length === 0 ? (
                    <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">{t('empty')}</p>
                  ) : (
                    <ul className="mt-2" data-testid="site-pages">
                      {[...data.pages]
                        .sort((a, b) => b[metric] - a[metric])
                        .map((page) => (
                          <StudioBarRow
                            key={page.path}
                            label={pageName(page)}
                            sub={page.path}
                            value={number(page[metric])}
                            share={pageTotal > 0 ? (page[metric] / pageTotal) * 100 : 0}
                          />
                        ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </StudioPanel>
        </StudioSection>
      </div>
    </div>
  );
}
