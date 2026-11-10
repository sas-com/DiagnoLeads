'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { formatDealDate, formatYen } from '@/components/features/deals/deal-format';
import { DealMarks } from '@/components/features/deals/deal-marks';
import { AddNextActionButton } from '@/components/features/deals/deal-next-task';
import { DealStageBadge } from '@/components/features/deals/deal-stage-badge';
import { AddNextActionDialog } from '@/components/features/lead-follow-up/add-next-action-dialog';
import type { RouterOutputs } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { dealsNeedingAttention, leadLabel } from './today-format';
import { type TodayQuery, TodaySection, sectionState } from './today-section';

type Board = RouterOutputs['deals']['board'];
type BoardDeal = Board['columns'][number]['deals'][number];

/**
 * The dialog that adds a next action from a row (#970): one, for the deal chosen. It has no
 * trigger to give the focus back to. Closed without adding, the focus goes back to the button;
 * once added, the board is read again and the button goes away: the focus goes to the deal's
 * name when its row stays (its close date has passed too), else to the section's heading, as
 * the row leaves the list.
 */
function useAddNextAction(headingId: string) {
  const [chosen, setChosen] = useState<{ deal: BoardDeal; staysListed: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const added = useRef(false);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  return {
    deal: chosen?.deal ?? null,
    open,
    setOpen,
    links,
    start: (deal: BoardDeal, staysListed: boolean, from: HTMLElement) => {
      opener.current = from;
      added.current = false;
      setChosen({ deal, staysListed });
      setOpen(true);
    },
    markAdded: () => {
      added.current = true;
    },
    returnFocus: (event: Event) => {
      const button = opener.current;
      const target = !added.current
        ? button?.isConnected
          ? button
          : null
        : chosen?.staysListed
          ? links.current.get(chosen.deal.id)
          : document.getElementById(headingId);
      if (!target) return;
      event.preventDefault();
      target.focus();
    },
  };
}

/**
 * The user's deals that need attention (今日, #556), with the board's marks in words: past the
 * expected close date (first), or the lead has no open next action. Each row is a link to the
 * deal; the link above opens the user's deals listed by close date. Nothing at all for those who
 * may not read deals (a parent organization's viewers), as on the lead page.
 * An open deal whose lead has no next action gets one added from its row (#970), by those who may
 * change deals: the board's button and dialog (#853), outside the link at the row's right end
 * (decision 2026-10-28-record-contact-from-lists).
 */
export function TodayDeals({
  query,
  organizationId,
}: {
  query: TodayQuery<Board>;
  organizationId: string;
}) {
  const t = useTranslations('today.deals');
  const tToday = useTranslations('today');
  const tDeals = useTranslations('deals');
  const locale = useLocale();
  const headingId = useId();
  const nextAction = useAddNextAction(headingId);
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
      headingId={headingId}
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
          // Named like the leads of the other sections, also without a company or a person
          const lead =
            leadLabel({ company: deal.company, name: deal.leadName }).primary ??
            tToday('noLeadName');
          return (
            <li key={deal.id} className="flex items-start gap-2">
              <Link
                ref={(link) => {
                  if (link) nextAction.links.current.set(deal.id, link);
                  else nextAction.links.current.delete(deal.id);
                }}
                href={`/${locale}/deals/${deal.id}`}
                className={cn(
                  'block min-w-0 flex-1 space-y-1 rounded-md px-1 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50',
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
                  <span>{lead}</span>
                  <span>{formatYen(deal.amount, locale) ?? tDeals('card.noAmount')}</span>
                  <span>
                    {deal.expectedCloseOn
                      ? t('closeOn', { date: formatDealDate(deal.expectedCloseOn) })
                      : tDeals('card.noCloseDate')}
                  </span>
                </div>
                <DealMarks flags={flags} />
              </Link>
              {flags.noNextAction && data?.canEdit && (
                <AddNextActionButton
                  dealName={deal.name}
                  onAdd={(opener) => nextAction.start(deal, flags.overdue, opener)}
                  className="mt-2 shrink-0"
                />
              )}
            </li>
          );
        })}
      </ul>
      {data?.canEdit && nextAction.deal && (
        <AddNextActionDialog
          open={nextAction.open}
          onOpenChange={nextAction.setOpen}
          organizationId={organizationId}
          deal={nextAction.deal}
          leadLabel={nextAction.deal.company || nextAction.deal.leadName || ''}
          today={data.today}
          onAdded={nextAction.markAdded}
          onCloseAutoFocus={nextAction.returnFocus}
        />
      )}
    </TodaySection>
  );
}
