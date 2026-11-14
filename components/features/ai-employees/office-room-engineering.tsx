'use client';

import { isImeKey } from '@/components/ui/ime';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import type { DealCard } from '@/lib/features/deals/service';
import { BOARD_DEALS_LIMIT } from '@/lib/features/deals/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { CAP, FOCUS, KEY, PANEL } from './office-hud';
import type { RoomKeys } from './office-lead-file';
import { OfficePrepFile } from './office-prep-file';
import {
  ROOM_BOARD,
  ROOM_FRAME,
  RoomChoiceButton,
  RoomGuideHeader,
  RoomGuideLine,
} from './office-room-parts';
import { nextRow, roomGuide } from './office-rooms';
import {
  SURVEY_BOARD_FIRST_VIEW,
  SURVEY_BOARD_PAGE,
  SURVEY_BOARD_PAGE_SIZE,
  SURVEY_BOARD_VIEWS,
  type SurveyBoardView,
  daysInStage,
  surveyBoardInput,
  surveyBoardPages,
  surveyPageRows,
  surveyReport,
  surveyRows,
  surveyViewOfKey,
} from './rooms/survey-board';

/**
 * The engineering room of the full-screen office (#1194): the surveys of customers' current
 * systems as the room's wall board, and the room's figures read out next to the AI engineer.
 *
 * The board reads `deals.board` once (the API scopes it to the organization and checks the
 * permission); the views and the pages are cut from that answer. The figures are the board's own
 * counts: an AI employee that is in training, paused or not hired is shown as such and reports
 * nothing of its own. The president switches the view with the choices (number keys), moves over
 * the rows with the arrow keys and opens one with Enter: the preparation file of its lead opens
 * inside the room (office-prep-file.tsx). Nothing is changed from this room.
 */
