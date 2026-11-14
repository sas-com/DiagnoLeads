/**
 * The marketing room of the full-screen office as the marketer's room (#1200, Epic #1199): what
 * the room reports and which boards the president can ask for. The marketer finds prospects and
 * tells which ones are worth following, so the room reports where the prospects came from and how
 * far they got, next to the lead board.
 *
 * Every figure comes from the analytics API as it is (decision 2026-11-13-office-is-the-base: no
 * API is added for a room). Pure functions only.
 */
import type {
  AcquisitionCostRow,
  AcquisitionCostSummary,
  ConversionFunnelData,
  DateRange,
  FunnelStageName,
} from '@/lib/features/analytics/types/schemas';
import { LEAD_BOARD_VIEWS, type LeadBoardView } from './office-rooms';

/** The period of the room's figures: prospects created in the last 30 days (Japan days) */
export const MARKETING_RANGE = '30d' as const satisfies DateRange;
/** The same period in days, for the words of the room */
export const MARKETING_RANGE_DAYS = 30;

/** The boards of figures: where the prospects came from, and how far they got */
export const MARKETING_FIGURE_BOARDS = ['sources', 'funnel'] as const;
export type MarketingFigureBoard = (typeof MARKETING_FIGURE_BOARDS)[number];

/** What the president can ask the room for: a board of figures, or a view of the lead board */
export type MarketingChoice = MarketingFigureBoard | LeadBoardView;

/**
 * The choices in the order of their keys (1 is the first). A key keeps its meaning whichever
 * board is on the wall. From here on, a new choice is added at the end, so no key changes its
 * meaning again (the views of the lead board moved from 1-5 to 3-7 once, in #1200, a day after
 * the room was built).
 */
export const MARKETING_CHOICES: readonly MarketingChoice[] = [
  ...MARKETING_FIGURE_BOARDS,
  ...LEAD_BOARD_VIEWS,
];

/** The board the room opens on: the one the report is about */
export const MARKETING_FIRST_CHOICE: MarketingChoice = 'sources';

/** The key of a choice */
export function marketingChoiceKey(choice: MarketingChoice): string {
  return String(MARKETING_CHOICES.indexOf(choice) + 1);
}

/** The choice a number key stands for, if any */
export function marketingChoiceOfKey(key: string): MarketingChoice | null {
  if (!/^[1-9]$/.test(key)) return null;
  return MARKETING_CHOICES[Number(key) - 1] ?? null;
}

export function isLeadBoardView(choice: MarketingChoice): choice is LeadBoardView {
  return (LEAD_BOARD_VIEWS as readonly string[]).includes(choice);
}

/**
 * The bucket of the prospects without a recorded source, as the analytics API names it
 * (UNSET_INFLOW_SOURCE of lib/features/analytics/lead-sources.ts, which a screen cannot import)
 */
export const UNSET_SOURCE = 'unset';

/** What the room reports about the period */
export interface MarketingReport {
  /** Prospects created in the period */
  leads: number;
  /** Of them, those that reached MQL (関心あり) or went further */
  mql: number;
  /** Of them, those that reached a deal or went further */
  deals: number;
  /** The recorded source with the most prospects; null when no prospect has one */
  topSource: { source: string; count: number } | null;
  /** Prospects without a recorded source: said next to the largest source, never as one */
  withoutSource: number;
}

function reached(funnel: ConversionFunnelData, name: FunnelStageName): number {
  return funnel.stages.find((stage) => stage.name === name)?.cumulativeCount ?? 0;
}

/**
 * The report of the room, from the figures of the two boards and nothing else. The sources come
 * sorted by size with the unset bucket last, so the first recorded one is the largest.
 */
export function marketingReport(
  funnel: ConversionFunnelData,
  cost: AcquisitionCostSummary
): MarketingReport {
  const top = cost.bySource.find((row) => row.source !== UNSET_SOURCE && row.leadCount > 0);
  return {
    leads: funnel.totalLeads,
    mql: reached(funnel, 'mql'),
    deals: reached(funnel, 'deal'),
    topSource: top ? { source: top.source, count: top.leadCount } : null,
    withoutSource: cost.bySource.find((row) => row.source === UNSET_SOURCE)?.leadCount ?? 0,
  };
}

/** A row of the source board: a source with its share of the period's prospects */
export interface SourceRow extends AcquisitionCostRow {
  /** leadCount out of all prospects of the period, in whole percent */
  share: number;
}

/** The rows of the source board, in the order the API gives them (by size, unset last) */
export function sourceRows(cost: AcquisitionCostSummary): SourceRow[] {
  return cost.bySource.map((row) => ({
    ...row,
    share: cost.leadCount > 0 ? Math.round((row.leadCount / cost.leadCount) * 100) : 0,
  }));
}

/** Whether the board shows what the deals brought in: only to those the API answered with it */
export function showsDealReturns(cost: AcquisitionCostSummary): boolean {
  return cost.deals !== null;
}

/** Prospects of the period without a recorded acquisition cost (they add nothing to the cost) */
export function uncostedLeads(cost: AcquisitionCostSummary): number {
  return Math.max(0, cost.leadCount - cost.costedLeadCount);
}

/** A row of the progress board: a stage with the prospects that reached it */
export interface ProgressRow {
  name: FunnelStageName;
  /** Prospects that reached the stage (one that went further counts for the stages before) */
  reached: number;
  /** Out of all prospects of the period, in whole percent (the bar of the row) */
  ofAll: number;
  /** Out of the stage before, in whole percent; null for the first stage */
  fromPrevious: number | null;
}

/** The rows of the progress board, in the order of the lead lifecycle */
export function progressRows(funnel: ConversionFunnelData): ProgressRow[] {
  return funnel.stages.map((stage, index) => ({
    name: stage.name,
    reached: stage.cumulativeCount,
    ofAll: Math.round(stage.percentage),
    fromPrevious: index === 0 ? null : Math.round(stage.conversionRate),
  }));
}

/** Where a board of figures stands: still reading, not allowed, failed, or ready to show */
export type FigureState = 'loading' | 'forbidden' | 'error' | 'ready';

/** The state of a query of the analytics API, as a board shows it */
export function figureState(query: {
  data?: unknown;
  isError: boolean;
  error?: { data?: { code?: string } | null } | null;
}): FigureState {
  if (query.error?.data?.code === 'FORBIDDEN') return 'forbidden';
  if (query.isError) return 'error';
  return query.data === undefined ? 'loading' : 'ready';
}
