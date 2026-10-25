'use client';

import { formatYen } from '@/components/features/deals/deal-format';
import { DealsForbidden } from '@/components/features/deals/deals-forbidden';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Loader2, Target } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { TargetsDialog } from './targets-dialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usePercent() {
  const locale = useLocale();
  return (rate: number) =>
    new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(rate);
}

/**
 * The forecast (Refs #437): for this month, quarter or fiscal year, the target, the won and
 * expected amounts in total and per owner, the open deals left before the period or without a
 * close date, and how the deals changed during the week (for the weekly pipeline meeting).
 */
export function ForecastScreen() {
  const t = useTranslations('salesForecast');
  const tCommon = useTranslations('common');
  const locale = useLocale();
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
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-gray-200 pb-5 dark:border-gray-800">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-wide text-gray-900 sm:text-[2rem] dark:text-gray-50">
            {t('title')}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('description')}</p>
          {data && (
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {t('range', { from: data.range.from, to: data.range.to })}
              {' · '}
              {t('fiscalYearNote', { month: data.fiscalYearStartMonth })}
            </p>
          )}
        </div>
        {organizationId && (
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              value={period}
              onValueChange={(value) => value && setPeriod(value)}
              aria-label={t('periodLabel')}
              className="rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900"
            >
              {FORECAST_PERIODS.map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {t(`periods.${value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {data?.canEditTargets && (
              <Button type="button" variant="outline" onClick={() => setTargetsOpen(true)}>
                <Target className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('setTargets')}
              </Button>
            )}
          </div>
        )}
      </header>

      {!organizationId ? null : query.error?.data?.code === 'FORBIDDEN' ? (
        <DealsForbidden />
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

          {(data.overdue.count > 0 || data.undated.count > 0 || data.total.noAmountCount > 0) && (
            <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-300">
              {data.overdue.count > 0 && (
                <li>
                  {t('notes.overdue', {
                    count: data.overdue.count,
                    amount: yen(data.overdue.amount),
                  })}{' '}
                  <Link href={`/${locale}/deals`} className="underline underline-offset-2">
                    {t('notes.toBoard')}
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

          <OwnerTable
            owners={data.owners}
            total={data.total}
            seesEveryTarget={data.canEditTargets}
          />

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
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <dt className="text-sm text-gray-500 dark:text-gray-400">{tile.label}</dt>
          <dd className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
            {tile.value}
          </dd>
          {tile.note && (
            <dd className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{tile.note}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function OwnerTable({
  owners,
  total,
  seesEveryTarget,
}: {
  owners: (ForecastRow & {
    ownerUserId: string | null;
    ownerName: string | null;
    targetHidden: boolean;
  })[];
  total: ForecastRow;
  /** false: the other reps' targets are not sent (shown to those who set targets and the rep) */
  seesEveryTarget: boolean;
}) {
  const t = useTranslations('salesForecast.table');
  const locale = useLocale();
  const percent = usePercent();
  const yen = (amount: number | null) =>
    amount === null ? t('noTarget') : (formatYen(amount, locale) ?? '');
  const hiddenCell = (className: string) => (
    <TableCell className={className}>
      <span className="text-gray-500 dark:text-gray-400">{t('hidden')}</span>
    </TableCell>
  );
  const cells = (row: ForecastRow, targetHidden = false) => (
    <>
      {targetHidden ? (
        hiddenCell('text-right')
      ) : (
        <TableCell className="text-right tabular-nums">{yen(row.target)}</TableCell>
      )}
      <TableCell className="text-right tabular-nums">{yen(row.won)}</TableCell>
      <TableCell className="text-right tabular-nums">{yen(row.commit)}</TableCell>
      <TableCell className="text-right tabular-nums">{yen(row.bestCase)}</TableCell>
      <TableCell className="text-right tabular-nums">{yen(row.pipeline)}</TableCell>
      <TableCell className="text-right tabular-nums">{yen(row.weighted)}</TableCell>
      {targetHidden ? (
        hiddenCell('min-w-32')
      ) : (
        <TableCell className="min-w-32">
          {row.achievement === null ? (
            t('noTarget')
          ) : (
            <div className="space-y-1">
              <span className="tabular-nums">{percent(row.achievement)}</span>
              <ProgressBar value={row.achievement * 100} color="emerald" />
            </div>
          )}
        </TableCell>
      )}
      {targetHidden ? (
        hiddenCell('text-right')
      ) : (
        <TableCell className="text-right tabular-nums">{yen(row.gap)}</TableCell>
      )}
    </>
  );

  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableCaption className="sr-only">{t('caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('owner')}</TableHead>
            <TableHead className="text-right">{t('target')}</TableHead>
            <TableHead className="text-right">{t('won')}</TableHead>
            <TableHead className="text-right">{t('commit')}</TableHead>
            <TableHead className="text-right">{t('bestCase')}</TableHead>
            <TableHead className="text-right">{t('pipeline')}</TableHead>
            <TableHead className="text-right">{t('weighted')}</TableHead>
            <TableHead>{t('achievement')}</TableHead>
            <TableHead className="text-right">{t('gap')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {owners.map((row) => (
            <TableRow key={row.ownerUserId ?? 'unassigned'}>
              <TableCell className="font-medium">{row.ownerName ?? t('unassigned')}</TableCell>
              {cells(row, row.targetHidden)}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-bold">{t('total')}</TableCell>
            {cells(total)}
          </TableRow>
        </TableFooter>
      </Table>
      {!seesEveryTarget && (
        <p className="border-t px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
          {t('hiddenNote')}
        </p>
      )}
    </Card>
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
  const visible = CHANGE_KINDS.filter((kind) => changes.groups[kind].count > 0);
  const delta = changes.amountDelta;
  const stage = (value: string) => (tStages.has(value) ? tStages(value) : value);

  return (
    <section aria-labelledby="forecast-changes" className="space-y-3">
      <div>
        <h2 id="forecast-changes" className="text-lg font-bold text-gray-900 dark:text-gray-50">
          {t('title')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('description')}</p>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('empty')}</p>
      ) : (
        <>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('amountDelta', { amount: `${delta > 0 ? '+' : ''}${yen(delta)}` })}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map((kind) => {
              const group = changes.groups[kind];
              return (
                <details
                  key={kind}
                  className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
                >
                  <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-50">
                    {t(`groups.${kind}`)}
                    <span className="ml-2 font-normal text-gray-600 dark:text-gray-300">
                      {t('summary', { count: group.count, amount: yen(group.amount) })}
                    </span>
                  </summary>
                  <ul className="mt-3 divide-y divide-gray-100 text-sm dark:divide-gray-800">
                    {group.deals.map((deal) => (
                      <li key={deal.id} className="py-2">
                        <Link
                          href={`/${locale}/deals/${deal.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {deal.name}
                        </Link>
                        <span className="ml-2 text-gray-500">{deal.ownerName}</span>
                        <p className="text-gray-600 dark:text-gray-300">
                          {deal.before && deal.before.stage !== deal.stage
                            ? t('stageChange', {
                                from: stage(deal.before.stage),
                                to: stage(deal.stage),
                              })
                            : stage(deal.stage)}
                          {kind === 'slipped' &&
                            ` · ${t('dateChange', {
                              from: deal.before?.expectedCloseOn ?? t('noDate'),
                              to: deal.expectedCloseOn ?? t('noDate'),
                            })}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
