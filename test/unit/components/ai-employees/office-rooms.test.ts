/** The rooms of the full-screen office that hold work (#1127): pure helpers */
import {
  LEAD_BOARD_PAGE_SIZE,
  LEAD_BOARD_VIEWS,
  OFFICE_ROOMS,
  DOOR_PAGES,
  DUE_KEYS,
  FLOOR_PLACES,
  PLACE_KEYS,
  FILE_KEYS,
  daysOverdue,
  dueActionOfKey,
  dueActionOpen,
  dueState,
  fileActionOfKey,
  fileActionOpen,
  ROOM_KEYS,
  ROOM_ROLES,
  leadBoardFilters,
  leadBoardInput,
  leadBoardPages,
  nextRow,
  roomGuide,
  isOfficeRoom,
  placeOfKey,
  roomOfKey,
} from '@/components/features/ai-employees/office-rooms';
import { AI_EMPLOYEE_ROLES } from '@/lib/features/ai-employees/types/roles';
import { presetFilters } from '@/lib/features/leads/list-query';
import { listLeadsSchema } from '@/lib/features/leads/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
// A Friday in Japan
const NOW = new Date('2026-11-13T01:30:00Z');

describe('the rooms', () => {
  it('each belong to a role and are entered with their own key', () => {
    for (const room of OFFICE_ROOMS) {
      expect(AI_EMPLOYEE_ROLES).toContain(ROOM_ROLES[room]);
      expect(roomOfKey(ROOM_KEYS[room])).toBe(room);
    }
    expect(new Set(OFFICE_ROOMS.map((room) => ROOM_KEYS[room])).size).toBe(OFFICE_ROOMS.length);
    expect(ROOM_ROLES.marketing).toBe('marketer');
    expect(ROOM_ROLES.backoffice).toBe('back_office');
  });

  it('hold the sales floor under the key of the floor guide (#1171)', () => {
    expect(ROOM_ROLES.sales).toBe('sales');
    expect(roomOfKey('3')).toBe('sales');
    // The keys the first rooms were given stay theirs
    expect(roomOfKey('2')).toBe('marketing');
    expect(roomOfKey('5')).toBe('backoffice');
  });

  it('are not entered by the keys of the camera or by other keys', () => {
    for (const key of ['0', '+', '-', 'e', 'E', 'Enter', '9']) expect(roomOfKey(key)).toBeNull();
  });
});

describe('the places of the floor guide (#1162)', () => {
  it('are the five places of the work, on the keys 1 to 5 in that order', () => {
    expect(FLOOR_PLACES).toEqual(['desk', 'marketing', 'sales', 'engineering', 'backoffice']);
    expect(FLOOR_PLACES.map((place) => PLACE_KEYS[place])).toEqual(['1', '2', '3', '4', '5']);
    for (const place of FLOOR_PLACES) expect(placeOfKey(PLACE_KEYS[place])).toBe(place);
  });

  it('keep the keys of the rooms that are built', () => {
    for (const room of OFFICE_ROOMS) {
      expect(isOfficeRoom(room)).toBe(true);
      expect(PLACE_KEYS[room]).toBe(ROOM_KEYS[room]);
    }
  });

  it('open a fixed page of the normal view when their room is not built yet', () => {
    const doors = FLOOR_PLACES.filter((place) => !isOfficeRoom(place));
    // The sales floor (#1171) and the engineering room (#1194) are rooms now: only the desk is a door
    expect(doors).toEqual(['desk']);
    expect(DOOR_PAGES).toEqual({
      desk: '/today',
    });
    // A door is not a room: its key does not enter one
    for (const door of doors) expect(roomOfKey(PLACE_KEYS[door])).toBeNull();
  });

  it('are not opened by the keys of the camera or by other keys', () => {
    for (const key of ['0', '+', '-', 'e', 'E', 'Enter', '6', '9']) expect(placeOfKey(key)).toBeNull();
  });
});

describe('roomGuide', () => {
  it('lets only an AI employee that works or waits for work hold the room', () => {
    expect(roomGuide('working')).toBe('employee');
    expect(roomGuide('idle')).toBe('employee');
  });

  it('says so when the AI employee is stuck, in training, paused or not hired', () => {
    expect(roomGuide('attention')).toBe('attention');
    expect(roomGuide('training')).toBe('training');
    expect(roomGuide('paused')).toBe('paused');
    expect(roomGuide('vacant')).toBe('vacant');
  });
});

