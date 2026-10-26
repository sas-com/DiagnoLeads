'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { BoardColumn, DealCard } from '@/lib/features/deals/service';
import { DEAL_STAGES, type DealStage, isOpenStage } from '@/lib/features/deals/types/pipeline';
import { cn } from '@/lib/utils';
import { ArrowRightLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type DragEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { daysSince, dealMarks, formatDealDate, formatYen, formatYenCompact } from './deal-format';
import { DealMarks } from './deal-marks';
import type { MoveOptions } from './use-stage-move';

const DRAG_TYPE = 'application/x-deal-id';

/** The toasts, whose undo moves a card back */
const TOASTER = '[data-sonner-toaster]';
/** Where the focus may follow a moved card: its menu and the questions a move asks (and toasts) */
const FOLLOW_KEEPERS = `[role="menu"], [role="dialog"], [role="alertdialog"], ${TOASTER}`;

type OnMove = (deal: DealCard, stage: DealStage, options?: MoveOptions) => void;
/** Keeps a card's move button known while it is shown; returns its cleanup */
type TrackMoveButton = (dealId: string, button: HTMLButtonElement) => () => void;

interface DealBoardProps {
  columns: BoardColumn[];
  /** Japan calendar day the board was read on */
  today: string;
  /** Days after closing that won and lost deals stay on the board, whatever the period filter */
  closedWithinDays: number;
  canEdit: boolean;
  onMove: OnMove;
}

/**
 * Whether the followed card's new move button should take the focus: nothing has it, or a toast
 * has it. An undo pressed from the keyboard leaves the focus on the toast, which goes away (#720).
 */
const focusLost = () => {
  const active = document.activeElement;
  return !active || active === document.body || active.closest(TOASTER) !== null;
};

/**
 * The pipeline board (Refs #436): one column per stage with its count, amount and weighted
 * amount. A card moves by dragging it to another column or, from the keyboard and on phones,
 * with its "move" menu (WCAG 2.5.7). After a move from the menu the focus is on the card's move
 * button in its new column (#720): the card is drawn anew there, so its new button takes the
 * focus the old one lost, and a question (won, lost, reopen) gives it back when it closes.
 */
export function DealBoard({ columns, today, closedWithinDays, canEdit, onMove }: DealBoardProps) {
  const [dragged, setDragged] = useState<DealCard | null>(null);
  const [over, setOver] = useState<DealStage | null>(null);
  // The deal moved from its menu, whose move button keeps the focus wherever its card goes
  const followed = useRef<string | null>(null);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());

  const trackMoveButton = useCallback<TrackMoveButton>((dealId, button) => {
    moveButtons.current.set(dealId, button);
    if (followed.current === dealId && focusLost()) button.focus();
    return () => {
      if (moveButtons.current.get(dealId) === button) moveButtons.current.delete(dealId);
    };
  }, []);

  // The focus left for something else: stop following the card
  useEffect(() => {
    const leave = (event: Event) => {
      const id = followed.current;
      if (!id) return;
      const target = event.target;
      const kept =
        target instanceof Element &&
        (target === moveButtons.current.get(id) || target.closest(FOLLOW_KEEPERS) !== null);
      if (!kept) followed.current = null;
    };
    document.addEventListener('focusin', leave);
    document.addEventListener('pointerdown', leave);
    return () => {
      document.removeEventListener('focusin', leave);
      document.removeEventListener('pointerdown', leave);
    };
  }, []);

  const moveFromMenu = (deal: DealCard, stage: DealStage) => {
    followed.current = deal.id;
    onMove(deal, stage, {
      // False when the card is no longer on the board (a filter leaves it out): the question
      // then puts the focus back as it does on its own
      returnFocus: () => {
        const button = moveButtons.current.get(deal.id);
        button?.focus();
        return button !== undefined;
      },
    });
  };

  const drop = (stage: DealStage) => (event: DragEvent) => {
    event.preventDefault();
    setOver(null);
    const deal = dragged;
    setDragged(null);
    if (deal && event.dataTransfer.getData(DRAG_TYPE) === deal.id && deal.stage !== stage) {
      onMove(deal, stage);
    }
  };

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="flex min-w-max gap-3">
        {columns.map((column) => (
          <StageColumn
            key={column.stage}
            column={column}
            today={today}
            closedWithinDays={closedWithinDays}
            canEdit={canEdit}
            onMove={moveFromMenu}
            trackMoveButton={trackMoveButton}
            highlighted={over === column.stage && dragged?.stage !== column.stage}
            onDragStart={(deal) => {
              followed.current = null;
              setDragged(deal);
            }}
            onDragOver={(event) => {
              if (!canEdit || !dragged) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOver(column.stage);
            }}
            onDragLeave={() => setOver((stage) => (stage === column.stage ? null : stage))}
            onDrop={drop(column.stage)}
          />
        ))}
      </div>
    </div>
  );
}

