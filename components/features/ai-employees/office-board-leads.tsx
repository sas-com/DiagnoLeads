'use client';

import {
  DEFAULT_LEAD_SORT,
  type LeadListFilters,
  leadListHref,
} from '@/lib/features/leads/list-query';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, useEffect, useRef } from 'react';
import { FOCUS, KEY } from './office-hud';
import { type BoardLead, LEAD_STATUS_COLORS } from './office-lead-file';
import { leadBoardInputFor } from './office-marketing';
import type { RoomKeyEvent, RoomKeys } from './office-room-contract';
import { ROOM_BOARD, RoomBoardLoading, RoomBoardMessage } from './office-room-parts';
import { LEAD_BOARD_PAGE_SIZE, leadBoardPages, nextRow } from './office-rooms';
import { useRoomKeys } from './use-room-keys';

/**
 * Moves the focus over the rows of a board with the up and down arrows: from no row, down goes to
 * the first and up to the last. At either end (and on a board without rows) the focus stays and
 * the key is not used: it goes back to the browser, which scrolls the board with it, so what lies
 * under the last row can be reached by keyboard (#1214). True when the key was used.
 */
export function focusNextRow(
  board: HTMLElement | null,
  selector: string,
  event: RoomKeyEvent
): boolean {
  const rows = Array.from(board?.querySelectorAll<HTMLElement>(selector) ?? []);
  const current = rows.indexOf(document.activeElement as HTMLElement);
  const next = nextRow(current, event.key === 'ArrowDown' ? 1 : -1, rows.length);
  if (next === current) return false;
  event.preventDefault();
  rows[next].focus();
  return true;
}

/** How many of the two marks an MQL level fills (対象外 and no diagnosis fill none) */
const MQL_MARKS: Record<string, number> = { interest: 2, fit: 1 };

/**
 * The lead board of the marketing room (#1127): a part of the lead list on the room's wall.
 *
 * The board reads `leads.list` (the API scopes it to the organization and checks the permission).
 * The room chooses what the board shows (a view of the list, or the prospects of one source,
 * #1202) and keeps the page (the board gives way to a customer file and comes back); the board
 * moves over the rows with the arrow keys, turns the pages, and hands the row that is opened to
 * the room.
 */
