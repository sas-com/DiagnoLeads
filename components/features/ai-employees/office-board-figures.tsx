'use client';

import type {
  AcquisitionCostSummary,
  AgencyPerformanceRow,
  ConversionFunnelData,
  DealReturns,
} from '@/lib/features/analytics/types/schemas';
import type { InflowSource } from '@/lib/features/leads/types/pipeline';
import { cn } from '@/lib/utils';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, type ReactNode, useEffect, useRef } from 'react';
import { focusNextRow } from './office-board-leads';
import { FOCUS, KEY } from './office-hud';
import {
  type FigureState,
  MARKETING_RANGE_DAYS,
  type QrCampaignRow,
  UNSET_SOURCE,
  openableSource,
  progressRows,
  showsDealReturns,
  sourceRows,
  uncostedLeads,
} from './office-marketing';
import type { RoomKeys } from './office-room-contract';
import { ROOM_BOARD, RoomBoardLoading, RoomBoardMessage } from './office-room-parts';
import { useRoomKeys } from './use-room-keys';

/**
 * The boards of figures of the marketing room (#1200, #1201): where the prospects of the period
 * came from, how far they got, and what each campaign brought. They show what the APIs answered
 * and nothing else; the APIs scope the figures to the organization and check the permission.
 * Nothing on them is carried out: a row of the source board only opens its prospects on the lead
 * board (#1202); the period, the finer breakdowns and the settings of the campaigns stay on the
 * pages of the normal view.
 */

/** A page of the normal view a board of figures leads to (without the language) */
interface BoardLink {
  href: string;
  label: string;
}

