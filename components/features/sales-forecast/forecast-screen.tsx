'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { formatYen } from '@/components/features/deals/deal-format';
import { StudioPageHeader, StudioSection, StudioStat } from '@/components/studio';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ProgressBar } from '@/components/ui/progress-bar';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useOrganization } from '@/hooks/use-organization';
import {
  FORECAST_PERIODS,
  type ForecastPeriod,
  forecastPeriodEnum,
} from '@/lib/features/sales-forecast/period';
import {
  CHANGE_KINDS,
  type ChangeGroup,
  type ChangeKind,
  type ForecastRow,
} from '@/lib/features/sales-forecast/report';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2, Lock, Target } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { formatMonthName, formatPlainDay } from './forecast-format';
import { TargetsDialog } from './targets-dialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_ZONE = 'Asia/Tokyo';
/** A group of the week's changes with this many deals or fewer starts opened */
const SMALL_GROUP = 3;
/** The frame of the tiles and the table */
const FRAME = 'rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';

function usePercent() {
  const locale = useLocale();
  return (rate: number) =>
    new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(rate);
}

/**
 * The forecast (Refs #437, #721): for this month, quarter or fiscal year, the target, the won and
 * expected amounts in total and per owner, the open deals left before the period or without a
 * close date, and how the deals changed during the week (for the weekly pipeline meeting).
 */