export function OfficeBoardLeads({
  organizationId,
  filters,
  label,
  page,
  keepRows,
  back,
  keysRef,
  focusLeadRef,
  onTurn,
  onOpen,
  onLeave,
}: {
  organizationId: string;
  /** What the board shows: filters of the lead list, fixed while the room is open */
  filters: LeadListFilters;
  /** The name of what the board shows, said next to its title */
  label: string;
  page: number;
  /** A page of these filters was turned: the rows before stay until the next ones arrive */
  keepRows: boolean;
  /** The board was opened from another one: the way back to it (the room's Esc does the same) */
  back?: { label: string; onBack: () => void };
  /** Filled with the board's key handler while the board is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  /** The lead whose row takes the focus when the board comes back from its file */
  focusLeadRef: MutableRefObject<string | null>;
  onTurn: (page: number) => void;
  onOpen: (lead: BoardLead) => void;
  /** The list is opened in the normal view: the office closes */
  onLeave: () => void;
}) {
  const t = useTranslations('aiOffice.immersive.room.leads');
  const tStatus = useTranslations('status');
  const tLevels = useTranslations('leadActivity.summary.mqlLevels');
  const tLead = useTranslations('leads');
  const format = useFormatter();
  const locale = useLocale();
  const boardRef = useRef<HTMLElement>(null);

  // Turning a page keeps the rows of the page before until the next ones arrive; another view
  // never shows the rows or the count of the one before under its own name
  const list = trpc.leads.list.useQuery(leadBoardInputFor(filters, page, organizationId), {
    placeholderData: (previous) => (keepRows ? previous : undefined),
  });
  const turning = list.isPlaceholderData === true;
  const forbidden = list.error?.data?.code === 'FORBIDDEN';
  const items: BoardLead[] = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = leadBoardPages(total);
  const from = total === 0 ? 0 : (page - 1) * LEAD_BOARD_PAGE_SIZE + 1;
  const to = Math.min(total, page * LEAD_BOARD_PAGE_SIZE);

  const turn = (delta: 1 | -1) => onTurn(Math.max(1, Math.min(pages, page + delta)));

  // Coming back from a file gives the focus back to the row it was opened from
  useEffect(() => {
    if (!focusLeadRef.current) return;
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-lead-id="${focusLeadRef.current}"]`)
      ?.focus();
    focusLeadRef.current = null;
  }, [focusLeadRef]);

  // The board's keys: the arrows move over the rows and the pages. Enter opens the focused row
  // by itself (the rows are buttons).
  useRoomKeys(keysRef, (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      return focusNextRow(boardRef.current, '[data-lead-row]', event);
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      turn(event.key === 'ArrowRight' ? 1 : -1);
      return true;
    }
    return false;
  });

  return (
    <section
      ref={boardRef}
      aria-label={t('board')}
      aria-busy={list.isFetching}
      className={ROOM_BOARD}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
        <div className="flex items-baseline gap-4">
          <h2 className="text-xl font-bold">{t('board')}</h2>
          {/* Read out when the view changes: the board answers the choice on the left */}
          <output className="block text-sm text-[#d8d2c4]">
            {label}
            {list.data && !turning && `・${t('count', { count: total })}`}
          </output>
        </div>
        {back && (
          <button
            type="button"
            onClick={back.onBack}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 text-sm font-bold hover:text-white',
              FOCUS
            )}
          >
            <span aria-hidden="true" className={KEY}>
              Esc
            </span>
            {back.label}
          </button>
        )}
        <p className="flex items-center gap-2 text-xs text-[#d8d2c4]">
          <span className={KEY}>↑</span>
          <span className={KEY}>↓</span>
          {t('keys.rows')}
          <span className={cn(KEY, 'ml-2')}>Enter</span>
          {t('keys.open')}
        </p>
      </header>

      {forbidden ? (
        <RoomBoardMessage>{t('forbidden')}</RoomBoardMessage>
      ) : list.isError ? (
        <RoomBoardMessage>{t('error')}</RoomBoardMessage>
      ) : !list.data ? (
        <RoomBoardLoading>{t('loading')}</RoomBoardLoading>
      ) : items.length === 0 ? (
        <RoomBoardMessage>{t('empty')}</RoomBoardMessage>
      ) : (
        <div className={cn('min-h-0 flex-1 overflow-y-auto', turning && 'opacity-60')}>
          <div
            aria-hidden="true"
            className={cn(ROW_GRID, 'min-h-9 border-b border-[#f5f1e8]/15 text-xs text-[#bdb7a9]')}
          >
            <span>{t('columns.lead')}</span>
            <span>{t('columns.mql')}</span>
            <span>{t('columns.status')}</span>
            <span className="hidden md:block">{t('columns.assignee')}</span>
            <span className="hidden md:block">{t('columns.created')}</span>
          </div>
          <ul>
            {items.map((lead) => {
              const marks = MQL_MARKS[lead.mqlLevel ?? ''] ?? 0;
              return (
                <li key={lead.id}>
                  <button
                    type="button"
                    data-lead-row=""
                    data-lead-id={lead.id}
                    onClick={() => onOpen(lead)}
                    className={cn(
                      ROW_GRID,
                      'min-h-[3.5rem] w-full border-b border-[#f5f1e8]/10 text-left text-sm hover:bg-[#f5f1e8]/5 focus-visible:bg-[#e9cf9a]/15 focus-visible:shadow-[inset_3px_0_0_#e9cf9a]',
                      FOCUS
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-bold">{lead.company || t('noCompany')}</span>
                      <span className="truncate text-[#d8d2c4]">
                        {lead.name || tLead('nameNotSet')}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="flex gap-1">
                        {[0, 1].map((mark) => (
                          <span
                            key={mark}
                            className={cn(
                              'h-2.5 w-2.5 rotate-45 border border-[#e9cf9a]',
                              mark < marks && 'bg-[#e9cf9a]'
                            )}
                          />
                        ))}
                      </span>
                      <span className="text-xs">
                        {lead.mqlLevel ? tLevels(lead.mqlLevel) : t('noLevel')}
                      </span>
                    </span>
                    <span>
                      <span
                        style={{
                          color: LEAD_STATUS_COLORS[lead.status],
                          borderColor: 'currentColor',
                        }}
                        className="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold"
                      >
                        {lead.status in LEAD_STATUS_COLORS
                          ? tStatus(lead.status as 'new')
                          : lead.status}
                      </span>
                    </span>
                    <span className="hidden truncate md:block">
                      {lead.assignee?.name ?? t('unassigned')}
                    </span>
                    <span className="hidden tabular-nums md:block">
                      {format.dateTime(new Date(lead.createdAt), {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
        <p>
          {list.data && !turning && total > 0 && t('range', { total, from, to })}
          <span className="ml-3 text-xs">{t('openHint')}</span>
        </p>
        <div className="flex items-center gap-2">
          <Link
            href={`/${locale}${leadListHref(filters, DEFAULT_LEAD_SORT)}`}
            onClick={onLeave}
            className={cn('mr-2 underline underline-offset-4 hover:text-white', FOCUS)}
          >
            {t('openList')}
          </Link>
          <button
            type="button"
            onClick={() => turn(-1)}
            aria-disabled={page <= 1}
            className={cn(PAGE_BUTTON, FOCUS)}
          >
            <span aria-hidden="true" className={KEY}>
              ←
            </span>
            {t('prev')}
          </button>
          <span className="tabular-nums" aria-live="polite">
            {t('page', { page, pages })}
          </span>
          <button
            type="button"
            onClick={() => turn(1)}
            aria-disabled={page >= pages}
            className={cn(PAGE_BUTTON, FOCUS)}
          >
            {t('next')}
            <span aria-hidden="true" className={KEY}>
              →
            </span>
          </button>
        </div>
      </footer>
    </section>
  );
}

/** The columns of the board: lead, MQL level, status, and from a tablet on, assignee and day */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1.6fr)_9.5rem_7rem] items-center gap-4 px-5 md:grid-cols-[minmax(0,1.6fr)_9.5rem_7rem_minmax(0,0.8fr)_6.5rem]';

// A page button at the end of the board stays focusable (aria-disabled): a disabled button
// would drop the focus, and the keys of the room with it
const PAGE_BUTTON =
  'inline-flex min-h-11 items-center gap-1 border border-[#f5f1e8]/35 px-3 text-sm font-bold text-[#f5f1e8] hover:bg-[#f5f1e8]/10 aria-disabled:cursor-not-allowed aria-disabled:border-[#f5f1e8]/15 aria-disabled:text-[#f5f1e8]/40 aria-disabled:hover:bg-transparent';
