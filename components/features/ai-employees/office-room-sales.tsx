'use client';

import {
  formatDealDate,
  formatYen,
  formatYenCompact,
} from '@/components/features/deals/deal-format';
import { isImeKey } from '@/components/ui/ime';
import { BOARD_DEALS_LIMIT } from '@/lib/features/deals/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { DEAL_STAGE_COLORS, OfficeDealFile } from './office-deal-file';
import { CAP, FOCUS, KEY, PANEL } from './office-hud';
import type { OfficeRoomProps, RoomKeys } from './office-room-contract';
import {
  ROOM_BOARD,
  ROOM_FRAME,
  RoomChoiceButton,
  RoomGuideHeader,
  RoomGuideLine,
} from './office-room-parts';
import { nextRow, roomGuide } from './office-rooms';
import {
  type BoardDeal,
  DEAL_BOARD_FIRST_VIEW,
  DEAL_BOARD_PAGE_SIZE,
  DEAL_BOARD_VIEWS,
  type DealBoardView,
  closesThisWeek,
  dealBoardInput,
  dealBoardOwner,
  dealBoardPage,
  dealBoardPages,
  dealBoardViewOfKey,
  dealReport,
  dealsOfView,
  openDeals,
  stageTotals,
} from './rooms/deals-board';
import { useRoomKeys } from './use-room-keys';

/** The pages of the normal view the room leads to: fixed paths of this app */
const NORMAL_PAGES = { deals: '/deals', forecast: '/forecast', prospects: '/prospects' } as const;

/**
 * The sales floor of the full-screen office (#1171): the open deals as the room's wall board, and
 * the room's figures read out next to the AI employee the room belongs to.
 *
 * The board reads `deals.board` (the API scopes it to the organization and checks the permission)
 * and adds no API of its own. The figures are counted from that board, nothing else: an AI
 * employee that is in training, paused or not hired is shown as such and reports nothing of its
 * own. The president switches the view with the choices (number keys), moves over the rows with
 * the arrow keys and opens a deal with Enter: its file opens inside the room (office-deal-file.tsx),
 * where the deal is moved and its next action is settled. Winning, losing, the forecast and the
 * customer search stay in the normal view, a link away.
 */
