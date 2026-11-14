import type { DeskStatus } from '@/lib/features/ai-employees/office';
/**
 * The rooms of the full-screen office that hold work (#1127, decision
 * 2026-11-13-office-is-the-base): the business screens live inside the office. The marketing room
 * is the first: its wall board is the lead list. The reception (back office) hands over what is
 * due, one at a time (#1133). The engineering room shows the surveys of the current systems
 * (#1194; its pure functions are in rooms/survey-board.ts).
 *
 * Pure functions only.
 */
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import {
  DEFAULT_LEAD_SORT,
  EMPTY_LEAD_FILTERS,
  type LeadListFilters,
  type LeadListPreset,
  presetFilters,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import type { ListLeadsInput } from '@/lib/features/leads/types/schemas';

/** The rooms the president can walk into */
export const OFFICE_ROOMS = ['marketing', 'engineering', 'backoffice'] as const;
export type OfficeRoom = (typeof OFFICE_ROOMS)[number];

/** The AI employee each room belongs to */
export const ROOM_ROLES: Readonly<Record<OfficeRoom, AiEmployeeRole>> = {
  marketing: 'marketer',
  engineering: 'engineer',
  backoffice: 'back_office',
};

/**
 * Every place of the floor guide, in the order of its keys (#1162, Epic #1161): all the work of
 * the system is reached from the floor. A place whose room is not built yet is a door: entering it
 * opens its page of the normal view, until the room takes its place.
 */
export const FLOOR_PLACES = ['desk', 'marketing', 'sales', 'engineering', 'backoffice'] as const;
export type FloorPlace = (typeof FLOOR_PLACES)[number];
export type FloorDoor = Exclude<FloorPlace, OfficeRoom>;

/**
 * The key of each place. The numbers follow the floor guide of the design (1 the president's
 * desk, 2 marketing, 3 sales, 4 engineering, 5 reception): a place keeps its number when its room
 * opens.
 */
export const PLACE_KEYS: Readonly<Record<FloorPlace, string>> = {
  desk: '1',
  marketing: '2',
  sales: '3',
  engineering: '4',
  backoffice: '5',
};

/** The key that enters each room from the floor */
export const ROOM_KEYS: Readonly<Record<OfficeRoom, string>> = {
  marketing: PLACE_KEYS.marketing,
  engineering: PLACE_KEYS.engineering,
  backoffice: PLACE_KEYS.backoffice,
};

/**
 * The page of the normal view a door opens (without the language). Fixed paths of this app:
 * never built from what someone typed.
 */
export const DOOR_PAGES: Readonly<Record<FloorDoor, string>> = {
  // The president's day: what is planned and what is left to do
  desk: '/today',
  sales: '/deals',
};

export function isOfficeRoom(place: FloorPlace): place is OfficeRoom {
  return (OFFICE_ROOMS as readonly string[]).includes(place);
}

/** The place a key of the floor enters, if any */
export function placeOfKey(key: string): FloorPlace | null {
  return FLOOR_PLACES.find((place) => PLACE_KEYS[place] === key) ?? null;
}

/** The room a key of the floor enters, if any (a door is not a room) */
export function roomOfKey(key: string): OfficeRoom | null {
  const place = placeOfKey(key);
  return place && isOfficeRoom(place) ? place : null;
}

/** How the room's AI employee stands to what the room reports */
export type RoomGuide = 'employee' | 'attention' | 'training' | 'paused' | 'vacant';

/**
 * Who reads the room's figures to the president. Only an AI employee that works (or waits for
 * work) holds the room; one in training, paused or not hired does not, and the room says so
 * instead of putting words in its mouth.
 */
export function roomGuide(status: DeskStatus): RoomGuide {
  if (status === 'vacant') return 'vacant';
  if (status === 'paused') return 'paused';
  if (status === 'training') return 'training';
  // Its last run failed or hangs: it does not hold the room right now, and the room says so
  if (status === 'attention') return 'attention';
  return 'employee';
}

/** What the lead board can show: presets of the lead list, and everything */
export const LEAD_BOARD_VIEWS = [
  'needsAction',
  'consultation',
  'newThisWeek',
  'mine',
  'all',
] as const satisfies readonly (LeadListPreset | 'all')[];
export type LeadBoardView = (typeof LEAD_BOARD_VIEWS)[number];

/** The view the board opens on: what nobody has started on yet */
export const LEAD_BOARD_FIRST_VIEW: LeadBoardView = 'needsAction';

/** The views whose totals the room reports */
export const LEAD_REPORT_VIEWS = [
  'newThisWeek',
  'consultation',
  'needsAction',
] as const satisfies readonly LeadBoardView[];
export type LeadReportView = (typeof LEAD_REPORT_VIEWS)[number];

/** Rows of the board per page: what fits on the wall without scrolling */
export const LEAD_BOARD_PAGE_SIZE = 8;

/** The view a number key chooses (1 is the first), if any */
export function leadBoardViewOfKey(key: string): LeadBoardView | null {
  if (!/^[1-9]$/.test(key)) return null;
  return LEAD_BOARD_VIEWS[Number(key) - 1] ?? null;
}

/** The filters of a view, the same as the lead list's preset of that name */
export function leadBoardFilters(view: LeadBoardView, now: Date): LeadListFilters {
  return view === 'all' ? EMPTY_LEAD_FILTERS : presetFilters(view, now);
}

/** Input of `leads.list` for a page of the board (newest first, like the lead list) */
export function leadBoardInput(
  view: LeadBoardView,
  page: number,
  organizationId: string,
  now: Date
): ListLeadsInput {
  return toListLeadsInput(
    { filters: leadBoardFilters(view, now), sort: DEFAULT_LEAD_SORT, page },
    organizationId,
    LEAD_BOARD_PAGE_SIZE
  );
}

/** Input of `leads.list` that only asks how many leads a view holds */
export function leadCountInput(
  view: LeadBoardView,
  organizationId: string,
  now: Date
): ListLeadsInput {
  return { ...leadBoardInput(view, 1, organizationId, now), limit: 1 };
}

/** Pages of the board for a total; an empty board still has its first page */
export function leadBoardPages(total: number): number {
  return Math.max(1, Math.ceil(total / LEAD_BOARD_PAGE_SIZE));
}

/**
 * The row the arrow keys move to: from no row, down goes to the first and up to the last; at
 * either end the focus stays.
 */
export function nextRow(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, current + delta));
}

