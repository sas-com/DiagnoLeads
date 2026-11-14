'use client';

import type {
  AcquisitionCostSummary,
  ConversionFunnelData,
  DealReturns,
} from '@/lib/features/analytics/types/schemas';
import { cn } from '@/lib/utils';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FOCUS } from './office-hud';
import {
  type FigureState,
  MARKETING_RANGE_DAYS,
  UNSET_SOURCE,
  progressRows,
  showsDealReturns,
  sourceRows,
  uncostedLeads,
} from './office-marketing';
import { ROOM_BOARD, RoomBoardLoading, RoomBoardMessage } from './office-room-parts';

/**
 * The boards of figures of the marketing room (#1200): where the prospects of the period came
 * from, and how far they got. They show what the analytics API answered and nothing else; the
 * API scopes the figures to the organization and checks the permission. Nothing on them is
 * carried out: the period and the finer breakdowns stay on the analytics page of the normal view.
 */

/** The frame the boards of figures share: title, period, what stands in for the rows, the way out */
function FigureBoard({
  title,
  state,
  count,
  notes,
  onLeave,
  children,
}: {
  title: string;
  state: FigureState;
  /** Prospects of the period; 0 shows the empty board */
  count: number;
  /** What the figures mean, under the table */
  notes?: ReactNode;
  /** The analytics page is opened in the normal view: the office closes */
  onLeave: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('aiOffice.immersive.room.marketing');
  const locale = useLocale();
  const days = MARKETING_RANGE_DAYS;
  return (
    <section aria-label={title} aria-busy={state === 'loading'} className={ROOM_BOARD}>
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
        <h2 className="text-xl font-bold">{title}</h2>
        {/* Plain words: the board is made anew at each change, so the room's panel, which stays,
            is the one that says which board is on the wall */}
        <p className="text-sm text-[#d8d2c4]">
          {state === 'ready' ? t('period', { days, count }) : t('periodOnly', { days })}
        </p>
      </header>

      {state === 'forbidden' ? (
        <RoomBoardMessage>{t('forbidden')}</RoomBoardMessage>
      ) : state === 'error' ? (
        <RoomBoardMessage>{t('error')}</RoomBoardMessage>
      ) : state === 'loading' ? (
        <RoomBoardLoading>{t('loading')}</RoomBoardLoading>
      ) : count === 0 ? (
        <RoomBoardMessage>{t('empty', { days })}</RoomBoardMessage>
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

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
        <p className="text-xs">{t('analyticsHint')}</p>
        <Link
          href={`/${locale}/analytics`}
          onClick={onLeave}
          className={cn(
            'inline-flex min-h-11 items-center underline underline-offset-4 hover:text-white',
            FOCUS
          )}
        >
          {t('openAnalytics')}
        </Link>
      </footer>
    </section>
  );
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
  onLeave,
}: {
  state: FigureState;
  cost: AcquisitionCostSummary | undefined;
  onLeave: () => void;
}) {
  const tSources = useTranslations('aiOffice.immersive.room.marketing.sources');
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

  return (
    <FigureBoard
      title={tSources('board')}
      state={state}
      count={cost?.leadCount ?? 0}
      onLeave={onLeave}
      notes={
        <>
          <p>{uncosted > 0 ? tSources('uncosted', { count: uncosted }) : tSources('costed')}</p>
          {returns && <p>{tSources('returns')}</p>}
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
                {label(row.source)}
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
  const format = useFormatter();
  const rows = funnel ? progressRows(funnel) : [];
  const percent = (value: number) => tFunnel('percent', { value });

  return (
    <FigureBoard
      title={tFunnel('board')}
      state={state}
      count={funnel?.totalLeads ?? 0}
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
