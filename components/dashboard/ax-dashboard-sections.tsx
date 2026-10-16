'use client';

import { BarChart } from '@/components/charts';
import {
  LEAD_STATUS_BADGE_CLASSES,
  LEAD_STATUS_COLORS,
} from '@/components/features/leads/lead-status-styles';
import { BadgeDelta } from '@/components/ui/badge-delta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  jstShortDay,
  periodDelta,
  periodRange,
  receivedAt,
  shortDay,
  signed,
} from '@/lib/features/analytics/dashboard-format';
import { AX_MIGRATION_CONFIG } from '@/lib/features/diagnostics/ax-migration/config';
import type { RouterOutputs } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AlertCircle, ArrowRight, RotateCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';

export type DashboardData = RouterOutputs['analytics']['getDashboard'];
/** What a card can show: placeholders while loading, a retry on error, or the figures */
export type CardState = 'loading' | 'error' | 'ready';

const KNOWN_PLATFORMS = ['as400', 'acos', 'access', 'other', 'unknown'] as const;
/** Scores at or above this stand out in the recent leads */
const HIGHLIGHT_SCORE = 70;
const CHART_HEIGHT = 200;

const headingClass = 'text-base font-semibold text-gray-900 sm:text-lg dark:text-gray-50';
const subtleClass = 'text-sm text-gray-500 dark:text-gray-400';
const emptyClass =
  'rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400';

function useDashboardText() {
  const tw = useTranslations('dashboard.ax');
  const locale = useLocale();
  const numberFormat = (value: number) => value.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
  const platformName = (platform: string | null) => {
    const key = platform ?? 'unknown';
    return (KNOWN_PLATFORMS as readonly string[]).includes(key)
      ? tw(`platforms.${key as (typeof KNOWN_PLATFORMS)[number]}`)
      : key;
  };
  return { tw, locale, numberFormat, platformName };
}

/** Lead list. TODO(#131): link to the list filtered by status / waiting consultations */
export const leadListHref = (locale: string) => `/${locale}/leads`;
export const leadHref = (locale: string, id: string) => `/${locale}/leads?leadId=${id}`;

/**
 * Small tag naming the period a card follows (the tooltip gives the exact days), or "all time"
 * for figures that ignore the period
 */
export function PeriodTag({ days }: { days: number | 'all' }) {
  const { tw } = useDashboardText();
  const className =
    'inline-flex shrink-0 items-center whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  if (days === 'all') return <span className={className}>{tw('allTimeTag')}</span>;
  const range = periodRange(days);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A button so keyboard users can open the tooltip too */}
        <button
          type="button"
          className={cn(
            className,
            'cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
          )}
        >
          {tw('periodTag', { days })}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tw('periodRange', range)}</TooltipContent>
    </Tooltip>
  );
}

/** Inline error inside a card, so a failure never reads as "nothing to show" */
export function CardError({ onRetry, className }: { onRetry: () => void; className?: string }) {
  const { tw } = useDashboardText();
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center justify-center gap-3 rounded-lg bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        {tw('cardError')}
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        {tw('retry')}
      </Button>
    </div>
  );
}

