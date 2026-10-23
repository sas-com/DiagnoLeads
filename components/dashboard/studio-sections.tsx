'use client';

import { AreaChart } from '@/components/charts';
/**
 * The dashboard's own blocks in the STUDIO look (#410): where things stand now (waiting
 * consultations, next actions due, this week's meetings) and the analytics panel (the figure of
 * the period with its curve, migration sources, and what changed against the previous period).
 * The figures are those of analytics.getDashboard and the existing queries; nothing new is
 * counted here.
 */
import {
  CardError,
  type CardState,
  type DashboardData,
  leadListHref,
} from '@/components/dashboard/ax-dashboard-sections';
import {
  StudioBarRow,
  StudioInsightCard,
  StudioLinkButton,
  StudioPanel,
  StudioSection,
  StudioStat,
} from '@/components/studio';
import { Skeleton } from '@/components/ui/skeleton';
import { periodDelta, shortDay } from '@/lib/features/analytics/dashboard-format';
import { presetHref } from '@/lib/features/leads/list-query';
import { trpc } from '@/lib/trpc/client';
import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

const KNOWN_PLATFORMS = ['as400', 'acos', 'access', 'other', 'unknown'] as const;
const CHART_HEIGHT = 260;

function useNumber() {
  const locale = useLocale();
  return (value: number) => value.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
}

/* --------------------------------------------------------------- Status */

/**
 * What needs attention now, as STUDIO's usage block: consultations waiting for a reply, next
 * actions due (the signed-in member's) and this week's meetings. Each figure opens its list.
 */
export function StatusOverview({
  organizationId,
  state,
  data,
}: {
  organizationId: string;
  state: CardState;
  data?: DashboardData;
}) {
  const t = useTranslations('dashboard.studio');
  const locale = useLocale();
  const number = useNumber();
  // The same queries as the lists below, so nothing is fetched twice
  const due = trpc.leadFollowUp.dueTasks.useQuery(
    { organizationId, scope: 'mine' },
    { enabled: !!organizationId, staleTime: 60 * 1000 }
  );
  const meetings = trpc.leads.weekMeetings.useQuery(
    { organizationId },
    { enabled: !!organizationId, staleTime: 60 * 1000 }
  );
  const figure = (value: number | undefined, loading: boolean) =>
    value !== undefined ? number(value) : loading ? <Skeleton className="h-7 w-10" /> : '—';
  const waiting = state === 'ready' && data ? data.pendingConsultationTotal : undefined;

  return (
    <StudioSection
      title={t('status.title')}
      action={
        <StudioLinkButton href={leadListHref(locale)}>{t('status.toLeads')}</StudioLinkButton>
      }
      data-testid="status-overview"
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
        <StudioStat
          label={t('status.pending')}
          value={figure(waiting, state === 'loading')}
          tone={waiting ? 'alert' : 'default'}
          note={t('status.unit')}
          href={leadListHref(locale, { consultation: true, status: ['new'] })}
        />
        <StudioStat
          label={t('status.due')}
          value={figure(due.data?.total, due.isLoading)}
          note={t('status.unit')}
          href="#dashboard-today"
        />
        <StudioStat
          label={t('status.meetings')}
          value={figure(meetings.data?.total, meetings.isLoading)}
          note={t('status.unit')}
          href={presetHref('meetingsThisWeek', new Date(), `/${locale}/leads`)}
        />
      </div>
    </StudioSection>
  );
}

/* ------------------------------------------------------------ Analytics */

type Metric = 'leads' | 'consultations';

/**
 * The analytics panel: the figure of the period with its daily (or weekly) curve, the migration
 * sources as thin bars, and what changed against the previous period. One widget on the
 * dashboard: it is shown, hidden and moved as a whole.
 */
