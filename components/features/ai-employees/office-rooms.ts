import type { DeskStatus } from '@/lib/features/ai-employees/office';
/**
 * The rooms of the full-screen office that hold work (#1127, decision
 * 2026-11-13-office-is-the-base): the business screens live inside the office. The marketing room
 * is the first: its wall board is the lead list. The reception (back office) hands over what is
 * due, one at a time (#1133).
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
export const OFFICE_ROOMS = ['marketing', 'backoffice'] as const;
export type OfficeRoom = (typeof OFFICE_ROOMS)[number];

/** The AI employee each room belongs to */
export const ROOM_ROLES: Readonly<Record<OfficeRoom, AiEmployeeRole>> = {
  marketing: 'marketer',
  backoffice: 'back_office',
};

/**
 * The key that enters each room from the floor. The numbers follow the floor guide of the design
 * (1 the president's desk, 2 marketing, 3 sales, 4 engineering, 5 reception): a room keeps its
 * number when the others open.
 */
export const ROOM_KEYS: Readonly<Record<OfficeRoom, string>> = {
  marketing: '2',
  backoffice: '5',
};

/** The room a key of the floor enters, if any */
export function roomOfKey(key: string): OfficeRoom | null {
  return OFFICE_ROOMS.find((room) => ROOM_KEYS[room] === key) ?? null;
}

/** How the room's AI employee stands to what the room reports */
export type RoomGuide = 'employee' | 'training' | 'paused' | 'vacant';

/**
 * Who reads the room's figures to the president. Only an AI employee that works (or waits for
 * work) holds the room; one in training, paused or not hired does not, and the room says so
 * instead of putting words in its mouth.
 */
export function roomGuide(status: DeskStatus): RoomGuide {
  if (status === 'vacant') return 'vacant';
  if (status === 'paused') return 'paused';
  if (status === 'training') return 'training';
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

/** What the president can answer over an open customer file (#1128) */
export type FileChoice = 'call' | 'email' | 'no_answer' | 'back' | 'undo';

/** The contacts the file records with one answer: the quick kinds of the lead page */
export const FILE_CONTACT_CHOICES = [
  'call',
  'email',
  'no_answer',
] as const satisfies readonly FileChoice[];
export type FileContactChoice = (typeof FILE_CONTACT_CHOICES)[number];

/**
 * The choices over an open file. Once a contact was recorded, the first choice is the way back
 * and never another record or the undo: the same key pressed once too often must not record
 * twice or take the record back. Without the right to change leads, only the way back is left.
 */
export function fileChoices(canEdit: boolean, recorded: boolean): FileChoice[] {
  if (recorded) return ['back', 'undo'];
  return canEdit ? [...FILE_CONTACT_CHOICES, 'back'] : ['back'];
}

/** The choice a number key answers with (1 is the first), if any */
export function fileChoiceOfKey(key: string, choices: readonly FileChoice[]): FileChoice | null {
  if (!/^[1-9]$/.test(key)) return null;
  return choices[Number(key) - 1] ?? null;
}

/** What the president can answer over a next action that is due (#1133) */
export type DueChoice = 'done' | 'later' | 'next' | 'undo' | 'back';

/**
 * The choices over a due next action. Right after one was marked done, the first choice goes on
 * to the next and never marks again: the same key pressed once too often must not complete the
 * next one unseen. Without the right to change leads, the president can only look and go on.
 * Once all were seen, only the way back is left.
 */
export function dueChoices(input: {
  canEdit: boolean;
  justDone: boolean;
  finished: boolean;
}): DueChoice[] {
  if (input.finished) return ['back'];
  if (input.justDone) return ['next', 'undo'];
  return input.canEdit ? ['done', 'later'] : ['later'];
}

/** The choice a number key answers with (1 is the first), if any */
export function dueChoiceOfKey(key: string, choices: readonly DueChoice[]): DueChoice | null {
  if (!/^[1-9]$/.test(key)) return null;
  return choices[Number(key) - 1] ?? null;
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