describe('the lead board', () => {
  it('filters like the preset of the same name in the lead list, and not at all for "all"', () => {
    expect(leadBoardFilters('needsAction', NOW)).toEqual(presetFilters('needsAction', NOW));
    expect(leadBoardFilters('newThisWeek', NOW).createdFrom).toBe('2026-11-09');
    expect(leadBoardFilters('all', NOW)).toEqual({
      status: [],
      dealPhase: [],
      inflowSource: [],
      targetSystem: [],
    });
  });

  it('asks leads.list for one page of the organization, newest first', () => {
    const first = leadBoardInput('needsAction', 1, ORG_ID, NOW);
    expect(first).toMatchObject({
      organizationId: ORG_ID,
      status: ['new'],
      limit: LEAD_BOARD_PAGE_SIZE,
      offset: 0,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(leadBoardInput('all', 3, ORG_ID, NOW).offset).toBe(2 * LEAD_BOARD_PAGE_SIZE);
    // Every view is an input the API accepts
    for (const view of LEAD_BOARD_VIEWS) {
      expect(listLeadsSchema.safeParse(leadBoardInput(view, 1, ORG_ID, NOW)).success).toBe(true);
    }
  });

  it('has at least one page', () => {
    expect(leadBoardPages(0)).toBe(1);
    expect(leadBoardPages(LEAD_BOARD_PAGE_SIZE)).toBe(1);
    expect(leadBoardPages(LEAD_BOARD_PAGE_SIZE + 1)).toBe(2);
  });
});

describe('nextRow', () => {
  it('enters the rows from the top with down and from the bottom with up', () => {
    expect(nextRow(-1, 1, 5)).toBe(0);
    expect(nextRow(-1, -1, 5)).toBe(4);
  });

  it('moves by one and stops at the ends', () => {
    expect(nextRow(1, 1, 5)).toBe(2);
    expect(nextRow(1, -1, 5)).toBe(0);
    expect(nextRow(0, -1, 5)).toBe(0);
    expect(nextRow(4, 1, 5)).toBe(4);
  });

  it('goes nowhere on an empty board', () => {
    expect(nextRow(-1, 1, 0)).toBe(-1);
  });
});

describe('the keys of an open file', () => {
  const open = { canEdit: true, recorded: false, busy: false };

  it('keep their meaning: a number is always the same contact, the undo has its own key', () => {
    expect(FILE_KEYS).toEqual({ call: '1', email: '2', no_answer: '3', undo: 'Z' });
    expect(fileActionOfKey('1')).toBe('call');
    expect(fileActionOfKey('2')).toBe('email');
    expect(fileActionOfKey('3')).toBe('no_answer');
    expect(fileActionOfKey('z')).toBe('undo');
    expect(fileActionOfKey('Z')).toBe('undo');
    for (const key of ['4', '0', 'Enter', 'Escape', ' ']) expect(fileActionOfKey(key)).toBeNull();
  });

  it('record a contact while nothing was recorded, and undo nothing', () => {
    for (const contact of ['call', 'email', 'no_answer'] as const) {
      expect(fileActionOpen(contact, open)).toBe(true);
    }
    expect(fileActionOpen('undo', open)).toBe(false);
  });

  it('close the contacts once one was recorded: no second record by the same key, only the undo', () => {
    const after = { ...open, recorded: true };
    for (const contact of ['call', 'email', 'no_answer'] as const) {
      expect(fileActionOpen(contact, after)).toBe(false);
    }
    expect(fileActionOpen('undo', after)).toBe(true);
  });

  it('carry nothing out while an answer is on its way, or without the right to change leads', () => {
    for (const action of ['call', 'email', 'no_answer', 'undo'] as const) {
      expect(fileActionOpen(action, { ...open, recorded: true, busy: true })).toBe(false);
      expect(fileActionOpen(action, { ...open, busy: true })).toBe(false);
      expect(fileActionOpen(action, { ...open, canEdit: false })).toBe(false);
      expect(fileActionOpen(action, { ...open, canEdit: false, recorded: true })).toBe(false);
    }
  });
});

describe('the keys of the reception', () => {
  const open = { canEdit: true, justDone: false, finished: false, busy: false };

  it('keep their meaning: 1 marks, 2 goes on, the undo has its own key', () => {
    expect(DUE_KEYS).toEqual({ done: '1', next: '2', undo: 'Z' });
    expect(dueActionOfKey('1')).toBe('done');
    expect(dueActionOfKey('2')).toBe('next');
    expect(dueActionOfKey('z')).toBe('undo');
    for (const key of ['3', '0', 'Enter', 'Escape']) expect(dueActionOfKey(key)).toBeNull();
  });

  it('mark one as done or go on', () => {
    expect(dueActionOpen('done', open)).toBe(true);
    expect(dueActionOpen('next', open)).toBe(true);
    expect(dueActionOpen('undo', open)).toBe(false);
  });

  it('close marking right after a mark: the same key never marks the next one unseen', () => {
    const after = { ...open, justDone: true };
    expect(dueActionOpen('done', after)).toBe(false);
    expect(dueActionOpen('next', after)).toBe(true);
    expect(dueActionOpen('undo', after)).toBe(true);
  });

  it('let a member without the right to change leads only go on', () => {
    const reader = { ...open, canEdit: false };
    expect(dueActionOpen('done', reader)).toBe(false);
    expect(dueActionOpen('undo', { ...reader, justDone: true })).toBe(false);
    expect(dueActionOpen('next', reader)).toBe(true);
  });

  it('carry nothing out once all were seen, or while an answer is on its way', () => {
    const finished = { ...open, finished: true };
    expect(dueActionOpen('done', finished)).toBe(false);
    expect(dueActionOpen('next', finished)).toBe(false);
    for (const action of ['done', 'next', 'undo'] as const) {
      expect(dueActionOpen(action, { ...open, justDone: true, busy: true })).toBe(false);
    }
  });
});

describe('daysOverdue', () => {
  it('counts the days a due day lies before today', () => {
    expect(daysOverdue('2026-11-10', '2026-11-13')).toBe(3);
    expect(daysOverdue('2026-10-31', '2026-11-01')).toBe(1);
  });

  it('is 0 for today, a later day and a broken day', () => {
    expect(daysOverdue('2026-11-13', '2026-11-13')).toBe(0);
    expect(daysOverdue('2026-11-20', '2026-11-13')).toBe(0);
    expect(daysOverdue('', '2026-11-13')).toBe(0);
  });
});

describe('dueState', () => {
  it('tells done, in hand, left for later and still to come apart', () => {
    expect(dueState(0, 1, true)).toBe('done');
    expect(dueState(1, 1, false)).toBe('current');
    expect(dueState(0, 1, false)).toBe('later');
    expect(dueState(2, 1, false)).toBe('waiting');
    // One that was done stays done while it is in hand
    expect(dueState(1, 1, true)).toBe('done');
  });
});