/** The contacts the president can record over an open customer file (#1128) */
export const FILE_CONTACT_CHOICES = ['call', 'email', 'no_answer'] as const;
export type FileContactChoice = (typeof FILE_CONTACT_CHOICES)[number];

/** What a key of an open customer file does */
export type FileAction = FileContactChoice | 'undo';

/**
 * The key of each answer over a file. A key keeps its meaning whatever the file shows: a number
 * always records the same contact and never turns into the way back or the undo, so a key pressed
 * once too often or a moment too early cannot do something else than what its label said. The
 * way back is Esc only.
 */
export const FILE_KEYS: Readonly<Record<FileAction, string>> = {
  call: '1',
  email: '2',
  no_answer: '3',
  undo: 'Z',
};

/** The answer a key stands for, whether it is open right now or not */
export function fileActionOfKey(key: string): FileAction | null {
  return actionOfKey(FILE_KEYS, key);
}

/**
 * Whether an answer over a file is carried out right now. After a record, no second one is taken
 * until it is undone or the file is opened again; the undo is only open right after a record.
 */
export function fileActionOpen(
  action: FileAction,
  state: { canEdit: boolean; recorded: boolean; busy: boolean }
): boolean {
  if (state.busy || !state.canEdit) return false;
  return action === 'undo' ? state.recorded : !state.recorded;
}

/** What a key of the reception does over a next action that is due (#1133) */
export type DueAction = 'done' | 'next' | 'undo';

/** The key of each answer in the reception: fixed, like the keys of a file */
export const DUE_KEYS: Readonly<Record<DueAction, string>> = {
  done: '1',
  next: '2',
  undo: 'Z',
};

/** The answer a key stands for, whether it is open right now or not */
export function dueActionOfKey(key: string): DueAction | null {
  return actionOfKey(DUE_KEYS, key);
}

/**
 * Whether an answer in the reception is carried out right now. Right after one was marked done,
 * marking is closed until the president goes on: the same key pressed once too often never
 * completes the next one unseen. Going on changes nothing, so it is open to everyone until all
 * were seen.
 */
export function dueActionOpen(
  action: DueAction,
  state: { canEdit: boolean; justDone: boolean; finished: boolean; busy: boolean }
): boolean {
  if (state.busy) return false;
  if (action === 'next') return !state.finished;
  if (!state.canEdit) return false;
  return action === 'undo' ? state.justDone : !state.justDone && !state.finished;
}

function actionOfKey<Action extends string>(
  keys: Readonly<Record<Action, string>>,
  key: string
): Action | null {
  const pressed = key.toUpperCase();
  for (const action of Object.keys(keys) as Action[]) {
    if (keys[action] === pressed) return action;
  }
  return null;
}

/** Days a due day ('YYYY-MM-DD') lies before today ('YYYY-MM-DD'); 0 when due today or later */
export function daysOverdue(dueOn: string, today: string): number {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, Math.round(days)) : 0;
}

/** Where a next action of the queue stands while the president goes through it */
export type DueState = 'done' | 'current' | 'later' | 'waiting';

export function dueState(index: number, current: number, done: boolean): DueState {
  if (done) return 'done';
  if (index === current) return 'current';
  return index < current ? 'later' : 'waiting';
}
