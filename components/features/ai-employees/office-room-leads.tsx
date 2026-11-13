'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { DEFAULT_LEAD_SORT, leadListHref } from '@/lib/features/leads/list-query';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { CAP, FOCUS, KEY, PANEL } from './office-hud';
import {
  type BoardLead,
  LEAD_STATUS_COLORS,
  OfficeLeadFile,
  type RoomKeys,
} from './office-lead-file';
import { RoomGuideHeader } from './office-room-parts';
import {
  LEAD_BOARD_FIRST_VIEW,
  LEAD_BOARD_PAGE_SIZE,
  LEAD_BOARD_VIEWS,
  type LeadBoardView,
  leadBoardFilters,
  leadBoardInput,
  leadBoardPages,
  leadBoardViewOfKey,
  leadCountInput,
  nextRow,
  roomGuide,
} from './office-rooms';

/** How many of the two marks an MQL level fills (対象外 and no diagnosis fill none) */
const MQL_MARKS: Record<string, number> = { interest: 2, fit: 1 };

export type { RoomKeys };

/**
 * The marketing room of the full-screen office (#1127): the lead list as the room's wall board,
 * and the room's figures read out next to the AI employee the room belongs to.
 *
 * The board reads `leads.list` (the API scopes it to the organization and checks the permission).
 * The figures are the totals of three views of that list, nothing else: an AI employee that is in
 * training, paused or not hired is shown as such and reports nothing of its own. The president
 * switches the view with the choices (number keys), moves over the rows with the arrow keys and
 * opens a lead with Enter: its customer file opens inside the room (office-lead-file.tsx, #1128).
 */