export function OfficeRoomEngineering({
  organizationId,
  role,
  status,
  employeeName,
  look,
  keysRef,
  onOpenNormal,
  onFileOpenChange,
}: {
  organizationId: string;
  role: AiEmployeeRole;
  status: DeskStatus;
  /** The name of the AI employee of the room; null while the seat is vacant */
  employeeName: string | null;
  /** How the employee was customized (#1134) */
  look?: RobotLook;
  /** Filled with the room's key handler while the room is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  /** A page of the normal view is opened: the office closes */
  onOpenNormal: () => void;
  /** Told when a file opens or closes: while one is open, Esc closes it, not the room */
  onFileOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.room');
  const tRoom = useTranslations('aiOffice.immersive.room.engineering');
  const tLeads = useTranslations('aiOffice.immersive.room.leads');
  const tOffice = useTranslations('aiOffice');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tStages = useTranslations('deals.stages');
  const tTasks = useTranslations('leadFollowUp.tasks');
  const locale = useLocale();
  const boardRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<SurveyBoardView>(SURVEY_BOARD_FIRST_VIEW);
  const [page, setPage] = useState(1);
  // The deal whose preparation file is open on the room's table, and the row to go back to
  const [open, setOpen] = useState<DealCard | null>(null);
  const fileKeys = useRef<RoomKeys | null>(null);
  const lastOpened = useRef<string | null>(null);
  // "Days in the stage" are counted from when the room opened
  const [now] = useState(() => new Date());

  const board = trpc.deals.board.useQuery(surveyBoardInput(organizationId));
  const forbidden = board.error?.data?.code === 'FORBIDDEN';
  const columns = board.data?.columns ?? [];
  const rows = surveyRows(columns, view);
  const pages = surveyBoardPages(rows.length);
  const shownPage = Math.min(page, pages);
  const items = surveyPageRows(rows, shownPage);
  const report = surveyReport(columns);
  const guide = roomGuide(status);
  const roleTitle = tOffice(`roles.${role}.title`);
  const viewName = (option: SurveyBoardView) =>
    option === 'open' ? tRoom('views.open') : tStages(option);

  const choose = (next: SurveyBoardView) => {
    setView(next);
    setPage(1);
  };
  const turn = (delta: 1 | -1) =>
    setPage((current) => Math.max(1, Math.min(pages, Math.min(current, pages) + delta)));

  const openFile = (deal: DealCard) => {
    lastOpened.current = deal.id;
    setOpen(deal);
  };
  const fileOpen = open !== null;
  useEffect(() => {
    onFileOpenChange(fileOpen);
    return () => onFileOpenChange(false);
  }, [fileOpen, onFileOpenChange]);
  // Closing the file gives the focus back to the row it was opened from
  useEffect(() => {
    if (open || !lastOpened.current) return;
    boardRef.current?.querySelector<HTMLElement>(`[data-deal-id="${lastOpened.current}"]`)?.focus();
    lastOpened.current = null;
  }, [open]);

  // The room's keys: numbers choose the view, the arrows move over the rows and the pages.
  // Enter opens the focused row by itself (the rows are buttons). While a file is open, the keys
  // are the file's, and Esc closes it instead of leaving the room.
  const onRoomKey: RoomKeys = (event) => {
    // A key of a Japanese conversion (IME) is never an answer: it belongs to what is being typed
    if (isImeKey(event)) return false;
    if (open) {
      if (event.key === 'Escape') {
        setOpen(null);
        return true;
      }
      return fileKeys.current?.(event) ?? false;
    }
    const chosen = surveyViewOfKey(event.key);
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
  // The office calls the handler of the latest render
  const latestKeys = useRef(onRoomKey);
  latestKeys.current = onRoomKey;
  useEffect(() => {
    keysRef.current = (event) => latestKeys.current(event);
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);

  const from = rows.length === 0 ? 0 : (shownPage - 1) * SURVEY_BOARD_PAGE_SIZE + 1;
  const to = Math.min(rows.length, shownPage * SURVEY_BOARD_PAGE_SIZE);

  const header = (
    <RoomGuideHeader role={role} status={status} employeeName={employeeName} look={look} />
  );
  const guideLine = (
    <RoomGuideLine>
      {t(`guide.${guide}`, { name: employeeName ?? roleTitle, role: roleTitle })}
    </RoomGuideLine>
  );

  if (open) {
    return (
      <OfficePrepFile
        organizationId={organizationId}
        deal={open}
        header={header}
        guide={guideLine}
        keysRef={fileKeys}
        onClose={() => setOpen(null)}
        onOpenNormal={onOpenNormal}
      />
    );
  }

  return (
    <div className={ROOM_FRAME}>
      {/* Whose room this is, the room's figures, and what the president asks for */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        {header}
        {/* The report takes the focus when the room opens: Enter pressed once too often does nothing */}
        <div tabIndex={-1} data-autofocus="" className="space-y-2 outline-none">
          {guideLine}
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {board.isError
              ? tRoom('reportUnavailable')
              : !board.data
                ? tRoom('reportLoading')
                : report.open === 0
                  ? tRoom('reportEmpty')
                  : tRoom('report', { ...report })}
          </p>
        </div>
        <h3 className={CAP}>{tImmersive('talk.you')}</h3>
        <ul className="space-y-2">
          {SURVEY_BOARD_VIEWS.map((option, index) => (
            <li key={option}>
              <RoomChoiceButton
                keyCap={String(index + 1)}
                main={option === view}
                pressed={option === view}
                onClick={() => choose(option)}
              >
                {tRoom(`ask.${option}`)}
              </RoomChoiceButton>
            </li>
          ))}
        </ul>
      </div>

      {/* The wall board of the room */}
      <section
        ref={boardRef}
        aria-label={tRoom('board')}
        aria-busy={board.isFetching}
        className={ROOM_BOARD}
      >
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <div className="flex items-baseline gap-4">
            <h2 className="text-xl font-bold">{tRoom('board')}</h2>
            {/* Read out when the view changes: the board answers the choice on the left */}
            <output className="block text-sm text-[#d8d2c4]">
              {viewName(view)}
              {board.data && `・${tLeads('count', { count: rows.length })}`}
            </output>
          </div>
          <p className="flex items-center gap-2 text-xs text-[#d8d2c4]">
            <span className={KEY}>↑</span>
            <span className={KEY}>↓</span>
            {tLeads('keys.rows')}
            <span className={cn(KEY, 'ml-2')}>Enter</span>
            {tLeads('keys.open')}
          </p>
        </header>

        {forbidden ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tRoom('forbidden')}
          </p>
        ) : board.isError ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tRoom('error')}
          </p>
        ) : !board.data ? (
          <output className="m-auto flex items-center gap-3 text-sm text-[#d8d2c4]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {tLeads('loading')}
          </output>
        ) : items.length === 0 ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tRoom('empty')}
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
              <span>{tRoom('columns.deal')}</span>
              <span>{tRoom('columns.stage')}</span>
              <span>{tRoom('columns.nextAction')}</span>
              <span className="hidden md:block">{tRoom('columns.owner')}</span>
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
                      <span className="truncate font-bold">
                        {deal.company || tLeads('noCompany')}
                      </span>
                      <span className="truncate text-[#d8d2c4]">{deal.name}</span>
                    </span>
                    <span className="flex flex-col">
                      <span className="font-bold">{tStages(deal.stage)}</span>
                      <span className="text-xs text-[#d8d2c4] tabular-nums">
                        {tRoom('daysInStage', { days: daysInStage(deal.stageChangedAt, now) })}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-col">
                      {deal.nextTask ? (
                        <>
                          <span className="truncate">
                            {deal.nextTask.title ?? tTasks('nextMeetingTitle')}
                          </span>
                          <span className="text-xs text-[#d8d2c4] tabular-nums">
                            {tRoom('due', { date: deal.nextTask.dueOn.replaceAll('-', '/') })}
                          </span>
                        </>
                      ) : (
                        <span className="text-[#e9cf9a]">{tRoom('noTask')}</span>
                      )}
                    </span>
                    <span className="hidden truncate md:block">
                      {deal.ownerName ?? tLeads('unassigned')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
          <p>
            {board.data && rows.length > 0 && tLeads('range', { total: rows.length, from, to })}
            <span className="ml-3 text-xs">
              {board.data?.truncated
                ? tRoom('truncated', { limit: BOARD_DEALS_LIMIT })
                : tRoom('openHint')}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Link
              href={`/${locale}${SURVEY_BOARD_PAGE}`}
              onClick={onOpenNormal}
              className={cn('mr-2 underline underline-offset-4 hover:text-white', FOCUS)}
            >
              {tRoom('openList')}
            </Link>
            <button
              type="button"
              onClick={() => turn(-1)}
              aria-disabled={shownPage <= 1}
              className={cn(PAGE_BUTTON, FOCUS)}
            >
              <span aria-hidden="true" className={KEY}>
                ←
              </span>
              {tLeads('prev')}
            </button>
            <span className="tabular-nums" aria-live="polite">
              {tLeads('page', { page: shownPage, pages })}
            </span>
            <button
              type="button"
              onClick={() => turn(1)}
              aria-disabled={shownPage >= pages}
              className={cn(PAGE_BUTTON, FOCUS)}
            >
              {tLeads('next')}
              <span aria-hidden="true" className={KEY}>
                →
              </span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

/** The columns of the board: deal, stage, next action, and from a tablet on, the owner */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1.4fr)_7.5rem_minmax(0,1fr)] items-center gap-4 px-5 md:grid-cols-[minmax(0,1.4fr)_7.5rem_minmax(0,1fr)_minmax(0,0.7fr)]';

// A page button at the end of the board stays focusable (aria-disabled): a disabled button
// would drop the focus, and the keys of the room with it
const PAGE_BUTTON =
  'inline-flex min-h-11 items-center gap-1 border border-[#f5f1e8]/35 px-3 text-sm font-bold text-[#f5f1e8] hover:bg-[#f5f1e8]/10 aria-disabled:cursor-not-allowed aria-disabled:border-[#f5f1e8]/15 aria-disabled:text-[#f5f1e8]/40 aria-disabled:hover:bg-transparent';