function StageColumn({
  column,
  today,
  closedWithinDays,
  canEdit,
  onMove,
  trackMoveButton,
  highlighted,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  column: BoardColumn;
  today: string;
  closedWithinDays: number;
  canEdit: boolean;
  onMove: (deal: DealCard, stage: DealStage) => void;
  trackMoveButton: TrackMoveButton;
  highlighted: boolean;
  onDragStart: (deal: DealCard) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  const t = useTranslations('deals');
  const locale = useLocale();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40',
        highlighted && 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
      )}
    >
      <header className="border-b border-gray-200 px-3 py-2.5 dark:border-gray-800">
        <h2 id={headingId} className="text-sm font-bold text-gray-900 dark:text-gray-50">
          {isOpenStage(column.stage)
            ? t(`stages.${column.stage}`)
            : t('column.closedTitle', {
                stage: t(`stages.${column.stage}`),
                days: closedWithinDays,
              })}
        </h2>
        <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
          {t('column.summary', {
            count: column.count,
            amount: formatYenCompact(column.amount, locale),
          })}
        </p>
        {isOpenStage(column.stage) && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t('column.weighted', { amount: formatYenCompact(column.weightedAmount, locale) })}
          </p>
        )}
      </header>
      {column.deals.length === 0 ? (
        <p className="px-3 py-4 text-sm text-gray-600 dark:text-gray-300">
          {highlighted ? t('column.dropHere') : t('column.empty')}
        </p>
      ) : (
        <ul className="space-y-2 p-2">
          {column.deals.map((deal) => (
            <DealCardItem
              key={deal.id}
              deal={deal}
              today={today}
              canEdit={canEdit}
              onMove={onMove}
              trackMoveButton={trackMoveButton}
              onDragStart={onDragStart}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function DealCardItem({
  deal,
  today,
  canEdit,
  onMove,
  trackMoveButton,
  onDragStart,
}: {
  deal: DealCard;
  today: string;
  canEdit: boolean;
  onMove: (deal: DealCard, stage: DealStage) => void;
  trackMoveButton: TrackMoveButton;
  onDragStart: (deal: DealCard) => void;
}) {
  const t = useTranslations('deals');
  const locale = useLocale();
  const open = isOpenStage(deal.stage);

  return (
    <li
      draggable={canEdit}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, deal.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(deal);
      }}
      className={cn(
        'rounded-md border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-900',
        canEdit && 'cursor-grab active:cursor-grabbing'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/${locale}/deals/${deal.id}`}
            className={cn(
              'inline-flex items-center font-semibold text-gray-900 underline-offset-2 hover:underline dark:text-gray-50',
              TAP_TARGET
            )}
          >
            {deal.name}
          </Link>
          <p className="truncate text-gray-600 dark:text-gray-300">
            {[deal.company, deal.leadName].filter(Boolean).join(' ')}
          </p>
        </div>
        {canEdit && <MoveMenu deal={deal} onMove={onMove} trackMoveButton={trackMoveButton} />}
      </div>

      <p className="mt-2 font-semibold text-gray-900 tabular-nums dark:text-gray-50">
        {formatYen(deal.amount, locale) ?? (
          <span className="font-normal text-gray-600 dark:text-gray-300">{t('card.noAmount')}</span>
        )}
        {deal.amount !== null && open && (
          <span className="ml-1 font-normal text-gray-600 dark:text-gray-300">
            {deal.probability}%
          </span>
        )}
      </p>
      <p className="mt-1 text-gray-600 dark:text-gray-300">
        {deal.expectedCloseOn ? formatDealDate(deal.expectedCloseOn) : t('card.noCloseDate')}
        {' · '}
        {deal.ownerName ?? t('card.unassigned')}
      </p>
      {open && (
        <p className="text-gray-600 dark:text-gray-300">
          {t('card.daysInStage', { days: daysSince(deal.stageChangedAt) })}
        </p>
      )}
      {deal.nextStep && (
        <p className="mt-1 line-clamp-2 text-gray-700 dark:text-gray-300">{deal.nextStep}</p>
      )}
      <DealMarks flags={dealMarks(deal, today)} className="mt-2" />
    </li>
  );
}

function MoveMenu({
  deal,
  onMove,
  trackMoveButton,
}: {
  deal: DealCard;
  onMove: (deal: DealCard, stage: DealStage) => void;
  trackMoveButton: TrackMoveButton;
}) {
  const t = useTranslations('deals');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dealId = deal.id;
  // Once per drawn card: a card moved to another column is drawn anew, with a new button
  useEffect(() => {
    const button = buttonRef.current;
    return button ? trackMoveButton(dealId, button) : undefined;
  }, [dealId, trackMoveButton]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          size="icon"
          // 44px on phones (TAP_TARGET), the compact size from md
          className="h-11 w-11 shrink-0 md:h-8 md:w-8"
          aria-label={t('card.move', { name: deal.name, stage: t(`stages.${deal.stage}`) })}
        >
          <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {DEAL_STAGES.filter((stage) => stage !== deal.stage).map((stage) => (
          <DropdownMenuItem key={stage} className={TAP_TARGET} onSelect={() => onMove(deal, stage)}>
            {t('card.moveTo', { stage: t(`stages.${stage}`) })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
