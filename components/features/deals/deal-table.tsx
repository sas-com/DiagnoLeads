'use client';

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
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatYen } from './deal-format';
import { DealStageBadge } from './deal-stage-badge';

/** The board's deals as one table (Refs #436), in the board's order */
export function DealTable({ deals, today }: { deals: DealCard[]; today: string }) {
  const t = useTranslations('deals');
  const locale = useLocale();

  if (deals.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">{t('list.empty')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <Table>
        <TableCaption className="sr-only">{t('list.caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('fields.name')}</TableHead>
            <TableHead>{t('fields.company')}</TableHead>
            <TableHead>{t('fields.stage')}</TableHead>
            <TableHead className="text-right">{t('fields.amount')}</TableHead>
            <TableHead className="text-right">{t('fields.probability')}</TableHead>
            <TableHead>{t('fields.expectedCloseOn')}</TableHead>
            <TableHead>{t('fields.owner')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((deal) => {
            const overdue =
              isOpenStage(deal.stage) && !!deal.expectedCloseOn && deal.expectedCloseOn < today;
            return (
              <TableRow key={deal.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/${locale}/deals/${deal.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {deal.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/${locale}/leads/${deal.leadId}`}
                    className="underline-offset-2 hover:underline"
                  >
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
                <TableCell className={overdue ? 'text-red-700 dark:text-red-400' : undefined}>
                  {deal.expectedCloseOn ?? '—'}
                  {overdue && <span className="sr-only">{t('card.overdue')}</span>}
                </TableCell>
                <TableCell>{deal.ownerName ?? t('card.unassigned')}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
