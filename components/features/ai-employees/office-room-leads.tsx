'use client';

import { isImeKey } from '@/components/ui/ime';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import type { InflowSource } from '@/lib/features/leads/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { type MutableRefObject, useEffect, useId, useRef, useState } from 'react';
import {
  OfficeBoardCampaigns,
  OfficeBoardProgress,
  OfficeBoardSources,
} from './office-board-figures';
import { OfficeBoardLeads } from './office-board-leads';
import { CAP, PANEL } from './office-hud';
import { type BoardLead, OfficeLeadFile, type RoomKeys } from './office-lead-file';
import {
  MARKETING_FIGURE_BOARDS,
  MARKETING_FIRST_CHOICE,
  MARKETING_RANGE,
  MARKETING_RANGE_DAYS,
  type MarketingChoice,
  UNSET_SOURCE,
  figureState,
  isLeadBoardView,
  marketingChoiceKey,
  marketingChoiceOfKey,
  marketingReport,
  qrCampaignRows,
  sourceLeadFilters,
} from './office-marketing';
import { ROOM_FRAME, RoomChoiceButton, RoomGuideHeader, RoomGuideLine } from './office-room-parts';
import { LEAD_BOARD_VIEWS, leadBoardFilters, roomGuide } from './office-rooms';
import { useRoomKeys } from './use-room-keys';

export type { RoomKeys };

/**
 * The marketing room of the full-screen office (#1127, remade as the marketer's room in #1200):
 * the marketer finds prospects and tells which ones are worth following, so the room reports
 * where the prospects of the last 30 days came from and how far they got, and its wall shows the
 * board the president asks for: the sources, the progress, the campaigns (#1201), or a view of
 * the lead board. A row of the source board opens the prospects of that source on the lead board
 * (#1202); Esc goes back one step at a time (file, prospects of a source, floor).
 *
 * The report is made of the figures of the analytics API and nothing else: an AI employee that is
 * in training, paused or not hired is shown as such and reports nothing of its own. The
 * president's choices switch the board (number keys; a key keeps its meaning whichever board is
 * on the wall). On the lead board the arrow keys move over the rows and Enter opens a lead: its
 * customer file opens inside the room (office-lead-file.tsx, #1128).
 *
 * The file and the component keep the name they had while the room was the lead board only, so
 * the office that holds the rooms is not touched while other work changes it; they are renamed
 * when the rooms get their registry (#1142).
 */
