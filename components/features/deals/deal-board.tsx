'use client';

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
import { AlertTriangle, ArrowRightLeft, ListX } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type DragEvent, useId, useState } from 'react';
import { daysSince, formatYen, formatYenCompact } from './deal-format';

const DRAG_TYPE = 'application/x-deal-id';

interface DealBoardProps {
  columns: BoardColumn[];
  /** Japan calendar day the board was read on */
  today: string;
  canEdit: boolean;
  onMove: (deal: DealCard, stage: DealStage) => void;
}

/**
 * The pipeline board (Refs #436): one column per stage with its count, amount and weighted
 * amount. A card moves by dragging it to another column or, from the keyboard and on phones,
 * with its "move" menu (WCAG 2.5.7).
 */
export function DealBoard({ columns, today, canEdit, onMove }: DealBoardProps) {
  const [dragged, setDragged] = useState<DealCard | null>(null);
  const [over, setOver] = useState<DealStage | null>(null);

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
            canEdit={canEdit}
            onMove={onMove}
            highlighted={over === column.stage && dragged?.stage !== column.stage}
            onDragStart={setDragged}
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
  canEdit,
  onMove,
  highlighted,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  column: BoardColumn;
  today: string;
  canEdit: boolean;
  onMove: (deal: DealCard, stage: DealStage) => void;
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
          {t(`stages.${column.stage}`)}
        </h2>
        <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
          {t('column.summary', {
            count: column.count,
            amount: formatYenCompact(column.amount, locale),
          })}
        </p>
        {isOpenStage(column.stage) && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('column.weighted', { amount: formatYenCompact(column.weightedAmount, locale) })}
          </p>
        )}
      </header>
      {column.deals.length === 0 ? (
        <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
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
  onDragStart,
}: {
  deal: DealCard;
  today: string;
  canEdit: boolean;
  onMove: (deal: DealCard, stage: DealStage) => void;
  onDragStart: (deal: DealCard) => void;
}) {
  const t = useTranslations('deals');
  const locale = useLocale();
  const open = isOpenStage(deal.stage);
  const overdue = open && !!deal.expectedCloseOn && deal.expectedCloseOn < today;
  const noNextAction = open && !deal.hasOpenTask;

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
            className="font-semibold text-gray-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-50"
          >
            {deal.name}
          </Link>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {[deal.company, deal.leadName].filter(Boolean).join(' ')}
          </p>
        </div>
        {canEdit && <MoveMenu deal={deal} onMove={onMove} />}
      </div>

      <p className="mt-2 font-semibold text-gray-900 tabular-nums dark:text-gray-50">
        {formatYen(deal.amount, locale) ?? (
          <span className="font-normal text-gray-500 dark:text-gray-400">{t('card.noAmount')}</span>
        )}
        {deal.amount !== null && open && (
          <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
            {deal.probability}%
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
        {deal.expectedCloseOn ?? t('card.noCloseDate')}
        {' · '}
        {deal.ownerName ?? t('card.unassigned')}
      </p>
      {open && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('card.daysInStage', { days: daysSince(deal.stageChangedAt) })}
        </p>
      )}
      {deal.nextStep && (
        <p className="mt-1 line-clamp-2 text-xs text-gray-700 dark:text-gray-300">
          {deal.nextStep}
        </p>
      )}
      {(overdue || noNextAction) && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {overdue && (
            <li className="flex items-center gap-1 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('card.overdue')}
            </li>
          )}
          {noNextAction && (
            <li className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <ListX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('card.noNextAction')}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function MoveMenu({
  deal,
  onMove,
}: {
  deal: DealCard;
  onMove: (deal: DealCard, stage: DealStage) => void;
}) {
  const t = useTranslations('deals');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
          aria-label={t('card.move', { name: deal.name })}
        >
          <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {DEAL_STAGES.filter((stage) => stage !== deal.stage).map((stage) => (
          <DropdownMenuItem key={stage} onSelect={() => onMove(deal, stage)}>
            {t('card.moveTo', { stage: t(`stages.${stage}`) })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
