'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { formatDealDate, formatYen } from '@/components/features/deals/deal-format';
import { DealMarks } from '@/components/features/deals/deal-marks';
import { DealStageBadge } from '@/components/features/deals/deal-stage-badge';
import type { RouterOutputs } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { dealsNeedingAttention, leadLabel } from './today-format';
import { type TodayQuery, TodaySection, sectionState } from './today-section';

type Board = RouterOutputs['deals']['board'];

/**
 * The user's deals that need attention (今日, #556), with the board's marks in words: past the
 * expected close date (first), or the lead has no open next action. Each row is a link to the
 * deal; the link above opens the user's deals listed by close date. Nothing at all for those who
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
      link={{
        href: `/${locale}/deals?owner=mine&view=list&sort=expectedCloseOn`,
        label: t('viewAll'),
      }}
      state={sectionState(query, marked.length === 0)}
      emptyText={t('empty')}
    >
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {marked.map(({ deal, flags }) => {
          const lead = leadLabel({ company: deal.company, name: deal.leadName }).primary;
          return (
            <li key={deal.id}>
              <Link
                href={`/${locale}/deals/${deal.id}`}
                className={cn(
                  'block space-y-1 rounded-md px-1 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50',
                  TAP_TARGET
                )}
              >
                {/* Blocks, not spans: the stage badge is a <div> */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 truncate text-sm font-medium text-gray-900 underline underline-offset-4 dark:text-gray-50">
                    {deal.name}
                  </span>
                  <DealStageBadge stage={deal.stage} />
                </div>
                <div className="flex flex-wrap gap-x-3 text-sm text-gray-700 dark:text-gray-300">
                  {lead && <span>{lead}</span>}
                  <span>{formatYen(deal.amount, locale) ?? tDeals('card.noAmount')}</span>
                  <span>
                    {deal.expectedCloseOn
                      ? t('closeOn', { date: formatDealDate(deal.expectedCloseOn) })
                      : tDeals('card.noCloseDate')}
                  </span>
                </div>
                <DealMarks flags={flags} />
              </Link>
            </li>
          );
        })}
      </ul>
    </TodaySection>
  );
}
