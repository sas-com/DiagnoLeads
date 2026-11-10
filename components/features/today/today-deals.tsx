'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import {
  DealCloseDateButton,
  DealCloseDateDialog,
} from '@/components/features/deals/deal-close-date-dialog';
import { formatDealDate, formatYen } from '@/components/features/deals/deal-format';
import { DealMarks } from '@/components/features/deals/deal-marks';
import { AddNextActionButton } from '@/components/features/deals/deal-next-task';
import { DealStageBadge } from '@/components/features/deals/deal-stage-badge';
import { AddNextActionDialog } from '@/components/features/lead-follow-up/add-next-action-dialog';
import { type RowDialogClosed, useRowDialog } from '@/hooks/use-row-dialog';
import type { RouterOutputs } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useRef } from 'react';
import { dealsNeedingAttention, leadLabel } from './today-format';
import { type TodayQuery, TodaySection, sectionState } from './today-section';

type Board = RouterOutputs['deals']['board'];
type BoardDeal = Board['columns'][number]['deals'][number];

/**
 * What a dialog opened from a row is open for: adding a next action (#970) or changing the close
 * date (#999)
 */
interface ChosenDeal {
  deal: BoardDeal;
  /**
   * The row stays once it is done, by its other mark: its close date has passed too (a next
   * action added), or its lead has no next action either (the close date changed)
   */
  staysListed: boolean;
  /** The day the board was read for: the dialog starts with it whatever is read meanwhile */
  today: string;
  /** The row beside it when the dialog opened, as the board may be read again before it closes */
  neighbourId?: string;
}

/**
 * The user's deals that need attention (今日, #556), with the board's marks in words: past the
 * expected close date (first), or the lead has no open next action. Each row is a link to the
 * deal; the link above opens the user's deals listed by close date. Nothing at all for those who
 * may not read deals (a parent organization's viewers), as on the lead page.
 * An open deal whose lead has no next action gets one added from its row (#970), by those who may
 * change deals: the board's button and dialog (#853), outside the link at the row's right end
 * (decision 2026-10-28-record-contact-from-lists). The dialog is one, outside the section's
 * content (#998). Closed without adding, the focus goes back to the button; once added, the
 * board is read again and the button goes away: the focus goes to the deal's name when its row
 * stays (its close date has passed too), else on to the next row's name, else the previous
 * one's, else to the section's heading, as for the next actions above (#776).
 * A deal past its expected close date gets the date changed from its row the same way (#999),
 * with a dialog of its own: the row stays when its lead has no next action either.
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
  const links = useRef(new Map<string, HTMLAnchorElement>());
  // Closed without a change, back to the button; done, the deal's name when its row stays, else
  // on to the next row's name, the previous one's or the heading
  const focusAfter = ({ chosen, done, opener }: RowDialogClosed<ChosenDeal>) => {
    if (!done && opener) return opener;
    const link = links.current.get(chosen.deal.id);
    if (chosen.staysListed && link?.isConnected) return link;
    const next = chosen.neighbourId ? links.current.get(chosen.neighbourId) : undefined;
    return next?.isConnected ? next : document.getElementById(headingId);
  };
  const nextAction = useRowDialog<ChosenDeal>(focusAfter);
  const closeDate = useRowDialog<ChosenDeal>(focusAfter);
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
            const canChangeDate = flags.overdue && !!data?.canEdit;
            // What the dialog opened from this row is for
            const chosen = (staysListed: boolean): ChosenDeal => ({
              deal,
              staysListed,
              today: data?.today ?? '',
              neighbourId: (marked[index + 1] ?? marked[index - 1])?.deal.id,
            });
            return (
              // On phones the link has the row's width and the buttons go under it, at its end, as
              // in the meetings above; from sm, at the row's end
              <li
                key={deal.id}
                className={cn(
                  'flex flex-wrap items-start gap-x-2 gap-y-1 sm:flex-nowrap',
                  (canAdd || canChangeDate) && 'pb-2 sm:pb-0'
                )}
              >
                <Link
                  ref={(link) => {
                    if (link) links.current.set(deal.id, link);
                    else links.current.delete(deal.id);
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
                {(canAdd || canChangeDate) && (
                  // In line with the first line of the row (44px from sm, 32px from md), in the
                  // order of the marks; side by side, wrapping under each other when narrow
                  <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2 md:mt-2">
                    {canChangeDate && (
                      <DealCloseDateButton
                        dealName={deal.name}
                        onChange={(opener) => closeDate.start(chosen(flags.noNextAction), opener)}
                      />
                    )}
                    {canAdd && (
                      <AddNextActionButton
                        dealName={deal.name}
                        onAdd={(opener) => nextAction.start(chosen(flags.overdue), opener)}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </TodaySection>
      {/* Outside the section's content, which a failed or empty read replaces: the dialog and what
        was entered in it stay */}
      {nextAction.chosen?.today && (
        <AddNextActionDialog
          open={nextAction.open}
          onOpenChange={nextAction.setOpen}
          organizationId={organizationId}
          deal={nextAction.chosen.deal}
          leadLabel={
            leadLabel({
              company: nextAction.chosen.deal.company,
              name: nextAction.chosen.deal.leadName,
            }).primary ?? ''
          }
          today={nextAction.chosen.today}
          onAdded={nextAction.markDone}
          onCloseAutoFocus={nextAction.returnFocus}
        />
      )}
      {closeDate.chosen?.today && (
        <DealCloseDateDialog
          open={closeDate.open}
          onOpenChange={closeDate.setOpen}
          organizationId={organizationId}
          deal={closeDate.chosen.deal}
          leadLabel={
            leadLabel({
              company: closeDate.chosen.deal.company,
              name: closeDate.chosen.deal.leadName,
            }).primary ?? ''
          }
          today={closeDate.chosen.today}
          onChanged={closeDate.markDone}
          onCloseAutoFocus={closeDate.returnFocus}
        />
      )}
    </>
  );
}