export function ForecastScreen() {
  const t = useTranslations('salesForecast');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const format = useFormatter();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const parsedPeriod = forecastPeriodEnum.safeParse(params.get('period'));
  const period: ForecastPeriod = parsedPeriod.success ? parsedPeriod.data : 'thisQuarter';
  const [targetsOpen, setTargetsOpen] = useState(false);
  const query = trpc.salesForecast.get.useQuery(
    { organizationId, period },
    { enabled: !!organizationId, placeholderData: (previous) => previous }
  );
  const data = query.data;
  const forbidden = query.error?.data?.code === 'FORBIDDEN';
  const yen = (amount: number) => formatYen(amount, locale) ?? '';

  const setPeriod = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === 'thisQuarter') next.delete('period');
    else next.set('period', value);
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 py-1 sm:px-2 sm:py-6">
      <div className="space-y-2">
        <StudioPageHeader
          title={t('title')}
          description={t('description')}
          actions={
            organizationId &&
            !forbidden && (
              <>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={period}
                  onValueChange={(value) => value && setPeriod(value)}
                  aria-label={t('periodLabel')}
                  className="rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900"
                >
                  {FORECAST_PERIODS.map((value) => (
                    <ToggleGroupItem key={value} value={value} className="h-11 sm:h-8">
                      {t(`periods.${value}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {data?.canEditTargets && (
                  <Button
                    type="button"
                    variant="outline"
                    className={TAP_TARGET}
                    onClick={() => setTargetsOpen(true)}
                  >
                    <Target className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t('setTargets')}
                  </Button>
                )}
              </>
            )
          }
        />
        {data && (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('range', {
              from: formatPlainDay(data.range.from, locale),
              to: formatPlainDay(data.range.to, locale),
            })}
            {' · '}
            {t('fiscalYearNote', { month: formatMonthName(data.fiscalYearStartMonth, locale) })}
            {query.dataUpdatedAt > 0 &&
              ` · ${t('updatedAt', {
                time: format.dateTime(new Date(query.dataUpdatedAt), {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: TIME_ZONE,
                }),
              })}`}
          </p>
        )}
      </div>

      {!organizationId ? null : forbidden ? (
        <Callout title={t('state.forbiddenTitle')} icon={Lock} color="yellow">
          {t('state.forbiddenBody')}
        </Callout>
      ) : query.isError ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-red-200 p-4 dark:border-red-900"
        >
          <p className="text-sm text-red-700 dark:text-red-400">{t('state.loadError')}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {t('state.retry')}
          </Button>
        </div>
      ) : !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-500" aria-busy="true">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {tCommon('loading')}
        </div>
      ) : (
        <div
          className={query.isPlaceholderData ? 'space-y-8 opacity-60' : 'space-y-8'}
          aria-busy={query.isPlaceholderData}
        >
          <SummaryTiles total={data.total} />

          {data.total.target === null &&
            (data.canEditTargets ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                <p>{t('noTargetSet')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={TAP_TARGET}
                  onClick={() => setTargetsOpen(true)}
                >
                  {t('setTargets')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-gray-700 dark:text-gray-300">{t('targets.readOnly')}</p>
            ))}

          {(data.overdue.count > 0 || data.undated.count > 0 || data.total.noAmountCount > 0) && (
            <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-300">
              {data.overdue.count > 0 && (
                <li>
                  {t('notes.overdue', {
                    count: data.overdue.count,
                    amount: yen(data.overdue.amount),
                  })}{' '}
                  {/* The list is in order of the expected close date, the oldest first */}
                  <Link
                    href={`/${locale}/deals?view=list`}
                    className="underline underline-offset-2"
                  >
                    {t('notes.toOverdueList')}
                  </Link>
                </li>
              )}
              {data.undated.count > 0 && (
                <li>
                  {t('notes.undated', {
                    count: data.undated.count,
                    amount: yen(data.undated.amount),
                  })}{' '}
                  <Link
                    href={`/${locale}/deals?view=list`}
                    className="underline underline-offset-2"
                  >
                    {t('notes.toList')}
                  </Link>
                </li>
              )}
              {data.total.noAmountCount > 0 && (
                <li>{t('notes.noAmount', { count: data.total.noAmountCount })}</li>
              )}
            </ul>
          )}

          <StudioSection title={t('table.title')}>
            <OwnerTable
              owners={data.owners}
              total={data.total}
              seesEveryTarget={data.canEditTargets}
              viewerUserId={data.viewerUserId}
            />
          </StudioSection>

          <ChangesSection changes={data.changes} />
        </div>
      )}

      {data?.canEditTargets && (
        <TargetsDialog
          open={targetsOpen}
          onOpenChange={setTargetsOpen}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}

function SummaryTiles({ total }: { total: ForecastRow }) {
  const t = useTranslations('salesForecast.tiles');
  const locale = useLocale();
  const percent = usePercent();
  const yen = (amount: number) => formatYen(amount, locale) ?? '';
  const tiles: { label: string; value: string; note?: ReactNode }[] = [
    { label: t('target'), value: total.target === null ? t('noTarget') : yen(total.target) },
    {
      label: t('won'),
      value: yen(total.won),
      note: total.achievement !== null && t('achievement', { rate: percent(total.achievement) }),
    },
    {
      label: t('forecast'),
      value: yen(total.forecast),
      note:
        total.forecastAchievement !== null &&
        t('forecastAchievement', { rate: percent(total.forecastAchievement) }),
    },
    { label: t('bestCase'), value: yen(total.bestCaseTotal) },
    {
      label: t('gap'),
      value: total.gap === null ? '—' : yen(Math.max(total.gap, 0)),
      note: total.gap !== null && total.gap < 0 && t('above', { amount: yen(-total.gap) }),
    },
    { label: t('weighted'), value: yen(total.weighted) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className={cn(FRAME, 'p-4')}>
          <StudioStat label={tile.label} value={tile.value} note={tile.note || undefined} />
        </div>
      ))}
    </div>
  );
}

type OwnerRow = ForecastRow & {
  ownerUserId: string | null;
  ownerName: string | null;
  targetHidden: boolean;
};

function OwnerTable({
  owners,
  total,
  seesEveryTarget,
  viewerUserId,
}: {
  owners: OwnerRow[];
  total: ForecastRow;
  /** false: the other reps' targets are not sent (shown to those who set targets and the rep) */
  seesEveryTarget: boolean;
  viewerUserId: string;
}) {
  const t = useTranslations('salesForecast.table');
  const locale = useLocale();
  const percent = usePercent();
  const yen = (amount: number | null) =>
    amount === null ? t('noTarget') : (formatYen(amount, locale) ?? '');
  const hiddenCell = (className: string) => (
    <TableCell className={className}>
      <span className="text-gray-600 dark:text-gray-300">{t('hidden')}</span>
    </TableCell>
  );
  // Target, won, rate, forecast and its gap to the target, then what is still open
  const cells = (row: ForecastRow, targetHidden = false) => (
    <>
      {targetHidden ? (
        hiddenCell('text-right')
      ) : (
        <TableCell className="text-right tabular-nums">{yen(row.target)}</TableCell>
      )}
      <TableCell className="text-right tabular-nums">{yen(row.won)}</TableCell>
      {targetHidden ? (
        hiddenCell('min-w-32')
      ) : (
        <TableCell className="min-w-32">
          {row.achievement === null ? (
            t('noTarget')
          ) : (
            <div className="space-y-1">
              <span className="tabular-nums">{percent(row.achievement)}</span>
              <ProgressBar value={row.achievement * 100} color="brand" />
            </div>
          )}
        </TableCell>
      )}
      <TableCell className="text-right tabular-nums">{yen(row.forecast)}</TableCell>
      {targetHidden ? (
        hiddenCell('text-right')
      ) : (
        <TableCell className="text-right tabular-nums">
          {row.gap !== null && row.gap < 0 ? t('above', { amount: yen(-row.gap) }) : yen(row.gap)}
        </TableCell>
      )}
      <TableCell className="text-right tabular-nums">{yen(row.bestCase)}</TableCell>
      <TableCell className="text-right tabular-nums">{yen(row.pipeline)}</TableCell>
      <TableCell className="text-right tabular-nums">{yen(row.weighted)}</TableCell>
    </>
  );
  // The owner's column stays in sight while the figures scroll sideways
  const ownerCell = 'sticky left-0 bg-white dark:bg-gray-900';

  return (
    <div className={cn(FRAME, 'overflow-x-auto')}>
      <Table>
        <TableCaption className="sr-only">{t('caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className={ownerCell}>{t('owner')}</TableHead>
            <TableHead className="text-right">{t('target')}</TableHead>
            <TableHead className="text-right">{t('won')}</TableHead>
            <TableHead>{t('achievement')}</TableHead>
            <TableHead className="text-right">{t('forecast')}</TableHead>
            <TableHead className="text-right">{t('gap')}</TableHead>
            <TableHead className="text-right">{t('bestCase')}</TableHead>
            <TableHead className="text-right">{t('pipeline')}</TableHead>
            <TableHead className="text-right">{t('weighted')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {owners.map((row) => (
            <TableRow key={row.ownerUserId ?? 'unassigned'}>
              <TableCell className={cn(ownerCell, 'font-medium')}>
                {row.ownerUserId ? (
                  <Link
                    href={`/${locale}/deals?owner=${row.ownerUserId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {row.ownerName ?? t('unassigned')}
                  </Link>
                ) : (
                  t('unassigned')
                )}
                {row.ownerUserId === viewerUserId && (
                  <span className="ml-1 font-normal text-gray-600 dark:text-gray-300">
                    {t('you')}
                  </span>
                )}
              </TableCell>
              {cells(row, row.targetHidden)}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className={cn(ownerCell, 'font-bold')}>{t('total')}</TableCell>
            {cells(total)}
          </TableRow>
        </TableFooter>
      </Table>
      {!seesEveryTarget && (
        <p className="border-t px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
          {t('hiddenNote')}
        </p>
      )}
    </div>
  );
}

function ChangesSection({
  changes,
}: {
  changes: { groups: Record<ChangeKind, ChangeGroup>; amountDelta: number };
}) {
  const t = useTranslations('salesForecast.changes');
  const tStages = useTranslations('deals.stages');
  const locale = useLocale();
  const yen = (amount: number) => formatYen(amount, locale) ?? '';
  const amountText = (amount: number | null) => (amount === null ? t('noAmount') : yen(amount));
  const visible = CHANGE_KINDS.filter((kind) => changes.groups[kind].count > 0);
  // Small groups start opened; the rest open on a tap
  const [opened, setOpened] = useState<Set<ChangeKind>>(
    () => new Set(visible.filter((kind) => changes.groups[kind].count <= SMALL_GROUP))
  );
  const delta = changes.amountDelta;
  const stage = (value: string) => (tStages.has(value) ? tStages(value) : value);

  return (
    <StudioSection title={t('title')} description={t('description')}>
      {visible.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('empty')}</p>
      ) : (
        <>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('amountDelta', { amount: `${delta > 0 ? '+' : ''}${yen(delta)}` })}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map((kind) => {
              const group = changes.groups[kind];
              const more = group.count - group.deals.length;
              return (
                <details
                  key={kind}
                  open={opened.has(kind)}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setOpened((current) => {
                      if (current.has(kind) === isOpen) return current;
                      const next = new Set(current);
                      if (isOpen) next.add(kind);
                      else next.delete(kind);
                      return next;
                    });
                  }}
                  className={cn(FRAME, 'p-4')}
                >
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-900 dark:text-gray-50">
                    {t(`groups.${kind}`)}
                    <span className="ml-2 font-normal text-gray-600 dark:text-gray-300">
                      {t('summary', { count: group.count, amount: yen(group.amount) })}
                    </span>
                  </summary>
                  <ul className="mt-1 divide-y divide-gray-100 text-sm dark:divide-gray-800">
                    {group.deals.map((deal) => (
                      <li key={deal.id} className="py-2">
                        <Link
                          href={`/${locale}/deals/${deal.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {deal.name}
                        </Link>
                        <span className="ml-2 text-gray-600 dark:text-gray-300">
                          {deal.ownerName}
                        </span>
                        <p className="text-gray-700 dark:text-gray-300">
                          {deal.before && deal.before.stage !== deal.stage
                            ? t('stageChange', {
                                from: stage(deal.before.stage),
                                to: stage(deal.stage),
                              })
                            : stage(deal.stage)}
                          {' · '}
                          <span className="tabular-nums">
                            {deal.before && deal.before.amount !== deal.amount
                              ? t('amountChange', {
                                  from: amountText(deal.before.amount),
                                  to: amountText(deal.amount),
                                })
                              : amountText(deal.amount)}
                          </span>
                          {kind === 'slipped' &&
                            ` · ${t('dateChange', {
                              from: deal.before?.expectedCloseOn
                                ? formatPlainDay(deal.before.expectedCloseOn, locale)
                                : t('noDate'),
                              to: deal.expectedCloseOn
                                ? formatPlainDay(deal.expectedCloseOn, locale)
                                : t('noDate'),
                            })}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {more > 0 && (
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                      {t('more', { count: more })}{' '}
                      <Link href={`/${locale}/deals`} className="underline underline-offset-2">
                        {t('toBoard')}
                      </Link>
                    </p>
                  )}
                </details>
              );
            })}
          </div>
        </>
      )}
    </StudioSection>
  );
}
