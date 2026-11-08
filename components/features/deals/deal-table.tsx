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
import { isOpenStage } from '@/lib/features/deals/types/pipeline';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { dealMarks, formatDealDate, formatYen } from './deal-format';
import type { DealSort, DealSortKey } from './deal-list-sort';
import { DealMarks } from './deal-marks';
import { DealNextTaskSummary } from './deal-next-task';
import { DealStageBadge } from './deal-stage-badge';

interface DealTableProps {
  /** The deals in the order to list them */
  deals: DealCard[];
  /** Japan calendar day the board was read on (overdue close dates) */
  today: string;
  /** Days after closing that won and lost deals are listed, as on the board */
  closedWithinDays: number;
  sort: DealSort;
  onSort: (column: DealSortKey) => void;
}

const LINK = cn('inline-flex items-center underline-offset-2 hover:underline', TAP_TARGET);

/**
 * The board's deals as one table (Refs #436), sortable by stage (the board's order), amount and
 * expected close date (#720). Each row has the deal's lead (company and name, as on the board's
 * cards), the marks of its board card and next to them, as on the card, the lead's next action of
 * an open deal (#853); a passed close date is said with an icon and words, not only in red. The
 * caption says the order, the headers' aria-sort too, and a line above the table says how long
 * won and lost deals stay listed.
 */
export function DealTable({ deals, today, closedWithinDays, sort, onSort }: DealTableProps) {
  const t = useTranslations('deals');
  const locale = useLocale();

  if (deals.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-600 dark:text-gray-300">
        {t('state.noMatch')}
      </p>
    );
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
    <div className="space-y-2">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t('list.closedNote', { days: closedWithinDays })}
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <Table>
          <TableCaption className="sr-only">
            {t('list.caption', { order: t(`list.orders.${sort.by}.${sort.order}`) })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="text-gray-700 dark:text-gray-300">{t('fields.name')}</TableHead>
              <TableHead className="text-gray-700 dark:text-gray-300">{t('list.lead')}</TableHead>
              {sortable('stage', t('fields.stage'))}
              {sortable('amount', t('fields.amount'), 'text-right')}
              <TableHead className="text-right text-gray-700 dark:text-gray-300">
                {t('fields.probability')}
              </TableHead>
              {sortable('expectedCloseOn', t('fields.expectedCloseOn'))}
              {/* The alerts and the next action side by side: a missing one is marked next to it */}
              <TableHead className="text-gray-700 dark:text-gray-300">{t('list.marks')}</TableHead>
              <TableHead className="text-gray-700 dark:text-gray-300">
                {t('list.nextAction')}
              </TableHead>
              <TableHead className="text-gray-700 dark:text-gray-300">
                {t('fields.owner')}
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
                    {deal.company || deal.leadName ? (
                      <Link
                        href={`/${locale}/leads/${deal.leadId}`}
                        className={cn(LINK, 'flex-col items-start justify-center')}
                      >
                        {/* Two lines, as on the board's cards; the space keeps the name apart */}
                        {deal.company && <span>{deal.company}</span>}{' '}
                        {deal.leadName && (
                          <span className="text-gray-600 dark:text-gray-300">{deal.leadName}</span>
                        )}
                      </Link>
                    ) : (
                      '—'
                    )}
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
                        {/* The alerts' column says it in words */}
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
                  <TableCell className="min-w-48 max-w-80">
                    {/* Not for closed deals; an open one without it is marked in the alerts */}
                    {isOpenStage(deal.stage) && deal.nextTask ? (
                      <DealNextTaskSummary task={deal.nextTask} today={today} />
                    ) : (
                      <span className="text-gray-600 dark:text-gray-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {deal.ownerName ?? t('card.unassigned')}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * A column header that sorts the list: the same column flips, another starts in its order. Its
 * name is the column's alone (WCAG 2.5.3); the header's aria-sort and the caption say the order.
 */
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
  const active = sort.by === column;
  const Icon = !active ? ArrowUpDown : sort.order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
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