export function OfficeRoomSales({
  organizationId,
  guide: employee,
  keysRef,
  onLeaveOffice,
  onFileOpenChange,
}: OfficeRoomProps) {
  const t = useTranslations('aiOffice.immersive.room');
  const tDealsRoom = useTranslations('aiOffice.immersive.room.deals');
  const tOffice = useTranslations('aiOffice');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tDeals = useTranslations('deals');
  const tTasks = useTranslations('leadFollowUp.tasks');
  const locale = useLocale();
  const boardRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<DealBoardView>(DEAL_BOARD_FIRST_VIEW);
  const [page, setPage] = useState(1);
  // The deal whose file is open on the room's table (as it was when opened), and the row to go
  // back to
  const [open, setOpen] = useState<BoardDeal | null>(null);
  const fileKeys = useRef<RoomKeys | null>(null);
  const lastOpened = useRef<string | null>(null);

  // Everyone's deals carry the room's figures; the user's own are read once they are asked for
  const everyone = trpc.deals.board.useQuery(dealBoardInput('all', organizationId));
  const own = trpc.deals.board.useQuery(dealBoardInput('mine', organizationId), {
    enabled: view === 'mine',
  });
  const board = dealBoardOwner(view) === 'mine' ? own : everyone;

  const forbidden =
    everyone.error?.data?.code === 'FORBIDDEN' || board.error?.data?.code === 'FORBIDDEN';
  const today = board.data?.today ?? everyone.data?.today ?? '';
  const rows = board.data ? dealsOfView(view, board.data.columns, today) : [];
  const total = rows.length;
  const pages = dealBoardPages(total);
  // A page that emptied (a deal left the view) falls back to the last one that holds rows
  const shownPage = Math.min(page, pages);
  const items = dealBoardPage(rows, shownPage);
  const report = everyone.data ? dealReport(everyone.data.columns, everyone.data.today) : null;
  const canEdit = everyone.data?.canEdit === true;
  const truncated = board.data?.truncated === true;

  const choose = (next: DealBoardView) => {
    setView(next);
    setPage(1);
  };
  const turn = (delta: 1 | -1) => setPage(Math.max(1, Math.min(pages, shownPage + delta)));

  const openFile = (deal: BoardDeal) => {
    lastOpened.current = deal.id;
    setOpen(deal);
  };
  // The file shows the deal as the boards hold it now, so it follows the answers given in it
  const opened =
    open === null
      ? null
      : ([...(everyone.data?.columns ?? []), ...(own.data?.columns ?? [])]
          .flatMap((column) => column.deals)
          .find((deal) => deal.id === open.id) ?? null);
  // A deal the boards no longer hold (deleted, closed elsewhere) is shown as it was when opened,
  // and takes no answers: its stage may be another by now
  const shown = opened ?? open;
  const fileOpen = open !== null;
  useEffect(() => {
    onFileOpenChange(fileOpen);
    return () => onFileOpenChange(false);
  }, [fileOpen, onFileOpenChange]);
  // Closing the file gives the focus back to the row it was opened from; when the deal left the
  // view meanwhile, to the board's report
  useEffect(() => {
    if (open || !lastOpened.current) return;
    const row = boardRef.current?.querySelector<HTMLElement>(
      `[data-deal-id="${lastOpened.current}"]`
    );
    (row ?? document.querySelector<HTMLElement>('[data-room-report]'))?.focus();
    lastOpened.current = null;
  }, [open]);

  // The room's keys: numbers choose the view, the arrows move over the rows and the pages.
  // Enter opens the focused row by itself (the rows are buttons). While a file is open, the keys
  // are the file's first (a question open in it takes Esc), then Esc closes the file instead of
  // leaving the room.
  const onRoomKey: RoomKeys = (event) => {
    // A key of a Japanese conversion (IME) is never an answer: it belongs to what is being typed
    if (isImeKey(event)) return false;
    if (open) {
      if (fileKeys.current?.(event)) return true;
      if (event.key !== 'Escape') return false;
      setOpen(null);
      return true;
    }
    const chosen = dealBoardViewOfKey(event.key);
    if (chosen) {
      event.preventDefault();
      choose(chosen);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const buttons = Array.from(
        boardRef.current?.querySelectorAll<HTMLElement>('[data-deal-row]') ?? []
      );
      const current = buttons.indexOf(document.activeElement as HTMLElement);
      const target = buttons[nextRow(current, event.key === 'ArrowDown' ? 1 : -1, buttons.length)];
      if (target) {
        event.preventDefault();
        target.focus();
      }
      return true;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      turn(event.key === 'ArrowRight' ? 1 : -1);
      return true;
    }
    return false;
  };
  useRoomKeys(keysRef, onRoomKey);

  const header = employee && (
    <RoomGuideHeader
      role={employee.role}
      status={employee.status}
      employeeName={employee.name}
      look={employee.look}
    />
  );
  const roleTitle = employee ? tOffice(`roles.${employee.role}.title`) : '';
  const guideLine = employee && (
    <RoomGuideLine>
      {t(`guide.${roomGuide(employee.status)}`, {
        name: employee.name ?? roleTitle,
        role: roleTitle,
      })}
    </RoomGuideLine>
  );

  if (shown) {
    return (
      <OfficeDealFile
        // A fresh file for each deal: an answer given over one never carries over
        key={shown.id}
        organizationId={organizationId}
        deal={shown}
        today={today}
        canEdit={canEdit && (opened !== null || !everyone.data)}
        header={header}
        guide={guideLine}
        keysRef={fileKeys}
        onClose={() => setOpen(null)}
        onLeaveOffice={onLeaveOffice}
      />
    );
  }

  const from = total === 0 ? 0 : (shownPage - 1) * DEAL_BOARD_PAGE_SIZE + 1;
  const to = Math.min(total, shownPage * DEAL_BOARD_PAGE_SIZE);
  const taskTitle = (deal: BoardDeal) => deal.nextTask?.title ?? tTasks('nextMeetingTitle');

  return (
    <div className={ROOM_FRAME}>
      {/* Whose room this is, the room's figures, and what the president asks for */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        {header}
        {/* The report takes the focus when the room opens: Enter pressed once too often does nothing */}
        <div tabIndex={-1} data-autofocus="" data-room-report="" className="space-y-2 outline-none">
          {guideLine}
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {forbidden || everyone.isError
              ? tDealsRoom('reportUnavailable')
              : !report
                ? tDealsRoom('reportLoading')
                : report.open === 0
                  ? tDealsRoom('reportNone')
                  : tDealsRoom(everyone.data?.truncated ? 'reportTruncated' : 'report', {
                      open: report.open,
                      amount: formatYen(report.amount, locale) ?? '',
                      thisWeek: report.thisWeek,
                      noNextAction: report.noNextAction,
                    })}
          </p>
        </div>
        <h3 className={CAP}>{tImmersive('talk.you')}</h3>
        <ul className="space-y-2">
          {DEAL_BOARD_VIEWS.map((option, index) => (
            <li key={option}>
              <RoomChoiceButton
                keyCap={String(index + 1)}
                main={option === view}
                pressed={option === view}
                onClick={() => choose(option)}
              >
                {tDealsRoom(`ask.${option}`)}
              </RoomChoiceButton>
            </li>
          ))}
        </ul>
      </div>

      {/* The wall board of the room */}
      <section
        ref={boardRef}
        aria-label={tDealsRoom('board')}
        aria-busy={board.isFetching}
        className={ROOM_BOARD}
      >
        <header className="space-y-3 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <div className="flex items-baseline gap-4">
              <h2 className="text-xl font-bold">{tDealsRoom('board')}</h2>
              {/* Read out when the view changes: the board answers the choice on the left */}
              <output className="block text-sm text-[#d8d2c4]">
                {tDealsRoom(`views.${view}`)}
                {board.data && `・${tDealsRoom('count', { count: total })}`}
              </output>
            </div>
            <p className="flex items-center gap-2 text-xs text-[#d8d2c4]">
              <span className={KEY}>↑</span>
              <span className={KEY}>↓</span>
              {tDealsRoom('keys.rows')}
              <span className={cn(KEY, 'ml-2')}>Enter</span>
              {tDealsRoom('keys.open')}
            </p>
          </div>
          {/* The open stages of the board that is shown, with what each holds: all the open
              deals (or all the user's own), not only those of the view */}
          {board.data && (
            <p className="text-xs text-[#d8d2c4]">{tDealsRoom(`stages.${dealBoardOwner(view)}`)}</p>
          )}
          {board.data && (
            <ul
              aria-label={tDealsRoom(`stages.${dealBoardOwner(view)}`)}
              className="grid grid-cols-2 gap-2 md:grid-cols-4"
            >
              {stageTotals(board.data.columns).map((stage) => (
                <li
                  key={stage.stage}
                  style={{ borderTopColor: DEAL_STAGE_COLORS[stage.stage] }}
                  className="flex flex-wrap items-baseline gap-x-2 border border-t-2 border-[#f5f1e8]/20 px-3 py-1 text-sm"
                >
                  <span className="font-bold">{tDeals(`stages.${stage.stage}`)}</span>
                  <span className="text-xs text-[#d8d2c4] tabular-nums">
                    {tDealsRoom('count', { count: stage.count })}・
                    {formatYenCompact(stage.amount, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </header>

        {forbidden ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tDealsRoom('forbidden')}
          </p>
        ) : board.isError ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tDealsRoom('error')}
          </p>
        ) : !board.data ? (
          <output className="m-auto flex items-center gap-3 text-sm text-[#d8d2c4]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {tDealsRoom('loading')}
          </output>
        ) : items.length === 0 ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tDealsRoom(`empty.${view}`)}
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              aria-hidden="true"
              className={cn(
                ROW_GRID,
                'min-h-9 border-b border-[#f5f1e8]/15 text-xs text-[#bdb7a9]'
              )}
            >
              <span>{tDealsRoom('columns.deal')}</span>
              <span>{tDealsRoom('columns.stage')}</span>
              <span>{tDealsRoom('columns.nextAction')}</span>
              <span className="hidden md:block">{tDealsRoom('columns.amount')}</span>
              <span className="hidden md:block">{tDealsRoom('columns.owner')}</span>
            </div>
            <ul>
              {items.map((deal) => (
                <li key={deal.id}>
                  <button
                    type="button"
                    data-deal-row=""
                    data-deal-id={deal.id}
                    onClick={() => openFile(deal)}
                    className={cn(
                      ROW_GRID,
                      'min-h-[3.5rem] w-full border-b border-[#f5f1e8]/10 text-left text-sm hover:bg-[#f5f1e8]/5 focus-visible:bg-[#e9cf9a]/15 focus-visible:shadow-[inset_3px_0_0_#e9cf9a]',
                      FOCUS
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-bold">{deal.name}</span>
                      <span className="truncate text-[#d8d2c4]">
                        {deal.company || deal.leadName || tDealsRoom('noLead')}
                      </span>
                    </span>
                    <span>
                      <span
                        style={{
                          color: DEAL_STAGE_COLORS[deal.stage as keyof typeof DEAL_STAGE_COLORS],
                          borderColor: 'currentColor',
                        }}
                        className="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold"
                      >
                        {tDeals(`stages.${deal.stage}`)}
                      </span>
                      {/* On a narrow board the amount has no column of its own */}
                      <span className="mt-1 block text-xs text-[#d8d2c4] tabular-nums md:hidden">
                        {formatYen(deal.amount, locale) ?? tDealsRoom('noAmount')}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-col">
                      {deal.nextTask ? (
                        <>
                          <span className="tabular-nums">
                            {formatDealDate(deal.nextTask.dueOn)}
                            {deal.nextTask.dueOn < today && (
                              <span className="ml-2 font-bold text-[#fca5a5]">
                                {tDealsRoom('late')}
                              </span>
                            )}
                          </span>
                          <span className="truncate text-[#d8d2c4]">{taskTitle(deal)}</span>
                        </>
                      ) : (
                        <span className="font-bold text-[#fcd34d]">
                          {tDealsRoom('noNextAction')}
                        </span>
                      )}
                      {/* Why a deal without a near next action has to move this week */}
                      {deal.expectedCloseOn && closesThisWeek(deal, today) && (
                        <span className="text-[#d8d2c4] tabular-nums">
                          {tDealsRoom('closesOn', { date: formatDealDate(deal.expectedCloseOn) })}
                          {deal.expectedCloseOn < today && (
                            <span className="ml-2 font-bold text-[#fca5a5]">
                              {tDealsRoom('closeLate')}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="hidden tabular-nums md:block">
                      {formatYen(deal.amount, locale) ?? tDealsRoom('noAmount')}
                    </span>
                    <span className="hidden truncate md:block">
                      {deal.ownerName ?? tDealsRoom('unassigned')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="space-y-2 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              {board.data && total > 0 && tDealsRoom('range', { total, from, to })}
              <span className="ml-3 text-xs">{tDealsRoom('openHint')}</span>
            </p>
            {/* What the room does not hold yet: a page of the normal view, a link away */}
            <nav aria-label={tDealsRoom('normalPages')} className="flex flex-wrap gap-x-4">
              {(Object.keys(NORMAL_PAGES) as (keyof typeof NORMAL_PAGES)[]).map((entry) => (
                <Link
                  key={entry}
                  href={`/${locale}${NORMAL_PAGES[entry]}`}
                  onClick={onLeaveOffice}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-white',
                    FOCUS
                  )}
                >
                  {tDealsRoom(`open.${entry}`)}
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => turn(-1)}
                aria-disabled={shownPage <= 1}
                className={cn(PAGE_BUTTON, FOCUS)}
              >
                <span aria-hidden="true" className={KEY}>
                  ←
                </span>
                {tDealsRoom('prev')}
              </button>
              <span className="tabular-nums" aria-live="polite">
                {tDealsRoom('page', { page: shownPage, pages })}
              </span>
              <button
                type="button"
                onClick={() => turn(1)}
                aria-disabled={shownPage >= pages}
                className={cn(PAGE_BUTTON, FOCUS)}
              >
                {tDealsRoom('next')}
                <span aria-hidden="true" className={KEY}>
                  →
                </span>
              </button>
            </div>
          </div>
          {truncated && (
            <p className="text-xs">{tDealsRoom('truncated', { limit: BOARD_DEALS_LIMIT })}</p>
          )}
        </footer>
      </section>
    </div>
  );
}

/** The columns of the board: deal, stage, next action, and from a tablet on, amount and owner */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)] items-center gap-4 px-5 md:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1.1fr)_7.5rem_minmax(0,0.7fr)]';

// A page button at the end of the board stays focusable (aria-disabled): a disabled button
// would drop the focus, and the keys of the room with it
const PAGE_BUTTON =
  'inline-flex min-h-11 items-center gap-1 border border-[#f5f1e8]/35 px-3 text-sm font-bold text-[#f5f1e8] hover:bg-[#f5f1e8]/10 aria-disabled:cursor-not-allowed aria-disabled:border-[#f5f1e8]/15 aria-disabled:text-[#f5f1e8]/40 aria-disabled:hover:bg-transparent';