function SkeletonRows({ rows, className }: { rows: number; className?: string }) {
  return (
    <div className="space-y-3" data-testid="card-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={i} className={cn('h-8 w-full', className)} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ KPI */

type KpiProps = {
  label: string;
  days: number;
  value?: number | null;
  previous?: number | null;
  /** Counts (件) or a score; scores show no percent change */
  kind: 'count' | 'score';
};

function KpiCard({ label, days, value, previous, kind }: KpiProps) {
  const { tw, numberFormat } = useDashboardText();
  const count = (n: number) =>
    kind === 'count' ? tw('kpi.count', { value: numberFormat(n) }) : numberFormat(n);
  const hasValue = value !== undefined && value !== null;
  const comparable = hasValue && previous !== undefined && previous !== null;
  const delta = comparable ? periodDelta(value, previous) : null;

  let note = '';
  if (previous !== undefined) {
    if (previous === null) note = tw('kpi.noPreviousScore', { days });
    else if (kind === 'count' && delta?.rate !== null && delta?.rate !== undefined)
      note = tw('kpi.previousWithRate', {
        days,
        value: count(previous),
        rate: `${signed(delta.rate)}%`,
      });
    else note = tw('kpi.previous', { days, value: count(previous) });
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</h3>
        <PeriodTag days={days} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-2xl font-bold tabular-nums text-gray-900 sm:text-3xl dark:text-gray-50">
          {hasValue ? numberFormat(value) : tw('kpi.noScore')}
          {hasValue && kind === 'score' && (
            <span className="ml-1 text-sm font-normal text-gray-500 dark:text-gray-400">
              {tw('kpi.scoreSuffix')}
            </span>
          )}
        </p>
        {delta && (
          <BadgeDelta deltaType={delta.type} size="sm" className="tabular-nums">
            <span className="sr-only">{tw('kpi.deltaLabel', { days })}</span>
            {signed(delta.delta, count)}
          </BadgeDelta>
        )}
      </div>
      {note && (
        <p className="mt-1.5 text-xs text-gray-500 tabular-nums dark:text-gray-400">{note}</p>
      )}
    </Card>
  );
}

export function KpiSection({
  state,
  data,
  onRetry,
}: { state: CardState; data?: DashboardData; onRetry: () => void }) {
  const { tw } = useDashboardText();
  const tWidgets = useTranslations('dashboard.widgets');
  if (state === 'error') {
    return (
      <Card className="p-4 sm:p-6">
        <h2 className={cn(headingClass, 'mb-3')}>{tWidgets('kpis')}</h2>
        <CardError onRetry={onRetry} />
      </Card>
    );
  }
  if (state === 'loading' || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-testid="card-skeleton">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-3 p-4 sm:p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-full" />
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <KpiCard
        label={tw('kpi.newLeads')}
        days={data.days}
        value={data.newLeads}
        previous={data.previousNewLeads}
        kind="count"
      />
      <KpiCard
        label={tw('kpi.consultations')}
        days={data.days}
        value={data.consultations}
        previous={data.previousConsultations}
        kind="count"
      />
      <KpiCard
        label={tw('kpi.mql')}
        days={data.days}
        value={data.mql}
        previous={data.previousMql}
        kind="count"
      />
      <KpiCard
        label={tw('kpi.averageScore')}
        days={data.days}
        value={data.averageScore}
        previous={data.previousAverageScore}
        kind="score"
      />
    </div>
  );
}

/* ------------------------------------------------- Pending consultations */

type Pending = DashboardData['pendingConsultations'][number];

function lateness(item: Pending, tw: ReturnType<typeof useDashboardText>['tw']) {
  switch (item.due) {
    case 'overdue':
      return tw('pending.overdueBy', { count: item.businessDays });
    case 'today':
      return tw('pending.dueToday');
    case 'tomorrow':
      return tw('pending.dueTomorrow');
    default:
      return tw('pending.dueIn', { count: item.businessDays });
  }
}

const DUE_CLASSES: Record<Pending['due'], string> = {
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  today: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  tomorrow: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  later: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

export function PendingSection({
  state,
  data,
  onRetry,
}: { state: CardState; data?: DashboardData; onRetry: () => void }) {
  const { tw, locale, platformName } = useDashboardText();
  const total = data?.pendingConsultationTotal ?? 0;
  const rest = data ? total - data.pendingConsultations.length : 0;

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-2 sm:mb-3">
        <h2 className={headingClass}>
          {tw('pending.title')}
          {state === 'ready' && total > 0 && (
            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-sm font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              {total}
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-500 sm:text-sm dark:text-gray-400">
          {tw('pending.description', {
            days: AX_MIGRATION_CONFIG.consultationResponseBusinessDays,
          })}
        </p>
      </div>
      {state === 'error' ? (
        <CardError onRetry={onRetry} />
      ) : state === 'loading' || !data ? (
        <SkeletonRows rows={3} className="h-10" />
      ) : data.pendingConsultations.length === 0 ? (
        <p className={emptyClass}>{tw('pending.empty')}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {data.pendingConsultations.map((item) => (
            <li key={item.id}>
              <Link
                href={leadHref(locale, item.id)}
                className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:flex-nowrap dark:hover:bg-gray-800/60"
              >
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-2 py-1 text-xs font-bold',
                    locale === 'ja' ? 'w-32' : 'w-44',
                    DUE_CLASSES[item.due]
                  )}
                >
                  {item.due === 'overdue' && (
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {lateness(item, tw)}
                </span>
                <span className="w-20 shrink-0 text-xs tabular-nums text-gray-600 dark:text-gray-300">
                  {tw('pending.deadline', { date: shortDay(item.deadline) })}
                </span>
                <span className="min-w-0 basis-full truncate sm:basis-auto sm:flex-1">
                  <span className="font-medium text-gray-900 dark:text-gray-50">
                    {item.company ?? tw('recent.noCompany')}
                  </span>
                  <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{item.name}</span>
                </span>
                <span className="hidden whitespace-nowrap text-sm text-gray-500 md:inline dark:text-gray-400">
                  {platformName(item.platform)}
                  <span className="mx-2 text-gray-300 dark:text-gray-600" aria-hidden="true">
                    ·
                  </span>
                  {tw('pending.requestedAt', { date: jstShortDay(new Date(item.requestedAt)) })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {state === 'ready' && rest > 0 && (
        <div className="mt-2 text-right">
          <Link
            href={leadListHref(locale)}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {tw('pending.more', { count: rest })}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- Trend */

export function TrendSection({
  state,
  data,
  onRetry,
  narrow,
  days,
}: {
  state: CardState;
  data?: DashboardData;
  onRetry: () => void;
  narrow: boolean;
  /** Chosen period, shown until its figures arrive */
  days: number;
}) {
  const { tw, locale, numberFormat } = useDashboardText();
  const consultationsLabel = tw('trend.consultations');
  const othersLabel = tw('trend.others');
  const weekly = data?.trend.unit === 'week';
  const points = data?.trend.points ?? [];
  const label = (start: string) =>
    weekly ? tw('trend.weekLabel', { date: shortDay(start) }) : shortDay(start);
  const chartData = points.map((p) => ({
    date: label(p.start),
    [consultationsLabel]: p.consultations,
    [othersLabel]: p.leads - p.consultations,
  }));
  const total = points.reduce((sum, p) => sum + p.leads, 0);
  const peak = points.reduce<(typeof points)[number] | undefined>(
    (best, p) => (!best || p.leads > best.leads ? p : best),
    undefined
  );
  const summary =
    data && peak
      ? tw('trend.summary', {
          days: data.days,
          total: numberFormat(total),
          consultations: numberFormat(points.reduce((sum, p) => sum + p.consultations, 0)),
          peak: label(peak.start),
          max: numberFormat(peak.leads),
        })
      : '';

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={headingClass}>{tw('trend.title')}</h2>
            <PeriodTag days={data?.days ?? days} />
          </div>
          <p className={subtleClass}>
            {weekly ? tw('trend.descriptionWeekly') : tw('trend.description')}
          </p>
        </div>
        <ul
          className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-300"
          aria-hidden="true"
        >
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />
            {consultationsLabel}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-gray-300 dark:bg-gray-600" />
            {othersLabel}
          </li>
        </ul>
      </div>
      <div style={{ height: CHART_HEIGHT }}>
        {state === 'error' ? (
          <CardError onRetry={onRetry} className="h-full" />
        ) : state === 'loading' || !data ? (
          <Skeleton className="h-full w-full" data-testid="chart-skeleton" />
        ) : total === 0 ? (
          <p className={cn(emptyClass, 'flex h-full items-center justify-center')}>
            {tw('trend.empty')}
          </p>
        ) : (
          <div role="img" aria-label={summary} className="h-full">
            <BarChart
              data={chartData}
              index="date"
              categories={[consultationsLabel, othersLabel]}
              colors={['teal', 'lightGray']}
              stacked
              valueFormatter={(value) => (locale === 'ja' ? `${value}件` : String(value))}
              integerValues
              maxCategoryLabels={narrow ? 4 : weekly ? 13 : 10}
              columnWidth={points.length <= 7 ? '45%' : '75%'}
              height={CHART_HEIGHT}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- Breakdown */

function BreakdownRow({
  label,
  count,
  total,
  color,
  href,
}: {
  label: string;
  count: number;
  total: number;
  color: Parameters<typeof ProgressBar>[0]['color'];
  href?: string;
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  const body = (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-gray-700 dark:text-gray-200">{label}</span>
        <span className="tabular-nums text-gray-900 dark:text-gray-50">
          <span className="font-semibold">{count}</span>
          <span className="ml-2 inline-block w-9 text-right text-xs text-gray-500 dark:text-gray-400">
            {percent}%
          </span>
        </span>
      </div>
      <ProgressBar value={percent} color={color} />
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="-mx-2 block rounded-md px-2 py-1 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-gray-800/60"
        >
          {body}
        </Link>
      ) : (
        <div className="py-1">{body}</div>
      )}
    </li>
  );
}

export function BreakdownSection({
  state,
  data,
  onRetry,
  days,
}: {
  state: CardState;
  data?: DashboardData;
  onRetry: () => void;
  /** Chosen period, shown until its figures arrive */
  days: number;
}) {
  const { tw, locale, platformName } = useDashboardText();
  const tStatus = useTranslations('status');
  const totalStatus = (data?.statuses ?? []).reduce((sum, s) => sum + s.count, 0);
  const totalPlatform = (data?.platforms ?? []).reduce((sum, p) => sum + p.count, 0);
  const body = (content: ReactNode) =>
    state === 'error' ? (
      <CardError onRetry={onRetry} />
    ) : state === 'loading' || !data ? (
      <SkeletonRows rows={5} />
    ) : (
      content
    );

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
      <Card className="p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <h2 className={headingClass}>{tw('statuses.title')}</h2>
          <PeriodTag days="all" />
        </div>
        <p className={cn(subtleClass, 'mb-3')}>{tw('statuses.description')}</p>
        {body(
          <ul className="space-y-1">
            {(data?.statuses ?? []).map((item) => (
              <BreakdownRow
                key={item.status}
                label={tStatus(item.status)}
                count={item.count}
                total={totalStatus}
                color={LEAD_STATUS_COLORS[item.status]}
                href={leadListHref(locale)}
              />
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <h2 className={headingClass}>{tw('platforms.title')}</h2>
          <PeriodTag days={data?.days ?? days} />
        </div>
        <p className={cn(subtleClass, 'mb-3')}>{tw('platforms.description')}</p>
        {body(
          data && data.platforms.length === 0 ? (
            <p className={emptyClass}>{tw('platforms.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {(data?.platforms ?? []).map((item) => (
                <BreakdownRow
                  key={item.platform}
                  label={platformName(item.platform)}
                  count={item.count}
                  total={totalPlatform}
                  color={item.platform === 'unknown' ? 'gray' : 'blue'}
                />
              ))}
            </ul>
          )
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------- Recent leads */

type RecentLead = DashboardData['recentLeads'][number];

function useRecentText() {
  const text = useDashboardText();
  const tStatus = useTranslations('status');
  const received = (lead: RecentLead) => {
    const at = receivedAt(new Date(lead.createdAt));
    if (at.kind === 'today') return text.tw('recent.today', { time: at.time });
    if (at.kind === 'yesterday') return text.tw('recent.yesterday');
    return at.date;
  };
  const highlighted = (lead: RecentLead) =>
    lead.mql || (lead.score !== null && lead.score >= HIGHLIGHT_SCORE);
  return { ...text, tStatus, received, highlighted };
}

function StatusBadge({ status }: { status: RecentLead['status'] }) {
  const tStatus = useTranslations('status');
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        LEAD_STATUS_BADGE_CLASSES[status]
      )}
    >
      {tStatus(status)}
    </span>
  );
}

function LeadTags({ lead }: { lead: RecentLead }) {
  const { tw } = useDashboardText();
  return (
    <>
      {lead.consultation && (
        <span className="ml-2 whitespace-nowrap rounded bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          {tw('recent.consultation')}
        </span>
      )}
      {lead.mql && (
        <span className="ml-1.5 whitespace-nowrap rounded bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          {tw('recent.mql')}
        </span>
      )}
    </>
  );
}

function Score({ lead }: { lead: RecentLead }) {
  const { tw, highlighted } = useRecentText();
  if (lead.score === null) return <span className="text-gray-400 dark:text-gray-500">—</span>;
  return highlighted(lead) ? (
    <span
      title={tw('recent.highlight')}
      className="inline-block min-w-8 rounded bg-brand-50 px-1.5 py-0.5 text-center font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
    >
      {lead.score}
    </span>
  ) : (
    <span className="font-semibold text-gray-900 dark:text-gray-50">{lead.score}</span>
  );
}

export function RecentSection({
  state,
  data,
  onRetry,
}: { state: CardState; data?: DashboardData; onRetry: () => void }) {
  const { tw, locale, platformName, received } = useRecentText();
  const t = useTranslations('dashboard');
  const leads = data?.recentLeads ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
        <h2 className={headingClass}>{tw('recent.title')}</h2>
        <Link
          href={leadListHref(locale)}
          className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('viewAll')}
        </Link>
      </div>
      {state === 'error' ? (
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          <CardError onRetry={onRetry} />
        </div>
      ) : state === 'loading' || !data ? (
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          <SkeletonRows rows={6} className="h-10" />
        </div>
      ) : leads.length === 0 ? (
        <p className="px-4 pb-6 text-sm text-gray-500 sm:px-6 dark:text-gray-400">
          {tw('recent.empty')}
        </p>
      ) : (
        <>
          {/* Phones: two lines per lead */}
          <ul
            className="divide-y divide-gray-100 border-t border-gray-100 sm:hidden dark:divide-gray-800 dark:border-gray-800"
            data-testid="recent-list"
          >
            {leads.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={leadHref(locale, lead.id)}
                  className="block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-50">
                      {lead.company ?? lead.name ?? tw('recent.unnamed')}
                      <LeadTags lead={lead} />
                    </span>
                    <StatusBadge status={lead.status} />
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="min-w-0 truncate">
                      {lead.company ? lead.name : null}
                      {lead.company && lead.name ? ' · ' : ''}
                      {platformName(lead.platform)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      <Score lead={lead} />
                      <span>{received(lead)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {/* Wider screens: table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                  <th scope="col" className="px-6 py-2 font-medium">
                    {tw('recent.company')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {tw('recent.status')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {tw('recent.platform')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {tw('recent.score')}
                  </th>
                  <th scope="col" className="px-6 py-2 text-right font-medium">
                    {tw('recent.received')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <td className="px-6 py-2.5">
                      <Link href={leadHref(locale, lead.id)} className="group block">
                        <span className="font-medium text-gray-900 group-hover:underline dark:text-gray-50">
                          {lead.company ?? lead.name ?? tw('recent.unnamed')}
                        </span>
                        <LeadTags lead={lead} />
                        {lead.company && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {lead.name ?? tw('recent.unnamed')}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">
                      {platformName(lead.platform)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <Score lead={lead} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-2.5 text-right text-gray-500 tabular-nums dark:text-gray-400">
                      {received(lead)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
