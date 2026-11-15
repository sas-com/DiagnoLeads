/**
 * The sales floor of the full-screen office (#1171): what its board shows, what it reports, and
 * what the keys of an open deal file do. The board is `deals.board` as it is: the room adds no
 * API, and every figure is counted from the deals that query returned.
 *
 * Pure functions only.
 */
import {
  type DealStage,
  OPEN_DEAL_STAGES,
  type OpenDealStage,
  isOpenStage,
} from '@/lib/features/deals/types/pipeline';
import type { BoardInput } from '@/lib/features/deals/types/schemas';
import { addDays } from '@/lib/features/lead-follow-up/due';
import type { RouterOutputs } from '@/lib/trpc/client';
import { actionOfKey } from '../office-rooms';

export type DealBoardData = RouterOutputs['deals']['board'];
export type DealBoardColumn = DealBoardData['columns'][number];
export type BoardDeal = DealBoardColumn['deals'][number];

/** What the deal board can show */
export const DEAL_BOARD_VIEWS = ['soon', 'noNextAction', 'mine', 'all'] as const;
export type DealBoardView = (typeof DEAL_BOARD_VIEWS)[number];

/** The view the board opens on: what has to move within a week, with what is already late */
export const DEAL_BOARD_FIRST_VIEW: DealBoardView = 'soon';

/**
 * Rows of the board per page: what fits on the wall without scrolling on a screen 768px high,
 * where a row with a next action and an expected close date takes three lines (measured in a
 * browser, #1205: eight rows did not fit)
 */
export const DEAL_BOARD_PAGE_SIZE = 6;

/** The view a number key chooses (1 is the first), if any */
export function dealBoardViewOfKey(key: string): DealBoardView | null {
  if (!/^[1-9]$/.test(key)) return null;
  return DEAL_BOARD_VIEWS[Number(key) - 1] ?? null;
}

/** Whose deals a view reads: the user's own, or everyone's */
export function dealBoardOwner(view: DealBoardView): 'mine' | 'all' {
  return view === 'mine' ? 'mine' : 'all';
}

/**
 * Input of `deals.board` for the room. The room works on the open deals only, so the won and
 * lost ones of the last days are left out (those closed today still come, and are not shown).
 */
export function dealBoardInput(
  owner: 'mine' | 'all',
  organizationId: string
): Pick<BoardInput, 'organizationId' | 'owner' | 'closedWithinDays'> {
  return { organizationId, owner, closedWithinDays: 0 };
}

/**
 * The Sunday that ends the week (Monday to Sunday) of a Japan calendar day ('YYYY-MM-DD'): for
 * the "next Monday" of the due days
 */
export function endOfWeek(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, weekday === 0 ? 0 : 7 - weekday);
}

/** The open deals of the board, in the order of the stages and, within one, of the board */
export function openDeals(columns: readonly DealBoardColumn[]): BoardDeal[] {
  return OPEN_DEAL_STAGES.flatMap(
    (stage) => columns.find((column) => column.stage === stage)?.deals ?? []
  );
}

/**
 * The day a deal has to move by: its next action's due day or its expected close date, whichever
 * comes first; null when it has neither
 */
export function dealMoveDay(deal: Pick<BoardDeal, 'nextTask' | 'expectedCloseOn'>): string | null {
  const days = [deal.nextTask?.dueOn, deal.expectedCloseOn].filter(
    (day): day is string => typeof day === 'string'
  );
  return days.length === 0 ? null : days.reduce((first, day) => (day < first ? day : first));
}

/** Days ahead the board looks for what has to move: the same on every day of the week */
export const MOVE_HORIZON_DAYS = 7;

/**
 * The last day of "within a week", from a Japan calendar day ('YYYY-MM-DD'): the same weekday of
 * the week after. Not the end of the calendar week (#1205): that looked seven days ahead on a
 * Monday and one on a Sunday, so the start of the following week went unseen on a Friday, and a
 * next action set for "next Monday" left the view at once.
 */
export function moveHorizon(today: string): string {
  return addDays(today, MOVE_HORIZON_DAYS);
}

/** Whether a deal's expected close date falls within a week (or has passed) */
export function closesSoon(deal: Pick<BoardDeal, 'expectedCloseOn'>, today: string): boolean {
  return deal.expectedCloseOn !== null && deal.expectedCloseOn <= moveHorizon(today);
}

/** Whether a deal has to move within a week (what is already late counts) */
export function movesSoon(
  deal: Pick<BoardDeal, 'nextTask' | 'expectedCloseOn'>,
  today: string
): boolean {
  const day = dealMoveDay(deal);
  return day !== null && day <= moveHorizon(today);
}

/** Whether the day a deal had to move by has passed: what the president acts on first */
export function isOverdue(
  deal: Pick<BoardDeal, 'nextTask' | 'expectedCloseOn'>,
  today: string
): boolean {
  const day = dealMoveDay(deal);
  return day !== null && day < today;
}

/**
 * The deals a view shows. "Within a week" lists the earliest day first (so what is late leads),
 * and the larger amount first among those of one day; the others keep the order of the stages.
 * "Mine" is everything of a board read for the user's own deals.
 */
export function dealsOfView(
  view: DealBoardView,
  columns: readonly DealBoardColumn[],
  today: string
): BoardDeal[] {
  const deals = openDeals(columns);
  if (view === 'soon') {
    return deals
      .filter((deal) => movesSoon(deal, today))
      .sort(
        (a, b) =>
          (dealMoveDay(a) ?? '').localeCompare(dealMoveDay(b) ?? '') ||
          (b.amount ?? 0) - (a.amount ?? 0)
      );
  }
  if (view === 'noNextAction') return deals.filter((deal) => !deal.hasOpenTask);
  return deals;
}