export function OfficeRoomLeads({
  organizationId,
  role,
  status,
  employeeName,
  keysRef,
  onOpenLead,
  onFileOpenChange,
}: {
  organizationId: string;
  role: AiEmployeeRole;
  status: DeskStatus;
  /** The name of the AI employee of the room; null while the seat is vacant */
  employeeName: string | null;
  /** Filled with the room's key handler while the room is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  /** The list or a lead's page is opened in the normal view: the office closes */
  onOpenLead: () => void;
  /** Told when a file opens or closes: while one is open, Esc closes it, not the room */
  onFileOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.room');
  const tLeads = useTranslations('aiOffice.immersive.room.leads');
  const tOffice = useTranslations('aiOffice');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tStatus = useTranslations('status');
  const tLevels = useTranslations('leadActivity.summary.mqlLevels');
  const tLead = useTranslations('leads');
  const format = useFormatter();
  const locale = useLocale();
  const boardRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<LeadBoardView>(LEAD_BOARD_FIRST_VIEW);
  const [page, setPage] = useState(1);
  // The lead whose file is open on the room's table, and the row to go back to
  const [open, setOpen] = useState<BoardLead | null>(null);
  const fileKeys = useRef<RoomKeys | null>(null);
  const lastOpened = useRef<string | null>(null);
  // "This week" is fixed when the room opens, so the queries keep their keys
  const [now] = useState(() => new Date());

  const list = trpc.leads.list.useQuery(leadBoardInput(view, page, organizationId, now), {
    placeholderData: (previous) => previous,
  });
  const newThisWeek = trpc.leads.list.useQuery(leadCountInput('newThisWeek', organizationId, now));
  const consultation = trpc.leads.list.useQuery(
    leadCountInput('consultation', organizationId, now)
  );
  const needsAction = trpc.leads.list.useQuery(leadCountInput('needsAction', organizationId, now));

  const forbidden = list.error?.data?.code === 'FORBIDDEN';
  const items: BoardLead[] = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = leadBoardPages(total);
  const guide = roomGuide(status);
  const roleTitle = tOffice(`roles.${role}.title`);

  const choose = (next: LeadBoardView) => {
    setView(next);
    setPage(1);
  };
  const turn = (delta: 1 | -1) =>
    setPage((current) => Math.max(1, Math.min(pages, current + delta)));

  const openFile = (lead: BoardLead) => {
    lastOpened.current = lead.id;
    setOpen(lead);
  };
  const fileOpen = open !== null;
  useEffect(() => {
    onFileOpenChange(fileOpen);
    return () => onFileOpenChange(false);
  }, [fileOpen, onFileOpenChange]);
  // Closing the file gives the focus back to the row it was opened from
  useEffect(() => {
    if (open || !lastOpened.current) return;
    boardRef.current?.querySelector<HTMLElement>(`[data-lead-id="${lastOpened.current}"]`)?.focus();
    lastOpened.current = null;
  }, [open]);

  // The room's keys: numbers choose the view, the arrows move over the rows and the pages.
  // Enter opens the focused row by itself (the rows are buttons). While a file is open, the keys
  // are the file's, and Esc closes it instead of leaving the room.
  const onRoomKey: RoomKeys = (event) => {
    if (open) {
      if (event.key === 'Escape') {
        setOpen(null);
        return true;
      }
      return fileKeys.current?.(event) ?? false;
    }
    const chosen = leadBoardViewOfKey(event.key);
    if (chosen) {
      event.preventDefault();
      choose(chosen);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = Array.from(
        boardRef.current?.querySelectorAll<HTMLElement>('[data-lead-row]') ?? []
      );
      const current = rows.indexOf(document.activeElement as HTMLElement);
      const target = rows[nextRow(current, event.key === 'ArrowDown' ? 1 : -1, rows.length)];
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

  const counts = [newThisWeek.data, consultation.data, needsAction.data];
  const countsReady = counts.every((data) => data !== undefined);
  const countsFailed = newThisWeek.isError || consultation.isError || needsAction.isError;
  const from = total === 0 ? 0 : (page - 1) * LEAD_BOARD_PAGE_SIZE + 1;
  const to = Math.min(total, page * LEAD_BOARD_PAGE_SIZE);

  const header = <RoomGuideHeader role={role} status={status} employeeName={employeeName} />;

  if (open) {
    return (
      <OfficeLeadFile
        organizationId={organizationId}
        lead={open}
        header={header}
        keysRef={fileKeys}
        onClose={() => setOpen(null)}
        onOpenDetail={onOpenLead}
      />
    );
  }

  return (
    <div className="absolute inset-x-4 top-20 bottom-4 flex flex-col gap-4 overflow-y-auto lg:inset-x-6 lg:bottom-6 lg:flex-row lg:items-end lg:overflow-visible">
      {/* Whose room this is, the room's figures, and what the president asks for */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        {header}
        {/* The report takes the focus when the room opens: Enter pressed once too often does nothing */}
        <div tabIndex={-1} data-autofocus="" className="space-y-2 outline-none">
          <p className="text-sm leading-relaxed text-[#d8d2c4]">
            {t(`guide.${guide}`, { name: employeeName ?? roleTitle, role: roleTitle })}
          </p>
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {forbidden || countsFailed
              ? tLeads('reportUnavailable')
              : countsReady
                ? tLeads('report', {
                    newThisWeek: newThisWeek.data?.total ?? 0,
                    consultation: consultation.data?.total ?? 0,
                    needsAction: needsAction.data?.total ?? 0,
                  })
                : tLeads('reportLoading')}
          </p>
        </div>
        <h3 className={CAP}>{tImmersive('talk.you')}</h3>
        <ul className="space-y-2">
          {LEAD_BOARD_VIEWS.map((option, index) => {
            const on = option === view;
            return (
              <li key={option}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 border px-3 text-left text-sm font-bold',
                    on
                      ? 'border-[#e9cf9a] bg-[#e9cf9a] text-[#1b2130]'
                      : 'border-[#f5f1e8]/35 bg-[#f5f1e8]/5 hover:border-[#e9cf9a] hover:bg-[#f5f1e8]/15',
                    FOCUS
                  )}
                >
                  <span className={cn(KEY, on && 'border-[#1b2130]/60')}>{index + 1}</span>
                  {tLeads(`ask.${option}`)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* The wall board of the room */}
      <section
        ref={boardRef}
        aria-label={tLeads('board')}
        aria-busy={list.isFetching}
        className="flex min-h-[30rem] min-w-0 flex-1 flex-col border border-[#e9cf9a]/45 border-t-[3px] border-t-[#e9cf9a] bg-[linear-gradient(180deg,rgba(12,17,30,0.96)_0%,rgba(9,13,24,0.94)_100%)] shadow-[0_30px_60px_rgba(2,5,12,0.6)] lg:self-stretch"
      >
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <div className="flex items-baseline gap-4">
            <h2 className="text-xl font-bold">{tLeads('board')}</h2>
            <p className="text-sm text-[#d8d2c4]">
              {tLeads(`views.${view}`)}
              {list.data && `・${tLeads('count', { count: total })}`}
            </p>
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
            {tLeads('forbidden')}
          </p>
        ) : list.isError ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tLeads('error')}
          </p>
        ) : !list.data ? (
          <output className="m-auto flex items-center gap-3 text-sm text-[#d8d2c4]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {tLeads('loading')}
          </output>
        ) : items.length === 0 ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tLeads('empty')}
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
              <span>{tLeads('columns.lead')}</span>
              <span>{tLeads('columns.mql')}</span>
              <span>{tLeads('columns.status')}</span>
              <span className="hidden md:block">{tLeads('columns.assignee')}</span>
              <span className="hidden md:block">{tLeads('columns.created')}</span>
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
                      onClick={() => openFile(lead)}
                      className={cn(
                        ROW_GRID,
                        'min-h-[3.5rem] w-full border-b border-[#f5f1e8]/10 text-left text-sm hover:bg-[#f5f1e8]/5 focus-visible:bg-[#e9cf9a]/15 focus-visible:shadow-[inset_3px_0_0_#e9cf9a]',
                        FOCUS
                      )}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-bold">
                          {lead.company || tLeads('noCompany')}
                        </span>
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
                          {lead.mqlLevel ? tLevels(lead.mqlLevel) : tLeads('noLevel')}
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
                        {lead.assignee?.name ?? tLeads('unassigned')}
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
            {list.data && total > 0 && tLeads('range', { total, from, to })}
            <span className="ml-3 text-xs">{tLeads('openHint')}</span>
          </p>
          <div className="flex items-center gap-2">
            <Link
              href={`/${locale}${leadListHref(leadBoardFilters(view, now), DEFAULT_LEAD_SORT)}`}
              onClick={onOpenLead}
              className={cn('mr-2 underline underline-offset-4 hover:text-white', FOCUS)}
            >
              {tLeads('openList')}
            </Link>
            <button
              type="button"
              onClick={() => turn(-1)}
              aria-disabled={page <= 1}
              className={cn(PAGE_BUTTON, FOCUS)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {tLeads('prev')}
            </button>
            <span className="tabular-nums" aria-live="polite">
              {tLeads('page', { page, pages })}
            </span>
            <button
              type="button"
              onClick={() => turn(1)}
              aria-disabled={page >= pages}
              className={cn(PAGE_BUTTON, FOCUS)}
            >
              {tLeads('next')}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

/** The columns of the board: lead, MQL level, status, and from a tablet on, assignee and day */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1.6fr)_9.5rem_7rem] items-center gap-4 px-5 md:grid-cols-[minmax(0,1.6fr)_9.5rem_7rem_minmax(0,0.8fr)_6.5rem]';

// A page button at the end of the board stays focusable (aria-disabled): a disabled button
// would drop the focus, and the keys of the room with it
const PAGE_BUTTON =
  'inline-flex min-h-11 items-center gap-1 border border-[#f5f1e8]/35 px-3 text-sm font-bold text-[#f5f1e8] hover:bg-[#f5f1e8]/10 aria-disabled:cursor-not-allowed aria-disabled:border-[#f5f1e8]/15 aria-disabled:text-[#f5f1e8]/40 aria-disabled:hover:bg-transparent';