export function AnalyticsPanel({
  state,
  data,
  onRetry,
  days,
  narrow,
}: {
  state: CardState;
  data?: DashboardData;
  onRetry: () => void;
  days: number;
  narrow: boolean;
}) {
  const t = useTranslations('dashboard.studio');
  const tw = useTranslations('dashboard.ax');
  const locale = useLocale();
  const number = useNumber();
  const selectId = useId();
  const [metric, setMetric] = useState<Metric>('leads');
  const period = data?.days ?? days;

  const points = data?.trend.points ?? [];
  const weekly = data?.trend.unit === 'week';
  const metricLabel = t(`analytics.metric.${metric}`);
  const countOf = (p: (typeof points)[number]) => (metric === 'leads' ? p.leads : p.consultations);
  const total = points.reduce((sum, p) => sum + countOf(p), 0);
  const chartData = points.map((p) => ({
    date: weekly ? tw('trend.weekLabel', { date: shortDay(p.start) }) : shortDay(p.start),
    [metricLabel]: countOf(p),
  }));

  const platformName = (platform: string) =>
    (KNOWN_PLATFORMS as readonly string[]).includes(platform)
      ? tw(`platforms.${platform as (typeof KNOWN_PLATFORMS)[number]}`)
      : platform;
  const platforms = data?.platforms ?? [];
  const platformTotal = platforms.reduce((sum, p) => sum + p.count, 0);

  const loading = state === 'loading' || !data;
  const placeholder = (height: number) => (
    <Skeleton className="w-full" style={{ height }} data-testid="chart-skeleton" />
  );

  return (
    <StudioSection
      title={t('analytics.title')}
      action={
        <StudioLinkButton href={`/${locale}/analytics`}>
          {t('analytics.toAnalytics')}
        </StudioLinkButton>
      }
      data-testid="analytics-panel"
    >
      <StudioPanel className="space-y-10">
        {state === 'error' ? (
          <CardError onRetry={onRetry} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="min-w-0">
                <div className="relative inline-flex items-center">
                  <label htmlFor={selectId} className="sr-only">
                    {t('analytics.metricLabel')}
                  </label>
                  <select
                    id={selectId}
                    value={metric}
                    onChange={(event) => setMetric(event.target.value as Metric)}
                    className="cursor-pointer appearance-none border-0 bg-transparent p-0 pr-5 text-sm font-bold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-50"
                  >
                    <option value="leads">{t('analytics.metric.leads')}</option>
                    <option value="consultations">{t('analytics.metric.consultations')}</option>
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-gray-500"
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-4 text-4xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                  {loading ? <Skeleton className="h-10 w-20" /> : number(total)}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {weekly
                    ? t('analytics.periodWeekly', { days: period })
                    : t('analytics.period', { days: period })}
                </p>
                <div className="mt-6" style={{ height: CHART_HEIGHT }}>
                  {loading ? (
                    placeholder(CHART_HEIGHT)
                  ) : total === 0 ? (
                    <p className="flex h-full items-center justify-center rounded-md bg-gray-50 text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                      {tw('trend.empty')}
                    </p>
                  ) : (
                    <div
                      role="img"
                      aria-label={t('analytics.chartLabel', {
                        metric: metricLabel,
                        days: period,
                        total: number(total),
                      })}
                      className="h-full"
                    >
                      <AreaChart
                        data={chartData}
                        index="date"
                        categories={[metricLabel]}
                        colors={['teal']}
                        integerValues
                        maxCategoryLabels={narrow ? 4 : 6}
                        showLegend={false}
                        valueFormatter={(value) => (locale === 'ja' ? `${value}件` : String(value))}
                        height={CHART_HEIGHT}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-50">
                  {t('analytics.platforms')}
                </h3>
                {loading ? (
                  <div className="mt-4 space-y-4">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : platforms.length === 0 ? (
                  <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                    {tw('platforms.empty')}
                  </p>
                ) : (
                  <ul className="mt-2">
                    {platforms.map((item) => (
                      <StudioBarRow
                        key={item.platform}
                        label={platformName(item.platform)}
                        value={number(item.count)}
                        share={platformTotal > 0 ? (item.count / platformTotal) * 100 : 0}
                        muted={item.platform === 'unknown'}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <Insights data={loading ? undefined : data} days={period} />
          </>
        )}
      </StudioPanel>
    </StudioSection>
  );
}

/** What changed against the previous period, one card per figure */
function Insights({ data, days }: { data?: DashboardData; days: number }) {
  const t = useTranslations('dashboard.studio.insights');
  const number = useNumber();
  const card = (
    key: 'leads' | 'consultations' | 'mql' | 'score',
    value: number | null,
    previous: number | null,
    extra?: string
  ) => {
    const delta = value !== null && previous !== null ? periodDelta(value, previous) : null;
    const direction = !delta ? 'none' : delta.type === 'unchanged' ? 'same' : delta.type;
    const show = (n: number) => (key === 'score' ? number(n) : t('count', { value: number(n) }));
    // What the change is measured against, also when there is no percent (nothing before)
    const before =
      previous === null
        ? t('noPrevious', { days })
        : t('previous', { days, value: show(previous) });
    return (
      <StudioInsightCard
        key={key}
        text={t(`${key}.${direction}`, { days })}
        value={value === null ? '—' : show(value)}
        change={delta?.rate ?? null}
        changeLabel={t('changeLabel', { days })}
        footnote={extra ? `${before} / ${extra}` : before}
      />
    );
  };

  return (
    <div data-testid="insights">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-50">{t('title', { days })}</h3>
      {!data ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {card('leads', data.newLeads, data.previousNewLeads)}
          {card('consultations', data.consultations, data.previousConsultations)}
          {card(
            'mql',
            data.mql,
            data.previousMql,
            data.fitOnly > 0 ? t('fitOnly', { value: number(data.fitOnly) }) : undefined
          )}
          {card('score', data.averageScore, data.previousAverageScore)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Pipeline */

/** All leads by status (all time), each row opening the list of that status */
export function PipelineSection({
  state,
  data,
  onRetry,
}: {
  state: CardState;
  data?: DashboardData;
  onRetry: () => void;
}) {
  const tw = useTranslations('dashboard.ax');
  const tStatus = useTranslations('status');
  const locale = useLocale();
  const number = useNumber();
  const statuses = data?.statuses ?? [];
  const total = statuses.reduce((sum, s) => sum + s.count, 0);

  return (
    <StudioSection
      title={tw('statuses.title')}
      description={tw('statuses.description')}
      data-testid="pipeline"
    >
      {state === 'error' ? (
        <CardError onRetry={onRetry} />
      ) : state === 'loading' || !data ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
          {statuses.map((item) => (
            <StudioBarRow
              key={item.status}
              label={tStatus(item.status)}
              value={number(item.count)}
              share={total > 0 ? (item.count / total) * 100 : 0}
              href={leadListHref(locale, { status: [item.status] })}
            />
          ))}
        </ul>
      )}
    </StudioSection>
  );
}
