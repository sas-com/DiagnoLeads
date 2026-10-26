'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DealCard } from '@/lib/features/deals/service';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { dealMarks, formatDealDate, formatYen } from './deal-format';
import type { DealSort, DealSortKey } from './deal-list-sort';
import { DealMarks } from './deal-marks';
import { DealStageBadge } from './deal-stage-badge';

interface DealTableProps {
  /** The deals in the order to list them */
  deals: DealCard[];
  /** Japan calendar day the board was read on (overdue close dates) */
  today: string;
  sort: DealSort;
  onSort: (column: DealSortKey) => void;
}

const LINK = cn('inline-flex items-center underline-offset-2 hover:underline', TAP_TARGET);

/**
 * The board's deals as one table (Refs #436), sortable by stage (the board's order), amount and
 * expected close date (#720). Each row has the deal's next step and the marks of its board card;
 * a passed close date is said with an icon and words, not only in red.
 */
export function DealTable({ deals, today, sort, onSort }: DealTableProps) {
  const t = useTranslations('deals');
  const locale = useLocale();

  if (deals.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-600">{t('state.noMatch')}</p>;
  }

  const sortable = (column: DealSortKey, label: string, className?: string) => (
    <TableHead
      className={className}
      aria-sort={sort.by !== column ? 'none' : sort.order === 'asc' ? 'ascending' : 'descending'}
    >
      <SortButton column={column} label={label} sort={sort} onSort={onSort} />
    </TableHead>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <Table>
        <TableCaption className="sr-only">{t('list.caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="text-gray-700 dark:text-gray-300">{t('fields.name')}</TableHead>
            <TableHead className="text-gray-700 dark:text-gray-300">
              {t('fields.company')}
            </TableHead>
            {sortable('stage', t('fields.stage'))}
            {sortable('amount', t('fields.amount'), 'text-right')}
            <TableHead className="text-right text-gray-700 dark:text-gray-300">
              {t('fields.probability')}
            </TableHead>
            {sortable('expectedCloseOn', t('fields.expectedCloseOn'))}
            <TableHead className="text-gray-700 dark:text-gray-300">{t('list.marks')}</TableHead>
            <TableHead className="text-gray-700 dark:text-gray-300">{t('fields.owner')}</TableHead>
            <TableHead className="text-gray-700 dark:text-gray-300">
              {t('fields.nextStep')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((deal) => {
            const marks = dealMarks(deal, today);
            return (
              <TableRow key={deal.id}>
                <TableCell className="font-medium">
                  <Link href={`/${locale}/deals/${deal.id}`} className={LINK}>
                    {deal.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/${locale}/leads/${deal.leadId}`} className={LINK}>
                    {deal.company || deal.leadName || '—'}
                  </Link>
                </TableCell>
                <TableCell>
                  <DealStageBadge stage={deal.stage} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatYen(deal.amount, locale) ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{deal.probability}%</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {deal.expectedCloseOn ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        marks.overdue && 'font-medium text-red-700 dark:text-red-400'
                      )}
                    >
                      {/* The marks' column says it in words */}
                      {marks.overdue && (
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      {formatDealDate(deal.expectedCloseOn)}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="min-w-48">
                  <DealMarks flags={marks} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {deal.ownerName ?? t('card.unassigned')}
                </TableCell>
                <TableCell className="min-w-48 max-w-80">
                  {deal.nextStep ? (
                    <span className="line-clamp-2">{deal.nextStep}</span>
                  ) : (
                    <span className="text-gray-600 dark:text-gray-300">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** A column header that sorts the list: the same column flips, another starts in its order */
function SortButton({
  column,
  label,
  sort,
  onSort,
}: {
  column: DealSortKey;
  label: string;
  sort: DealSort;
  onSort: (column: DealSortKey) => void;
}) {
  const t = useTranslations('deals.list');
  const active = sort.by === column;
  const Icon = !active ? ArrowUpDown : sort.order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      // The name keeps the visible label (WCAG 2.5.3); the header's aria-sort says the order too
      aria-label={
        active
          ? t('sorted', { column: label, order: t(`orders.${column}.${sort.order}`) })
          : t('sortBy', { column: label })
      }
      className={cn(
        '-mx-2 inline-flex h-11 items-center gap-1 rounded-md px-2 font-medium text-gray-700 hover:bg-gray-100 md:h-8 dark:text-gray-300 dark:hover:bg-gray-800',
        active && 'text-gray-900 dark:text-gray-50'
      )}
    >
      {label}
      <Icon className={cn('h-4 w-4', !active && 'opacity-60')} aria-hidden="true" />
    </button>
  );
}
