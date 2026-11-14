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
  QrCampaignBreakdown,
} from '@/lib/features/analytics/types/schemas';
import {
  DEFAULT_LEAD_SORT,
  EMPTY_LEAD_FILTERS,
  type LeadListFilters,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import { INFLOW_SOURCES, type InflowSource } from '@/lib/features/leads/types/pipeline';
import type { ListLeadsInput } from '@/lib/features/leads/types/schemas';
import { dashboardPeriod, jstDay } from '@/lib/jst';
import { LEAD_BOARD_PAGE_SIZE, LEAD_BOARD_VIEWS, type LeadBoardView } from './office-rooms';

/** The period of the room's figures: prospects created in the last 30 days (Japan days) */
export const MARKETING_RANGE = '30d' as const satisfies DateRange;
/** The same period in days, for the words of the room */
export const MARKETING_RANGE_DAYS = 30;

/**
 * The boards of figures: where the prospects came from, how far they got, and what each campaign
 * brought (QR campaigns and sales agencies, #1201)
 */
export const MARKETING_FIGURE_BOARDS = ['sources', 'funnel', 'campaigns'] as const;
export type MarketingFigureBoard = (typeof MARKETING_FIGURE_BOARDS)[number];

/** What the president can ask the room for: a board of figures, or a view of the lead board */
export type MarketingChoice = MarketingFigureBoard | LeadBoardView;

/**
 * The choices in the order of their keys (1 is the first). A key keeps its meaning whichever
 * board is on the wall. From here on, a new choice is added at the end, so no key changes its
 * meaning again (the views of the lead board moved from 1-5 to 3-7 once, in #1200, a day after
 * the room was built). So the campaign board, added in #1201, is 8 although it is shown with the
 * other boards of figures.
 */
export const MARKETING_CHOICES: readonly MarketingChoice[] = [
  'sources',
  'funnel',
  ...LEAD_BOARD_VIEWS,
  'campaigns',
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

/**
 * The Japan day the period of the room starts on ('YYYY-MM-DD'): the same instant the analytics
 * API counts from (analyticsPeriodStart of the same range), as the lead list takes it
 */
export function marketingPeriodFromDay(now: Date): string {
  return jstDay(dashboardPeriod(MARKETING_RANGE_DAYS, now).from);
}

/**
 * The source of a row as the lead list can filter by it (#1202), or null when it cannot: the
 * prospects without a recorded source, and values outside the list of sources, have no filter in
 * `leads.list`, and no API is added for a room
 */
export function openableSource(source: string): InflowSource | null {
  return (INFLOW_SOURCES as readonly string[]).includes(source) ? (source as InflowSource) : null;
}

/** The filters of the lead board opened from a row of the source board: that source, that period */
export function sourceLeadFilters(source: InflowSource, now: Date): LeadListFilters {
  return {
    ...EMPTY_LEAD_FILTERS,
    inflowSource: [source],
    createdFrom: marketingPeriodFromDay(now),
  };
}

/** Input of `leads.list` for a page of the lead board with these filters, newest first */
export function leadBoardInputFor(
  filters: LeadListFilters,
  page: number,
  organizationId: string
): ListLeadsInput {
  return toListLeadsInput(
    { filters, sort: DEFAULT_LEAD_SORT, page },
    organizationId,
    LEAD_BOARD_PAGE_SIZE
  );
}

/** What the campaign board reads of a QR campaign (a row of `distribution.listCampaigns`) */
export interface QrCampaignFigures {
  id: string;
  name: string;
  scanCount: number;
  /** New leads created from the campaign's code */
  completionCount: number;
  isActive: boolean;
  /** Where a scan goes; 'none' when the campaign takes no answers (stopped, expired, ...) */
  destination: { kind: string };
}

/** A row of the QR campaigns on the campaign board */
export interface QrCampaignRow {
  id: string;
  name: string;
  /** Scans lead nowhere now: stopped, expired or without a diagnosis */
  closed: boolean;
  scans: number;
  newLeads: number;
  /** newLeads out of scans in whole percent; null without a scan */
  newLeadRate: number | null;
  /**
   * What the answers with the campaign's code add; null while the breakdown is not read (a
   * campaign no answer has reached has zeros)
   */
  breakdown: Pick<
    QrCampaignBreakdown,
    'interestedNewLeads' | 'consultationNewLeads' | 'existingLeadAnswers'
  > | null;
}

const NO_ANSWERS = { interestedNewLeads: 0, consultationNewLeads: 0, existingLeadAnswers: 0 };

/**
 * The rows of the QR campaigns, in the order the API lists them (newest first). The scans and the
 * new leads are the campaign's own counts; the breakdown comes from the analytics API and is left
 * out (`null`) while it is not there.
 */
export function qrCampaignRows(
  campaigns: readonly QrCampaignFigures[],
  breakdowns: readonly QrCampaignBreakdown[] | undefined
): QrCampaignRow[] {
  const byId = new Map(breakdowns?.map((row) => [row.campaignId, row]));
  return campaigns.map((campaign) => {
    const found = byId.get(campaign.id);
    return {
      id: campaign.id,
      name: campaign.name,
      closed: !campaign.isActive || campaign.destination.kind === 'none',
      scans: campaign.scanCount,
      newLeads: campaign.completionCount,
      newLeadRate:
        campaign.scanCount > 0
          ? Math.round((campaign.completionCount / campaign.scanCount) * 100)
          : null,
      breakdown: breakdowns
        ? found
          ? {
              interestedNewLeads: found.interestedNewLeads,
              consultationNewLeads: found.consultationNewLeads,
              existingLeadAnswers: found.existingLeadAnswers,
            }
          : NO_ANSWERS
        : null,
    };
  });
}
