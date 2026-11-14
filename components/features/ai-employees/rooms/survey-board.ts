/**
 * The engineering room of the full-screen office (#1194): its wall board is the deals that survey
 * a customer's current system, the engineer's share of the pipeline, and a row opens the
 * preparation file of its lead (the latest hearing and the prep card of the first meeting), where
 * the president can have the card drafted (#1212).
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
import {
  PREP_CHALLENGES,
  type PrepCardFields,
  prepCardFieldsSchema,
} from '@/lib/features/lead-prep/types/schemas';

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

/** What the president can have done from a preparation file (#1212) */
export type PrepFileAction = 'draft' | 'undo';

/**
 * The key of each answer over a preparation file. The numbers 1 and 2 turn to a part of the file
 * and change nothing; the draft has its own number, the undo is Z and the way back is Esc, so no
 * key means two things (decision 2026-11-13-office-is-the-base).
 */
export const PREP_FILE_KEYS: Readonly<Record<PrepFileAction, string>> = {
  draft: '3',
  undo: 'Z',
};

/** The answer a key stands for, whether it is open right now or not */
export function prepActionOfKey(key: string): PrepFileAction | null {
  const pressed = key.toUpperCase();
  return (
    (Object.keys(PREP_FILE_KEYS) as PrepFileAction[]).find(
      (action) => PREP_FILE_KEYS[action] === pressed
    ) ?? null
  );
}

/** The fields of a prep card that are saved; a lead without a card has them all empty */
export function prepCardFields(card: PrepCardFields | null | undefined): PrepCardFields {
  return {
    estimatedSystem: card?.estimatedSystem ?? null,
    estimatedSystemBasis: card?.estimatedSystemBasis ?? null,
    recentNews: card?.recentNews ?? null,
    hypotheses: { ...card?.hypotheses },
    firstQuestions: [...(card?.firstQuestions ?? [])],
  };
}

/**
 * A card as the server stores it: the input check of `leadPrep.save` trims every text and drops
 * what is empty. A draft is compared with the card read back, so it is put in that form first:
 * otherwise a question cut at its limit with a space at its end would never match (#1221).
 */
export function savedPrepCard(card: PrepCardFields): PrepCardFields {
  return prepCardFieldsSchema.parse(card);
}

/** Whether two cards say the same: a draft that fills nothing is not worth saving */
export function samePrepCard(a: PrepCardFields, b: PrepCardFields): boolean {
  const text = (card: PrepCardFields) =>
    JSON.stringify([
      card.estimatedSystem,
      card.estimatedSystemBasis,
      card.recentNews,
      PREP_CHALLENGES.map((challenge) => card.hypotheses[challenge] ?? null),
      card.firstQuestions,
    ]);
  return text(a) === text(b);
}

/**
 * Whether an answer over a preparation file is carried out right now. The draft is taken once:
 * after it, it stays closed until it is undone or the file is opened again, so the same key
 * pressed once too often does nothing. It is also closed while there is nothing to fill. The undo
 * is only open right after a draft, and only while the card still says what the draft saved: once
 * somebody changed it, saving the old card back would wipe what they wrote.
 */
export function prepActionOpen(
  action: PrepFileAction,
  state: { canEdit: boolean; drafted: boolean; busy: boolean; fillable: boolean; stale: boolean }
): boolean {
  if (state.busy || !state.canEdit) return false;
  return action === 'undo' ? state.drafted && !state.stale : !state.drafted && state.fillable;
}