/** What the room reports: counted from the board, nothing else */
export interface DealReport {
  /** Open deals (the stages' own totals: they count the deals a long board does not list) */
  open: number;
  /** Their amounts added up, in yen */
  amount: number;
  /** Past the day they had to move by */
  overdue: number;
  /** To move within a week, not counting what is already late */
  soon: number;
  noNextAction: number;
}

export function dealReport(columns: readonly DealBoardColumn[], today: string): DealReport {
  const stages = stageTotals(columns);
  const deals = openDeals(columns);
  return {
    open: stages.reduce((sum, stage) => sum + stage.count, 0),
    amount: stages.reduce((sum, stage) => sum + stage.amount, 0),
    overdue: deals.filter((deal) => isOverdue(deal, today)).length,
    soon: deals.filter((deal) => movesSoon(deal, today) && !isOverdue(deal, today)).length,
    noNextAction: deals.filter((deal) => !deal.hasOpenTask).length,
  };
}

/** Each open stage with how many deals it holds and their amounts, in sales order */
export function stageTotals(
  columns: readonly DealBoardColumn[]
): { stage: OpenDealStage; count: number; amount: number }[] {
  return OPEN_DEAL_STAGES.map((stage) => {
    const column = columns.find((entry) => entry.stage === stage);
    return { stage, count: column?.count ?? 0, amount: column?.amount ?? 0 };
  });
}

/** Pages of the board for a total; an empty board still has its first page */
export function dealBoardPages(total: number): number {
  return Math.max(1, Math.ceil(total / DEAL_BOARD_PAGE_SIZE));
}

/** The rows of a page (1 is the first) */
export function dealBoardPage<Row>(rows: readonly Row[], page: number): Row[] {
  return rows.slice((page - 1) * DEAL_BOARD_PAGE_SIZE, page * DEAL_BOARD_PAGE_SIZE);
}

/** The open stage after this one; null from the last open stage (winning asks for more) */
export function stageAfter(stage: DealStage): OpenDealStage | null {
  if (!isOpenStage(stage)) return null;
  return OPEN_DEAL_STAGES[OPEN_DEAL_STAGES.indexOf(stage) + 1] ?? null;
}

/** The open stage before this one; null from the first */
export function stageBefore(stage: DealStage): OpenDealStage | null {
  if (!isOpenStage(stage)) return null;
  return OPEN_DEAL_STAGES[OPEN_DEAL_STAGES.indexOf(stage) - 1] ?? null;
}

/**
 * What a key of an open deal file does: move the deal on or back by one open stage, mark its next
 * action as done, open the field that sets a next action, or take the last answer back
 */
export type DealFileAction = 'advance' | 'back' | 'done' | 'add' | 'undo';

/** The answers of a deal file that are listed as choices, in the order of their keys */
export const DEAL_FILE_CHOICES = [
  'advance',
  'back',
  'done',
  'add',
] as const satisfies readonly DealFileAction[];

/**
 * The key of each answer over a deal file: fixed, like the keys of a customer file (`FILE_KEYS`).
 * A number never turns into the way back or the undo.
 */
export const DEAL_KEYS: Readonly<Record<DealFileAction, string>> = {
  advance: '1',
  back: '2',
  done: '3',
  add: '4',
  undo: 'Z',
};

/** The answer a key stands for, whether it is open right now or not */
export function dealActionOfKey(key: string): DealFileAction | null {
  return actionOfKey(DEAL_KEYS, key);
}

/** The kinds of answers of a deal file that are carried out with a key and close after it */
export type DealAnswerKind = 'moved' | 'done';

/**
 * Whether an answer over a deal file is carried out right now. An answer closes the answers of
 * its kind for as long as the file is open: once the deal was moved, it is not moved again, and
 * once a next action was marked (or a new one set), none is marked again, whatever was answered
 * in between. So keys pressed in a row never move the deal two stages, and never mark a next
 * action that came up unseen. The other kind stays open, so a next action is marked, a new one
 * set and the deal moved on in one sitting. Undoing an answer opens its kind again. The undo
 * takes back the last answer only, while there is something to take back (a move that handed the
 * lead off is not: the handoff sheet went out; a next action that was typed is changed, not
 * undone), and never over a deal that is closed by now.
 */
export function dealActionOpen(
  action: DealFileAction,
  state: {
    canEdit: boolean;
    busy: boolean;
    /** The kinds answered since the file was opened, and not undone */
    closed: ReadonlySet<DealAnswerKind>;
    /** The last answer can be taken back */
    canUndo: boolean;
    stage: DealStage;
    /** The deal's lead has an open next action */
    hasTask: boolean;
  }
): boolean {
  if (state.busy || !state.canEdit || !isOpenStage(state.stage)) return false;
  if (action === 'undo') return state.canUndo;
  if (action === 'advance') return !state.closed.has('moved') && stageAfter(state.stage) !== null;
  if (action === 'back') return !state.closed.has('moved') && stageBefore(state.stage) !== null;
  if (action === 'done') return !state.closed.has('done') && state.hasTask;
  return true;
}

/** The due days a next action is given most often, offered beside the date field */
export const DUE_SHORTCUTS = ['tomorrow', 'in3Days', 'nextMonday'] as const;
export type DueShortcut = (typeof DUE_SHORTCUTS)[number];

/** Each shortcut's day, from a Japan calendar day ('YYYY-MM-DD'): next Monday is never today */
export function dueShortcuts(today: string): { key: DueShortcut; day: string }[] {
  return [
    { key: 'tomorrow', day: addDays(today, 1) },
    { key: 'in3Days', day: addDays(today, 3) },
    { key: 'nextMonday', day: addDays(endOfWeek(today), 1) },
  ];
}
