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
 * name when its row stays (its close date has passed too), else on to the next row's name, else
 * the previous one's, else to the section's heading, as for the next actions above (#776). The
 * row beside it is the one when the dialog opened: the board may be read again before it closes.
 * So is the day it starts with: the dialog stays open whatever the board reads meanwhile.
 */
function useAddNextAction(headingId: string) {
  const [chosen, setChosen] = useState<{
    deal: BoardDeal;
    staysListed: boolean;
    today: string;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const neighbour = useRef<string | undefined>(undefined);
  const added = useRef(false);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  return {
    deal: chosen?.deal ?? null,
    today: chosen?.today ?? null,
    open,
    setOpen,
    links,
    start: (
      deal: BoardDeal,
      {
        staysListed,
        today,
        neighbourId,
      }: { staysListed: boolean; today: string; neighbourId?: string },
      from: HTMLElement
    ) => {
      opener.current = from;
      neighbour.current = neighbourId;
      added.current = false;
      setChosen({ deal, staysListed, today });
      setOpen(true);
    },
    markAdded: () => {
      added.current = true;
    },
    returnFocus: (event: Event) => {
      const button = opener.current;
      const link = chosen ? links.current.get(chosen.deal.id) : undefined;
      const next = neighbour.current ? links.current.get(neighbour.current) : undefined;
      const target =
        !added.current && button?.isConnected
          ? button
          : chosen?.staysListed && link?.isConnected
            ? link
            : next?.isConnected
              ? next
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
    <>
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
          {marked.map(({ deal, flags }, index) => {
            // Named like the leads of the other sections, also without a company or a person
            const lead =
              leadLabel({ company: deal.company, name: deal.leadName }).primary ??
              tToday('noLeadName');
            const canAdd = flags.noNextAction && !!data?.canEdit;
            return (
              // On phones the link has the row's width and the button goes under it, at its end, as
              // in the meetings above; from sm, at the row's end
              <li
                key={deal.id}
                className={cn(
                  'flex flex-wrap items-start gap-x-2 gap-y-1 sm:flex-nowrap',
                  canAdd && 'pb-2 sm:pb-0'
                )}
              >
                <Link
                  ref={(link) => {
                    if (link) nextAction.links.current.set(deal.id, link);
                    else nextAction.links.current.delete(deal.id);
                  }}
                  href={`/${locale}/deals/${deal.id}`}
                  className={cn(
                    'block min-w-0 flex-1 basis-full space-y-1 rounded-md px-1 py-2.5 hover:bg-gray-50 sm:basis-auto dark:hover:bg-gray-800/50',
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
                {canAdd && (
                  <AddNextActionButton
                    dealName={deal.name}
                    onAdd={(opener) =>
                      nextAction.start(
                        deal,
                        {
                          staysListed: flags.overdue,
                          today: data?.today ?? '',
                          neighbourId: (marked[index + 1] ?? marked[index - 1])?.deal.id,
                        },
                        opener
                      )
                    }
                    // In line with the first line of the row (44px from sm, 32px from md)
                    className="ml-auto shrink-0 md:mt-2"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </TodaySection>
      {/* Outside the section's content, which a failed or empty read replaces: the dialog and what
        was entered in it stay */}
      {nextAction.deal && nextAction.today && (
        <AddNextActionDialog
          open={nextAction.open}
          onOpenChange={nextAction.setOpen}
          organizationId={organizationId}
          deal={nextAction.deal}
          leadLabel={
            leadLabel({ company: nextAction.deal.company, name: nextAction.deal.leadName })
              .primary ?? ''
          }
          today={nextAction.today}
          onAdded={nextAction.markAdded}
          onCloseAutoFocus={nextAction.returnFocus}
        />
      )}
    </>
  );
}