/** The frame the boards of figures share: title, summary, what stands in for the rows, the ways out */
function FigureBoard({
  title,
  summary,
  state,
  emptyText,
  keys,
  notes,
  hint,
  links,
  boardRef,
  onLeave,
  children,
}: {
  title: string;
  /** What the figures are of, next to the title */
  summary: string;
  state: FigureState;
  /** Said instead of the rows when there is nothing to show; left out when there are rows */
  emptyText?: string;
  /** The keys of the board, when its rows can be opened */
  keys?: ReactNode;
  /** What the figures mean, under the table */
  notes?: ReactNode;
  /** What the pages of the normal view add */
  hint: string;
  links: BoardLink[];
  boardRef?: MutableRefObject<HTMLElement | null>;
  /** A page of the normal view is opened: the office closes */
  onLeave: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('aiOffice.immersive.room.marketing');
  const locale = useLocale();
  return (
    <section
      ref={boardRef}
      aria-label={title}
      aria-busy={state === 'loading'}
      className={ROOM_BOARD}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-xl font-bold">{title}</h2>
          {/* Plain words: the board is made anew at each change, so the room's panel, which
              stays, is the one that says which board is on the wall */}
          <p className="text-sm text-[#d8d2c4]">{summary}</p>
        </div>
        {keys}
      </header>

      {state === 'forbidden' ? (
        <RoomBoardMessage>{t('forbidden')}</RoomBoardMessage>
      ) : state === 'error' ? (
        <RoomBoardMessage>{t('error')}</RoomBoardMessage>
      ) : state === 'loading' ? (
        <RoomBoardLoading>{t('loading')}</RoomBoardLoading>
      ) : emptyText ? (
        <RoomBoardMessage>{emptyText}</RoomBoardMessage>
      ) : (
        // The figures scroll when the wall is too small for them: the region takes the focus, so
        // the arrow keys scroll it, and it says what it is
        <div
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
          tabIndex={0}
          // biome-ignore lint/a11y/useSemanticElements: a named group around a table, not a form's fieldset
          role="group"
          aria-label={t('scroll', { board: title })}
          className={cn('min-h-0 flex-1 overflow-auto px-5 py-2', FOCUS)}
        >
          {children}
          {notes && (
            <div className="space-y-1 py-3 text-xs leading-relaxed text-[#d8d2c4]">{notes}</div>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
        <p className="text-xs">{hint}</p>
        <p className="flex flex-wrap gap-x-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={`/${locale}${link.href}`}
              onClick={onLeave}
              className={cn(
                'inline-flex min-h-11 items-center underline underline-offset-4 hover:text-white',
                FOCUS
              )}
            >
              {link.label}
            </Link>
          ))}
        </p>
      </footer>
    </section>
  );
}

/** The summary of a board of the period: the period, and how many prospects once they are read */
function usePeriodSummary(state: FigureState, count: number) {
  const t = useTranslations('aiOffice.immersive.room.marketing');
  const days = MARKETING_RANGE_DAYS;
  return {
    summary: state === 'ready' ? t('period', { days, count }) : t('periodOnly', { days }),
    emptyText: state === 'ready' && count === 0 ? t('empty', { days }) : undefined,
    hint: t('analyticsHint'),
    links: [{ href: '/analytics', label: t('openAnalytics') }],
  };
}

const TABLE = 'w-full border-collapse text-sm';
const HEAD =
  'border-b border-[#f5f1e8]/15 px-2 py-2 text-xs font-normal whitespace-nowrap text-[#bdb7a9]';
const CELL = 'border-b border-[#f5f1e8]/10 px-2 py-3';
const NUM = 'text-right whitespace-nowrap tabular-nums';
const FOOT = 'border-t border-[#f5f1e8]/35 px-2 py-3 font-bold';

/**
 * A share of the whole as a bar: decoration, the figure is written next to it. `wide` keeps the
 * bar on every width (the progress board has room); the source board, with up to eight columns,
 * shows it from a wide screen on and leaves the figure alone below.
 */
function ShareBar({ percent, wide = false }: { percent: number; wide?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('h-2 w-full min-w-16 bg-[#f5f1e8]/10', wide ? 'block' : 'hidden xl:block')}
    >
      <span
        className="block h-full bg-[#e9cf9a]"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </span>
  );
}

/** Where the prospects of the period came from: by 流入元, with what was spent and what came back */
export function OfficeBoardSources({
  state,
  cost,
  keysRef,
  focusSourceRef,
  onOpenSource,
  onLeave,
}: {
  state: FigureState;
  cost: AcquisitionCostSummary | undefined;
  /** Filled with the board's key handler while the board is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  /** The source whose row takes the focus when the board comes back from its prospects */
  focusSourceRef: MutableRefObject<string | null>;
  /** A row is opened: the room shows the prospects of that source on the lead board (#1202) */
  onOpenSource: (source: InflowSource) => void;
  onLeave: () => void;
}) {
  const tLeads = useTranslations('aiOffice.immersive.room.leads');
  const tSources = useTranslations('aiOffice.immersive.room.marketing.sources');
  const boardRef = useRef<HTMLElement | null>(null);
  const frame = usePeriodSummary(state, cost?.leadCount ?? 0);
  const tInflow = useTranslations('pipeline.inflowSource');
  const format = useFormatter();
  const rows = cost ? sourceRows(cost) : [];
  // The amounts of the deals only for those the API answered with them (canReadDeals)
  const returns = cost ? showsDealReturns(cost) : false;
  const uncosted = cost ? uncostedLeads(cost) : 0;

  const label = (source: string) =>
    source === UNSET_SOURCE ? tSources('unset') : tInflow.has(source) ? tInflow(source) : source;
  const yen = (value: number) => format.number(value, { style: 'currency', currency: 'JPY' });
  const roi = (deals: DealReturns | null) =>
    deals?.roi == null ? tSources('none') : tSources('roiValue', { value: deals.roi });
  const wonAmount = (deals: DealReturns | null) =>
    deals ? yen(deals.wonAmount) : tSources('none');
  const opens = rows.some((row) => openableSource(row.source) !== null);

  // Coming back from the prospects of a source gives the focus back to its row
  useEffect(() => {
    if (!focusSourceRef.current) return;
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-source="${focusSourceRef.current}"]`)
      ?.focus();
    focusSourceRef.current = null;
  }, [focusSourceRef]);

  // The board's keys: the arrows move over the rows that open. Enter opens the focused row by
  // itself (the rows that open are buttons).
  useRoomKeys(keysRef, (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
    return focusNextRow(boardRef.current, '[data-source]', event);
  });

  return (
    <FigureBoard
      title={tSources('board')}
      {...frame}
      state={state}
      boardRef={boardRef}
      onLeave={onLeave}
      keys={
        opens &&
        state === 'ready' && (
          <p className="flex items-center gap-2 text-xs text-[#d8d2c4]">
            <span className={KEY}>↑</span>
            <span className={KEY}>↓</span>
            {tLeads('keys.rows')}
            <span className={cn(KEY, 'ml-2')}>Enter</span>
            {tSources('keys.open')}
          </p>
        )
      }
      notes={
        <>
          <p>{uncosted > 0 ? tSources('uncosted', { count: uncosted }) : tSources('costed')}</p>
          {returns && <p>{tSources('returns')}</p>}
          {opens && <p>{tSources('openHint', { days: MARKETING_RANGE_DAYS })}</p>}
        </>
      }
    >
      <table className={TABLE}>
        <caption className="sr-only">{tSources('caption', { days: MARKETING_RANGE_DAYS })}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, 'text-left')}>
              {tSources('columns.source')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {tSources('columns.leads')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-left')}>
              {tSources('columns.share')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {tSources('columns.sql')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {tSources('columns.won')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {tSources('columns.cost')}
            </th>
            {returns && (
              <>
                <th scope="col" className={cn(HEAD, 'text-right')}>
                  {tSources('columns.wonAmount')}
                </th>
                <th scope="col" className={cn(HEAD, 'text-right')}>
                  {tSources('columns.roi')}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source}>
              <th scope="row" className={cn(CELL, 'min-w-[7.5rem] text-left font-bold')}>
                <SourceName
                  name={label(row.source)}
                  source={openableSource(row.source)}
                  openLabel={tSources('open', { source: label(row.source) })}
                  onOpen={onOpenSource}
                />
              </th>
              <td className={cn(CELL, NUM)}>{format.number(row.leadCount)}</td>
              <td className={CELL}>
                <span className="flex items-center gap-2">
                  <ShareBar percent={row.share} />
                  <span className={cn(NUM, 'w-10 shrink-0 text-xs')}>
                    {tSources('shareValue', { share: row.share })}
                  </span>
                </span>
              </td>
              <td className={cn(CELL, NUM)}>{format.number(row.sqlCount)}</td>
              <td className={cn(CELL, NUM)}>{format.number(row.wonCount)}</td>
              <td className={cn(CELL, NUM)}>{yen(row.totalCost)}</td>
              {returns && (
                <>
                  <td className={cn(CELL, NUM)}>{wonAmount(row.deals)}</td>
                  <td className={cn(CELL, NUM)}>{roi(row.deals)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
        {cost && (
          <tfoot>
            <tr>
              <th scope="row" className={cn(FOOT, 'text-left')}>
                {tSources('total')}
              </th>
              <td className={cn(FOOT, NUM)}>{format.number(cost.leadCount)}</td>
              <td className={cn(FOOT, NUM, 'text-xs')}>{tSources('shareValue', { share: 100 })}</td>
              <td className={cn(FOOT, NUM)}>{format.number(cost.sqlCount)}</td>
              <td className={cn(FOOT, NUM)}>{format.number(cost.wonCount)}</td>
              <td className={cn(FOOT, NUM)}>{yen(cost.totalCost)}</td>
              {returns && (
                <>
                  <td className={cn(FOOT, NUM)}>{wonAmount(cost.deals)}</td>
                  <td className={cn(FOOT, NUM)}>{roi(cost.deals)}</td>
                </>
              )}
            </tr>
          </tfoot>
        )}
      </table>
    </FigureBoard>
  );
}

/** How far the prospects of the period got: the stages of the lead lifecycle, one row each */
export function OfficeBoardProgress({
  state,
  funnel,
  onLeave,
}: {
  state: FigureState;
  funnel: ConversionFunnelData | undefined;
  onLeave: () => void;
}) {
  const tFunnel = useTranslations('aiOffice.immersive.room.marketing.funnel');
  const frame = usePeriodSummary(state, funnel?.totalLeads ?? 0);
  const format = useFormatter();
  const rows = funnel ? progressRows(funnel) : [];
  const percent = (value: number) => tFunnel('percent', { value });

  return (
    <FigureBoard
      title={tFunnel('board')}
      {...frame}
      state={state}
      onLeave={onLeave}
      notes={
        <>
          <p>{tFunnel('reachedNote')}</p>
          {funnel && funnel.nurturingCount > 0 && (
            <p>{tFunnel('nurturing', { count: funnel.nurturingCount })}</p>
          )}
        </>
      }
    >
      <table className={TABLE}>
        <caption className="sr-only">{tFunnel('caption', { days: MARKETING_RANGE_DAYS })}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, 'text-left')}>
              {tFunnel('columns.stage')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {tFunnel('columns.reached')}
            </th>
            <th scope="col" className={cn(HEAD, 'w-1/2 text-left')}>
              {tFunnel('columns.ofAll')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {tFunnel('columns.fromPrevious')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row" className={cn(CELL, 'py-4 text-left font-bold whitespace-nowrap')}>
                {tFunnel(`stages.${row.name}`)}
              </th>
              <td className={cn(CELL, NUM, 'py-4 text-base font-bold')}>
                {format.number(row.reached)}
              </td>
              <td className={cn(CELL, 'py-4')}>
                <span className="flex items-center gap-2">
                  <ShareBar percent={row.ofAll} wide />
                  <span className={cn(NUM, 'w-10 shrink-0 text-xs')}>{percent(row.ofAll)}</span>
                </span>
              </td>
              <td className={cn(CELL, NUM, 'py-4')}>
                {row.fromPrevious === null ? tFunnel('none') : percent(row.fromPrevious)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </FigureBoard>
  );
}

/** The name of a source in its row: a button when the lead list can show its prospects */
function SourceName({
  name,
  source,
  openLabel,
  onOpen,
}: {
  name: string;
  /** Null when the lead list has no filter for the row (no source recorded) */
  source: InflowSource | null;
  openLabel: string;
  onOpen: (source: InflowSource) => void;
}) {
  if (!source) return <>{name}</>;
  return (
    <button
      type="button"
      data-source={source}
      aria-label={openLabel}
      onClick={() => onOpen(source)}
      className={cn(
        '-my-2 flex min-h-11 w-full items-center text-left font-bold underline decoration-[#e9cf9a]/60 underline-offset-4 hover:text-white hover:decoration-[#e9cf9a] focus-visible:bg-[#e9cf9a]/15',
        FOCUS
      )}
    >
      {name}
    </button>
  );
}

/** A part of the campaign board: its own title and period, and its own state */
function CampaignSection({
  title,
  period,
  state,
  emptyText,
  children,
}: {
  title: string;
  period: string;
  state: FigureState;
  emptyText?: string;
  children: ReactNode;
}) {
  const t = useTranslations('aiOffice.immersive.room.marketing');
  return (
    <div className="py-3">
      <h3 className="flex flex-wrap items-baseline gap-x-3 text-base font-bold">
        {title}
        <span className="text-xs font-normal text-[#d8d2c4]">{period}</span>
      </h3>
      {state === 'ready' && !emptyText ? (
        children
      ) : (
        <p className="py-4 text-sm text-[#d8d2c4]" aria-busy={state === 'loading'}>
          {state === 'forbidden'
            ? t('forbidden')
            : state === 'error'
              ? t('error')
              : state === 'loading'
                ? t('loading')
                : emptyText}
        </p>
      )}
    </div>
  );
}

/**
 * What each campaign brought (#1201): the QR campaigns with their scans and new prospects since
 * they were made, and the sales agencies with the prospects of the period they set up. Two tables
 * on one board, each with its own period and its own state; creating and changing campaigns stays
 * on the settings page of the normal view.
 */
export function OfficeBoardCampaigns({
  qrState,
  qrRows,
  breakdownState,
  agencyState,
  agencies,
  onLeave,
}: {
  qrState: FigureState;
  qrRows: QrCampaignRow[];
  /** The breakdown of the QR campaigns is read apart: the rows show without it */
  breakdownState: FigureState;
  agencyState: FigureState;
  agencies: AgencyPerformanceRow[] | undefined;
  onLeave: () => void;
}) {
  const t = useTranslations('aiOffice.immersive.room.marketing');
  const tBoard = useTranslations('aiOffice.immersive.room.marketing.campaigns');
  const tSources = useTranslations('aiOffice.immersive.room.marketing.sources');
  const format = useFormatter();
  const days = MARKETING_RANGE_DAYS;
  const none = tSources('none');
  const yen = (value: number) => format.number(value, { style: 'currency', currency: 'JPY' });
  const percent = (value: number | null) =>
    value === null ? none : tSources('shareValue', { share: value });
  const agencyRows = agencies ?? [];
  // The amounts of the deals only for those the API answered with them (canReadDeals)
  const returns = agencyRows.some((row) => row.deals !== null);
  // Both tables read the leads (read Lead): without the permission the board says so once
  const forbidden = qrState === 'forbidden' && agencyState === 'forbidden';

  return (
    <FigureBoard
      title={tBoard('board')}
      summary={tBoard('summary')}
      state={forbidden ? 'forbidden' : 'ready'}
      hint={tBoard('hint')}
      links={[
        { href: '/settings/qr-campaigns', label: tBoard('openQr') },
        { href: '/analytics', label: t('openAnalytics') },
      ]}
      onLeave={onLeave}
    >
      <CampaignSection
        title={tBoard('qr.title')}
        period={tBoard('qr.period')}
        state={qrState}
        emptyText={qrState === 'ready' && qrRows.length === 0 ? tBoard('qr.empty') : undefined}
      >
        <table className={TABLE}>
          <caption className="sr-only">{tBoard('qr.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(HEAD, 'text-left')}>
                {tBoard('qr.columns.campaign')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tBoard('qr.columns.scans')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tBoard('qr.columns.newLeads')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tBoard('qr.columns.rate')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tBoard('qr.columns.interested')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tBoard('qr.columns.consultation')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tBoard('qr.columns.existing')}
              </th>
            </tr>
          </thead>
          <tbody>
            {qrRows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className={cn(CELL, 'min-w-[7.5rem] text-left font-bold')}>
                  {row.name}
                  {row.closed && (
                    <span className="ml-2 inline-block text-xs font-normal whitespace-nowrap text-[#d8d2c4]">
                      {tBoard('qr.closed')}
                    </span>
                  )}
                </th>
                <td className={cn(CELL, NUM)}>{format.number(row.scans)}</td>
                <td className={cn(CELL, NUM)}>{format.number(row.newLeads)}</td>
                <td className={cn(CELL, NUM)}>{percent(row.newLeadRate)}</td>
                <td className={cn(CELL, NUM)}>
                  {row.breakdown ? format.number(row.breakdown.interestedNewLeads) : none}
                </td>
                <td className={cn(CELL, NUM)}>
                  {row.breakdown ? format.number(row.breakdown.consultationNewLeads) : none}
                </td>
                <td className={cn(CELL, NUM)}>
                  {row.breakdown ? format.number(row.breakdown.existingLeadAnswers) : none}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1 pt-3 text-xs leading-relaxed text-[#d8d2c4]">
          <p>{tBoard('qr.note')}</p>
          {(breakdownState === 'error' || breakdownState === 'forbidden') && (
            <p>{tBoard('qr.breakdownUnavailable')}</p>
          )}
        </div>
      </CampaignSection>

      <CampaignSection
        title={tBoard('agencies.title')}
        period={t('periodOnly', { days })}
        state={agencyState}
        emptyText={
          agencyState === 'ready' && agencyRows.length === 0
            ? tBoard('agencies.empty', { days })
            : undefined
        }
      >
        <table className={TABLE}>
          <caption className="sr-only">{tBoard('agencies.caption', { days })}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(HEAD, 'text-left')}>
                {tBoard('agencies.columns.agency')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tSources('columns.leads')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tSources('columns.sql')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tBoard('agencies.columns.sqlRate')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tSources('columns.won')}
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {tSources('columns.cost')}
              </th>
              {returns && (
                <>
                  <th scope="col" className={cn(HEAD, 'text-right')}>
                    {tSources('columns.wonAmount')}
                  </th>
                  <th scope="col" className={cn(HEAD, 'text-right')}>
                    {tSources('columns.roi')}
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {agencyRows.map((row) => (
              <tr key={row.agencyName}>
                <th scope="row" className={cn(CELL, 'min-w-[7.5rem] text-left font-bold')}>
                  {row.agencyName}
                </th>
                <td className={cn(CELL, NUM)}>{format.number(row.leadCount)}</td>
                <td className={cn(CELL, NUM)}>{format.number(row.sqlCount)}</td>
                <td className={cn(CELL, NUM)}>{percent(Math.round(row.sqlRate))}</td>
                <td className={cn(CELL, NUM)}>{format.number(row.wonCount)}</td>
                <td className={cn(CELL, NUM)}>{yen(row.totalCost)}</td>
                {returns && (
                  <>
                    <td className={cn(CELL, NUM)}>{row.deals ? yen(row.deals.wonAmount) : none}</td>
                    <td className={cn(CELL, NUM)}>
                      {row.deals?.roi == null
                        ? none
                        : tSources('roiValue', { value: row.deals.roi })}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1 pt-3 text-xs leading-relaxed text-[#d8d2c4]">
          <p>{tBoard('agencies.note')}</p>
          {returns && <p>{tSources('returns')}</p>}
        </div>
      </CampaignSection>
    </FigureBoard>
  );
}
