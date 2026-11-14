/**
 * The engineering room of the full-screen office (#1194): its wall board is the deals that survey
 * a customer's current system, the engineer's share of the pipeline, and a row opens the
 * preparation file of its lead (the latest hearing and the prep card of the first meeting).
 *
 * The board reads `deals.board` as it is (decision 2026-11-13-office-is-the-base: no API is added
 * for a room). Pure functions only.
 */
import type { DealCard } from '@/lib/features/deals/service';
import {
  type DealKind,
  OPEN_DEAL_STAGES,
  type OpenDealStage,
} from '@/lib/features/deals/types/pipeline';
import type { BoardInput } from '@/lib/features/deals/types/schemas';

/** The deals of the room: surveys of the current system */
export const SURVEY_BOARD_KINDS = ['survey'] as const satisfies readonly DealKind[];

/**
 * The same deals in the normal view (without the language): the page the door of the room opened
 * before the room was built (#1162). A fixed path of this app.
 */
export const SURVEY_BOARD_PAGE = '/deals?kind=survey';

/** What the board can show: every open survey, or the ones of one stage */
export const SURVEY_BOARD_VIEWS = ['open', ...OPEN_DEAL_STAGES] as const;
export type SurveyBoardView = (typeof SURVEY_BOARD_VIEWS)[number];

/** The view the board opens on */
export const SURVEY_BOARD_FIRST_VIEW: SurveyBoardView = 'open';

/** Rows of the board per page: what fits on the wall without scrolling */
export const SURVEY_BOARD_PAGE_SIZE = 8;

/**
 * Input of `deals.board` for the room: everyone's open surveys. Won and lost ones are left out
 * (closed today still come back with 0 days; the room only reads the open stages).
 */
export function surveyBoardInput(organizationId: string): BoardInput {
  return { organizationId, owner: 'all', kinds: [...SURVEY_BOARD_KINDS], closedWithinDays: 0 };
}

/** The part of the board's answer the room reads */
export interface SurveyBoardColumn {
  stage: string;
  count: number;
  deals: DealCard[];
}

const isOpen = (stage: string): stage is OpenDealStage =>
  (OPEN_DEAL_STAGES as readonly string[]).includes(stage);

/** The view a number key chooses (1 is the first), if any */
export function surveyViewOfKey(key: string): SurveyBoardView | null {
  if (!/^[1-9]$/.test(key)) return null;
  return SURVEY_BOARD_VIEWS[Number(key) - 1] ?? null;
}

/** The rows of a view, in the order of the pipeline (the board's own order inside a stage) */
export function surveyRows(
  columns: readonly SurveyBoardColumn[],
  view: SurveyBoardView
): DealCard[] {
  return OPEN_DEAL_STAGES.filter((stage) => view === 'open' || view === stage).flatMap(
    (stage) => columns.find((column) => column.stage === stage)?.deals ?? []
  );
}

/** What the room reports: figures of the board, nothing an AI employee did */
export interface SurveyReport {
  /** Open surveys, every one counted (also past the board's limit) */
  open: number;
  /** The ones in the proposal stage: the proposal is being prepared */
  proposal: number;
  /** Listed ones whose lead has no open next action */
  withoutTask: number;
}

export function surveyReport(columns: readonly SurveyBoardColumn[]): SurveyReport {
  const open = columns.filter((column) => isOpen(column.stage));
  return {
    open: open.reduce((sum, column) => sum + column.count, 0),
    proposal: open.find((column) => column.stage === 'proposal')?.count ?? 0,
    withoutTask: open.reduce(
      (sum, column) => sum + column.deals.filter((deal) => !deal.hasOpenTask).length,
      0
    ),
  };
}

/** Pages of the board for a number of rows; an empty board still has its first page */
export function surveyBoardPages(rows: number): number {
  return Math.max(1, Math.ceil(rows / SURVEY_BOARD_PAGE_SIZE));
}

/** The rows of a page (1 is the first); a page past the end shows the last one */
export function surveyPageRows<Row>(rows: readonly Row[], page: number): Row[] {
  const shown = Math.max(1, Math.min(surveyBoardPages(rows.length), page));
  return rows.slice((shown - 1) * SURVEY_BOARD_PAGE_SIZE, shown * SURVEY_BOARD_PAGE_SIZE);
}

/** Whole days a deal has been in its stage; 0 for a date that cannot be read or lies ahead */
export function daysInStage(stageChangedAt: Date | string, now: Date): number {
  const days = (now.getTime() - new Date(stageChangedAt).getTime()) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
}

/** The parts of a preparation file, in the order of their keys */
export const PREP_FILE_PARTS = ['hearing', 'prep'] as const;
export type PrepFilePart = (typeof PREP_FILE_PARTS)[number];

/** The part a number key shows (1 is the first), if any */
export function prepPartOfKey(key: string): PrepFilePart | null {
  if (!/^[1-9]$/.test(key)) return null;
  return PREP_FILE_PARTS[Number(key) - 1] ?? null;
}

/** Whether a prep card says anything: one saved empty is the same as none */
export function prepCardFilled(card: {
  estimatedSystem: string | null;
  estimatedSystemBasis: string | null;
  recentNews: string | null;
  hypotheses: Partial<Record<string, string>>;
  firstQuestions: readonly string[];
}): boolean {
  return Boolean(
    card.estimatedSystem ||
      card.estimatedSystemBasis ||
      card.recentNews ||
      Object.values(card.hypotheses).some(Boolean) ||
      card.firstQuestions.length > 0
  );
}
