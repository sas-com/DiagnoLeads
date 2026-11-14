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
export const DEAL_BOARD_VIEWS = ['thisWeek', 'noNextAction', 'mine', 'all'] as const;
export type DealBoardView = (typeof DEAL_BOARD_VIEWS)[number];

/** The view the board opens on: what has to move by the end of this week */
export const DEAL_BOARD_FIRST_VIEW: DealBoardView = 'thisWeek';

/** Rows of the board per page: what fits on the wall without scrolling */
export const DEAL_BOARD_PAGE_SIZE = 8;

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

/** The Sunday that ends the week (Monday to Sunday) of a Japan calendar day ('YYYY-MM-DD') */
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

/** Whether a deal's expected close date falls by the end of this week (or has passed) */
export function closesThisWeek(deal: Pick<BoardDeal, 'expectedCloseOn'>, today: string): boolean {
  return deal.expectedCloseOn !== null && deal.expectedCloseOn <= endOfWeek(today);
}

/** Whether a deal has to move by the end of this week (what is already late counts) */
export function movesThisWeek(
  deal: Pick<BoardDeal, 'nextTask' | 'expectedCloseOn'>,
  today: string
): boolean {
  const day = dealMoveDay(deal);
  return day !== null && day <= endOfWeek(today);
}

/**
 * The deals a view shows. "This week" lists the earliest day first; the others keep the order of
 * the stages. "Mine" is everything of a board read for the user's own deals.
 */
export function dealsOfView(
  view: DealBoardView,
  columns: readonly DealBoardColumn[],
  today: string
): BoardDeal[] {
  const deals = openDeals(columns);
  if (view === 'thisWeek') {
    return deals
      .filter((deal) => movesThisWeek(deal, today))
      .sort((a, b) => (dealMoveDay(a) ?? '').localeCompare(dealMoveDay(b) ?? ''));
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
  thisWeek: number;
  noNextAction: number;
}

export function dealReport(columns: readonly DealBoardColumn[], today: string): DealReport {
  const stages = stageTotals(columns);
  const deals = openDeals(columns);
  return {
    open: stages.reduce((sum, stage) => sum + stage.count, 0),
    amount: stages.reduce((sum, stage) => sum + stage.amount, 0),
    thisWeek: deals.filter((deal) => movesThisWeek(deal, today)).length,
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

/** The kind of the answer carried out last over a deal file, while it stands (not undone) */
export type DealFileLast = 'moved' | 'done' | 'added';

/**
 * Whether an answer over a deal file is carried out right now. After an answer, the answers of
 * its kind are closed until it is undone or the file is opened again, so the same key pressed
 * once too often never moves the deal two stages or marks the following next action unseen; the
 * other kinds stay open, so a next action is marked, a new one set and the deal moved on in one
 * sitting. A next action that was just set is not marked as done by the next key either. The undo
 * takes back the last answer only, while there is something to take back (a move that handed the
 * lead off is not: the handoff sheet went out; a next action that was typed is changed, not
 * undone).
 */
export function dealActionOpen(
  action: DealFileAction,
  state: {
    canEdit: boolean;
    busy: boolean;
    /** The answer carried out last and not undone */
    last: DealFileLast | null;
    /** That answer can be taken back */
    undoable: boolean;
    stage: DealStage;
    /** The deal's lead has an open next action */
    hasTask: boolean;
  }
): boolean {
  if (state.busy || !state.canEdit) return false;
  if (action === 'undo') return state.last !== null && state.undoable;
  if ((action === 'advance' || action === 'back') && state.last === 'moved') return false;
  if (action === 'done' && state.last !== null && state.last !== 'moved') return false;
  if (action === 'advance') return stageAfter(state.stage) !== null;
  if (action === 'back') return stageBefore(state.stage) !== null;
  if (action === 'done') return state.hasTask;
  return isOpenStage(state.stage);
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
