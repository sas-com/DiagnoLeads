'use client';

/**
 * Dashboard cards from the hearings (#137):
 * - WeekMeetingsSection 「今週の商談予定」: leads whose latest hearing sets a next meeting in the
 *   current Japan week, earliest first, with company, assignee, rating and a link to the lead.
 * - NextMeetingRateSection 「初回商談から次回日程が決まった率」 for the chosen period, with the
 *   counts (definition: lib/features/leads/meetings.ts).
 * Each card loads its own query, so it does not wait for the other dashboard figures.
 */
import { CardError, PeriodTag } from '@/components/dashboard/ax-dashboard-sections';
import { DealRatingBadge, NextMeetingOverdueBadge } from '@/components/features/leads/next-meeting';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { NEXT_MEETING_CLOSED_STATUSES, presetHref } from '@/lib/features/leads/list-query';
import { trpc } from '@/lib/trpc/client';
import { ArrowRight } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

const headingClass = 'text-base font-semibold text-gray-900 sm:text-lg dark:text-gray-50';
const emptyClass =
  'rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400';

/** 'YYYY-MM-DD' -> a short day with weekday ('10/16（木）') */
function useMeetingDay() {
  const format = useFormatter();
  return (day: string) =>
    format.dateTime(new Date(`${day}T00:00:00Z`), {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'UTC',
    });
}

export function WeekMeetingsSection({ organizationId }: { organizationId: string }) {
  const t = useTranslations('dashboard.meetings');
  const locale = useLocale();
  const meetingDay = useMeetingDay();
  const query = trpc.leads.weekMeetings.useQuery(
    { organizationId },
    { enabled: !!organizationId, staleTime: 60 * 1000 }
  );
  const data = query.data;
  const listHref = presetHref('meetingsThisWeek', new Date(), `/${locale}/leads`);
  const rest = data ? data.total - data.items.length : 0;

  return (
    <Card className="p-4 sm:p-6" data-testid="week-meetings">
      <div className="mb-2 flex items-start justify-between gap-3 sm:mb-3">
        <div>
          <h2 className={headingClass}>
            {t('title')}
            {data && data.total > 0 && (
              <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-sm font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                {data.total}
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 sm:text-sm dark:text-gray-400">{t('description')}</p>
        </div>
        <Link
          href={listHref}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
        >
          {t('viewAll')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : !data ? (
        <div className="space-y-3" data-testid="card-skeleton">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : data.items.length === 0 ? (
        <p className={emptyClass}>{t('empty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.items.map((item) => {
              // Won and lost leads are not marked (#137)
              const overdue =
                item.nextMeetingDate < data.today &&
                !(NEXT_MEETING_CLOSED_STATUSES as readonly string[]).includes(item.status);
              const today = item.nextMeetingDate === data.today;
              return (
                <li key={item.leadId}>
                  <Link
                    href={`/${locale}/leads/${item.leadId}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-2.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-gray-800/50"
                  >
                    <span className="w-24 shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-50">
                      {meetingDay(item.nextMeetingDate)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-50">
                        {item.company || t('noCompany')}
                      </span>
                      {item.name && (
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                          {item.name}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {overdue && <NextMeetingOverdueBadge date={item.nextMeetingDate} />}
                      {today && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          {t('today')}
                        </span>
                      )}
                      {item.dealRating && <DealRatingBadge rating={item.dealRating} />}
                      <span className="max-w-[9rem] truncate text-xs text-gray-600 dark:text-gray-300">
                        {item.assignee
                          ? item.assignee.name?.trim() || item.assignee.email
                          : t('unassigned')}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {rest > 0 && (
            <Link
              href={listHref}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('more', { count: rest })}
            </Link>
          )}
        </>
      )}
    </Card>
  );
}

export function NextMeetingRateSection({
  organizationId,
  days,
}: {
  organizationId: string;
  days: 7 | 30 | 90;
}) {
  const t = useTranslations('dashboard.meetings');
  const locale = useLocale();
  const query = trpc.leads.nextMeetingRate.useQuery(
    { organizationId, days },
    { enabled: !!organizationId, staleTime: 60 * 1000, placeholderData: (previous) => previous }
  );
  const data = query.data;

  return (
    <Card className="p-4 sm:p-6" data-testid="next-meeting-rate">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className={headingClass}>{t('rateTitle')}</h2>
          <p className="text-xs text-gray-500 sm:text-sm dark:text-gray-400">
            {t('rateDescription')}
          </p>
        </div>
        <PeriodTag days={days} />
      </div>
      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : !data ? (
        <div className="space-y-2" data-testid="card-skeleton">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
      ) : data.rate === null ? (
        <p className={emptyClass}>{t('rateEmpty')}</p>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p
              className="text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-50"
              data-testid="next-meeting-rate-value"
            >
              {Math.round(data.rate * 100)}%
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('rateCounts', { withNext: data.withNextMeeting, total: data.firstMeetings })}
            </p>
          </div>
          <Link
            href={presetHref('nextMeetingOverdue', new Date(), `/${locale}/leads`)}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {t('rateOverdueLink')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      )}
    </Card>
  );
}