export function OfficeRoomLeads({
  organizationId,
  role,
  status,
  employeeName,
  look,
  keysRef,
  onOpenLead,
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
  /** A page of the normal view is opened (a list, a lead, the analytics): the office closes */
  onOpenLead: () => void;
  /** Told when a file opens or closes: while one is open, Esc closes it, not the room */
  onFileOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.room');
  const tRoom = useTranslations('aiOffice.immersive.room.marketing');
  const tOffice = useTranslations('aiOffice');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tInflow = useTranslations('pipeline.inflowSource');
  const [choice, setChoice] = useState<MarketingChoice>(MARKETING_FIRST_CHOICE);
  // The page of the lead board, and whether it was turned within the view that is on
  const [page, setPage] = useState(1);
  const [turned, setTurned] = useState(false);
  // The lead whose file is open on the room's table, and the row to go back to
  const [open, setOpen] = useState<BoardLead | null>(null);
  const fileKeys = useRef<RoomKeys | null>(null);
  const boardKeys = useRef<RoomKeys | null>(null);
  const lastOpened = useRef<string | null>(null);
  // The source whose prospects are on the lead board, opened from its row of the source board
  // (#1202), and the row to go back to
  const [source, setSource] = useState<InflowSource | null>(null);
  const lastSource = useRef<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  // "This week" is fixed when the room opens, so the queries keep their keys
  const [now] = useState(() => new Date());
  const figuresAskId = useId();
  const leadsAskId = useId();

  // The figures of the room: the two boards of figures, and the report made of them
  const period = { organizationId, dateRange: MARKETING_RANGE };
  const funnel = trpc.analytics.getConversionFunnel.useQuery(period);
  const cost = trpc.analytics.getAcquisitionCost.useQuery(period);
  const funnelState = figureState(funnel);
  const costState = figureState(cost);
  // The campaign board reads its own figures, and only once it is asked for (#1201)
  const onCampaigns = { enabled: choice === 'campaigns' };
  const campaigns = trpc.distribution.listCampaigns.useQuery({ organizationId }, onCampaigns);
  const breakdowns = trpc.analytics.getQrCampaignBreakdown.useQuery(
    { organizationId },
    onCampaigns
  );
  const agencies = trpc.analytics.getAgencyPerformance.useQuery(period, onCampaigns);

  const guide = roomGuide(status);
  const roleTitle = tOffice(`roles.${role}.title`);

  const choose = (next: MarketingChoice) => {
    setChoice(next);
    setSource(null);
    lastSource.current = null;
    setPage(1);
    setTurned(false);
  };
  const openSource = (next: InflowSource) => {
    lastSource.current = next;
    // The row that was opened leaves the wall with its board: the focus goes to the report
    reportRef.current?.focus();
    setSource(next);
    setPage(1);
    setTurned(false);
  };
  const closeSource = () => setSource(null);

  // Something is open inside the room (a file, or the prospects of a source): Esc closes it
  // first, so the office does not show its Esc on the way to the floor
  const somethingOpen = open !== null || source !== null;
  useEffect(() => {
    onFileOpenChange(somethingOpen);
    return () => onFileOpenChange(false);
  }, [somethingOpen, onFileOpenChange]);

  // The room's keys: numbers choose the board; the other keys are the board's (the lead board
  // moves over its rows and pages, the source board over its rows). While a file is open, the
  // keys are the file's, and Esc closes it instead of leaving the room; while the prospects of a
  // source are on the wall, Esc goes back to the source board.
  useRoomKeys(keysRef, (event) => {
    // A key of a Japanese conversion (IME) is never an answer: it belongs to what is being typed
    if (isImeKey(event)) return false;
    if (open) {
      if (event.key === 'Escape') {
        setOpen(null);
        return true;
      }
      return fileKeys.current?.(event) ?? false;
    }
    if (source && event.key === 'Escape') {
      closeSource();
      return true;
    }
    const chosen = marketingChoiceOfKey(event.key);
    if (chosen) {
      event.preventDefault();
      // The board that holds the focus may leave the wall: the focus goes back to the report,
      // where it sits when the room opens, instead of falling out of the room
      if (document.activeElement?.closest('section')) reportRef.current?.focus();
      choose(chosen);
      return true;
    }
    return boardKeys.current?.(event) ?? false;
  });

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
      <OfficeLeadFile
        organizationId={organizationId}
        lead={open}
        header={header}
        guide={guideLine}
        keysRef={fileKeys}
        onClose={() => setOpen(null)}
        onOpenDetail={onOpenLead}
      />
    );
  }

  const days = MARKETING_RANGE_DAYS;
  const sourceLabel = (name: string) =>
    name === UNSET_SOURCE ? tRoom('sources.unset') : tInflow.has(name) ? tInflow(name) : name;
  const sourceBoardLabel = source
    ? tRoom('sources.leadsOf', { source: sourceLabel(source), days })
    : null;
  const boardName = sourceBoardLabel
    ? tRoom('boardOf', { board: t('leads.board'), what: sourceBoardLabel })
    : isLeadBoardView(choice)
      ? t('leads.board')
      : tRoom(`${choice}.board`);
  const report = funnel.data && cost.data ? marketingReport(funnel.data, cost.data) : null;
  const forbidden = [funnelState, costState].includes('forbidden');
  const failed = [funnelState, costState].some(
    (state) => state === 'forbidden' || state === 'error'
  );

  return (
    <div className={ROOM_FRAME}>
      {/* Whose room this is, the room's figures, and what the president asks for */}
      <div
        className={cn(
          PANEL,
          'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:max-h-full lg:w-[26rem] lg:overflow-y-auto'
        )}
      >
        {header}
        {/* The report takes the focus when the room opens: Enter pressed once too often does nothing */}
        <div ref={reportRef} tabIndex={-1} data-autofocus="" className="space-y-2 outline-none">
          {guideLine}
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {forbidden
              ? tRoom('forbidden')
              : failed
                ? tRoom('reportUnavailable')
                : !report
                  ? tRoom('reportLoading')
                  : report.leads === 0
                    ? tRoom('reportNone', { days })
                    : report.topSource
                      ? tRoom('reportWithTop', {
                          days,
                          leads: report.leads,
                          mql: report.mql,
                          deals: report.deals,
                          source: sourceLabel(report.topSource.source),
                          count: report.topSource.count,
                          withoutSource: report.withoutSource,
                        })
                      : tRoom('report', {
                          days,
                          leads: report.leads,
                          mql: report.mql,
                          deals: report.deals,
                          withoutSource: report.withoutSource,
                        })}
          </p>
        </div>
        <h3 className={CAP}>{tImmersive('talk.you')}</h3>
        {/* The boards of figures: one request, said once, with what to show under it */}
        {/* biome-ignore lint/a11y/useSemanticElements: a named group of choices, not a form's fieldset */}
        <div role="group" aria-labelledby={figuresAskId} className="space-y-2">
          <p id={figuresAskId} className="text-sm text-[#d8d2c4]">
            {tRoom('ask.figures')}
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {MARKETING_FIGURE_BOARDS.map((option) => (
              <li key={option}>
                <RoomChoiceButton
                  keyCap={marketingChoiceKey(option)}
                  main={option === choice}
                  pressed={option === choice}
                  onClick={() => choose(option)}
                >
                  {tRoom(`figureBoards.${option}`)}
                </RoomChoiceButton>
              </li>
            ))}
          </ul>
        </div>
        {/* The views of the lead board: one request, said once, with what to show under it */}
        {/* biome-ignore lint/a11y/useSemanticElements: a named group of choices, not a form's fieldset */}
        <div role="group" aria-labelledby={leadsAskId} className="space-y-2">
          <p id={leadsAskId} className="pt-1 text-sm text-[#d8d2c4]">
            {tRoom('ask.leads')}
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {LEAD_BOARD_VIEWS.map((option) => (
              <li key={option}>
                <RoomChoiceButton
                  keyCap={marketingChoiceKey(option)}
                  main={option === choice}
                  pressed={option === choice}
                  onClick={() => choose(option)}
                >
                  {tRoom(`leadViews.${option}`)}
                </RoomChoiceButton>
              </li>
            ))}
          </ul>
        </div>
        {/* Which board is on the wall, said from the panel that stays: the boards are made anew
            at each change, and a live region that arrives with its words is not read out */}
        <output className="sr-only">{tRoom('onWall', { board: boardName })}</output>
      </div>

      {/* The wall board of the room */}
      {source || isLeadBoardView(choice) ? (
        <OfficeBoardLeads
          organizationId={organizationId}
          filters={
            source
              ? sourceLeadFilters(source, now)
              : leadBoardFilters(isLeadBoardView(choice) ? choice : 'all', now)
          }
          label={sourceBoardLabel ?? t(`leads.views.${isLeadBoardView(choice) ? choice : 'all'}`)}
          page={page}
          keepRows={turned}
          back={source ? { label: tRoom('sources.back'), onBack: closeSource } : undefined}
          keysRef={boardKeys}
          focusLeadRef={lastOpened}
          onTurn={(next) => {
            setTurned(true);
            setPage(next);
          }}
          onOpen={(lead) => {
            lastOpened.current = lead.id;
            setOpen(lead);
          }}
          onLeave={onOpenLead}
        />
      ) : choice === 'sources' ? (
        <OfficeBoardSources
          state={costState}
          cost={cost.data}
          keysRef={boardKeys}
          focusSourceRef={lastSource}
          onOpenSource={openSource}
          onLeave={onOpenLead}
        />
      ) : choice === 'funnel' ? (
        <OfficeBoardProgress state={funnelState} funnel={funnel.data} onLeave={onOpenLead} />
      ) : (
        <OfficeBoardCampaigns
          qrState={figureState(campaigns)}
          qrRows={qrCampaignRows(campaigns.data ?? [], breakdowns.data)}
          breakdownState={figureState(breakdowns)}
          agencyState={figureState(agencies)}
          agencies={agencies.data}
          onLeave={onOpenLead}
        />
      )}
    </div>
  );
}
