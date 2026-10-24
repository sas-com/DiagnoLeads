'use client';

import { ContactQuickActions } from '@/components/features/lead-follow-up/contact-quick-actions';
import { LEAD_STATUS_BADGE_CLASSES } from '@/components/features/leads/lead-status-styles';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  jstShortDay,
  periodRange,
  receivedAt,
  shortDay,
} from '@/lib/features/analytics/dashboard-format';
import { AX_MIGRATION_CONFIG } from '@/lib/features/diagnostics/ax-migration/config';
import {
  type LeadListFilters,
  leadListHref as buildLeadListHref,
} from '@/lib/features/leads/list-query';
import type { RouterOutputs } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AlertCircle, ArrowRight, RotateCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

export type DashboardData = RouterOutputs['analytics']['getDashboard'];
/** What a card can show: placeholders while loading, a retry on error, or the figures */
export type CardState = 'loading' | 'error' | 'ready';

const KNOWN_PLATFORMS = ['as400', 'acos', 'access', 'other', 'unknown'] as const;

const headingClass = 'text-base font-semibold text-gray-900 sm:text-lg dark:text-gray-50';
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

/** Lead list, optionally filtered (the filters are kept in the list's URL, #131) */
export const leadListHref = (locale: string, filters?: Partial<LeadListFilters>) =>
  buildLeadListHref(filters, undefined, `/${locale}/leads`);
export const leadHref = (locale: string, id: string) => `/${locale}/leads/${id}`;

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
  organizationId,
  canRecordContact = false,
}: {
  state: CardState;
  data?: DashboardData;
  onRetry: () => void;
  /** With permission to edit leads, each request gets the one-tap contact buttons (#136) */
  organizationId?: string;
  canRecordContact?: boolean;
}) {
  const { tw, locale, platformName } = useDashboardText();
  const total = data?.pendingConsultationTotal ?? 0;
  const rest = data ? total - data.pendingConsultations.length : 0;

  return (
    <Card className="p-4 shadow-none sm:p-6 dark:border-gray-800">
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
          {canRecordContact && ` ${tw('pending.contactHint')}`}
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
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-2 lg:flex-nowrap lg:pb-0"
            >
              <Link
                href={leadHref(locale, item.id)}
                className="-mx-2 flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:flex-nowrap lg:basis-auto dark:hover:bg-gray-800/60"
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
                  {item.noAnswerCount > 0 && (
                    <span className="ml-2 whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {tw('pending.noAnswer', { count: item.noAnswerCount })}
                    </span>
                  )}
                  {/* Assignee (#135) */}
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    {item.assigneeName
                      ? tw('pending.assignee', { name: item.assigneeName })
                      : tw('pending.unassigned')}
                  </span>
                </span>
                <span className="hidden whitespace-nowrap text-sm text-gray-500 md:inline dark:text-gray-400">
                  {platformName(item.platform)}
                  <span className="mx-2 text-gray-300 dark:text-gray-600" aria-hidden="true">
                    ·
                  </span>
                  {tw('pending.requestedAt', { date: jstShortDay(new Date(item.requestedAt)) })}
                </span>
              </Link>
              {canRecordContact && organizationId && (
                <ContactQuickActions
                  organizationId={organizationId}
                  leadId={item.id}
                  leadLabel={item.company ?? item.name ?? tw('recent.noCompany')}
                  compact
                  className="min-w-0 lg:shrink-0"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {state === 'ready' && rest > 0 && (
        <div className="mt-2 text-right">
          {/* Waiting = asked for a consultation and still new, as counted above */}
          <Link
            href={leadListHref(locale, { consultation: true, status: ['new'] })}
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
  return { ...text, tStatus, received };
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
                    <span className="shrink-0 tabular-nums">{received(lead)}</span>
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
