'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { formatDealDate } from '@/components/features/deals/deal-format';
import { DealMarks } from '@/components/features/deals/deal-marks';
import { DealStageBadge } from '@/components/features/deals/deal-stage-badge';
import type { RouterOutputs } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { dealsNeedingAttention } from './today-format';
import { type TodayQuery, TodaySection, sectionState } from './today-section';

type Board = RouterOutputs['deals']['board'];

/**
 * The user's deals that need attention (今日, #556), with the board's marks in words: past the
 * expected close date (first), or the lead has no open next action. Nothing at all for those who
 * may not read deals (a parent organization's viewers), as on the lead page.
 */
export function TodayDeals({ query }: { query: TodayQuery<Board> }) {
  const t = useTranslations('today.deals');
  const tDeals = useTranslations('deals');
  const locale = useLocale();
  const data = query.data;

  if (query.error?.data?.code === 'FORBIDDEN') return null;

  const marked = data
    ? dealsNeedingAttention(
        data.columns.flatMap((column) => column.deals),
        data.today
      )
    : [];

  return (
    <TodaySection
      title={t('title')}
      description={t('description')}
      count={marked.length}
      link={{ href: `/${locale}/deals?owner=mine&view=list`, label: t('viewAll') }}
      state={sectionState(query, marked.length === 0)}
      emptyText={t('empty')}
    >
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {marked.map(({ deal, flags }) => (
          <li key={deal.id} className="space-y-1 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link
                href={`/${locale}/deals/${deal.id}`}
                className={cn(
                  'inline-flex min-w-0 items-center text-sm font-medium text-gray-900 underline underline-offset-4 hover:text-brand-800 dark:text-gray-50',
                  TAP_TARGET
                )}
              >
                <span className="truncate">{deal.name}</span>
              </Link>
              <DealStageBadge stage={deal.stage} />
            </div>
            <p className="flex flex-wrap gap-x-3 text-sm text-gray-700 dark:text-gray-300">
              {(deal.company || deal.leadName) && <span>{deal.company || deal.leadName}</span>}
              <span>
                {deal.expectedCloseOn
                  ? t('closeOn', { date: formatDealDate(deal.expectedCloseOn) })
                  : tDeals('card.noCloseDate')}
              </span>
            </p>
            <DealMarks flags={flags} />
          </li>
        ))}
      </ul>
    </TodaySection>
  );
}
