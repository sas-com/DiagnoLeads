/** The rooms of the full-screen office that hold work (#1127): pure helpers */
import {
  LEAD_BOARD_FIRST_VIEW,
  LEAD_BOARD_PAGE_SIZE,
  LEAD_BOARD_VIEWS,
  LEAD_REPORT_VIEWS,
  OFFICE_ROOMS,
  ROOM_KEYS,
  ROOM_ROLES,
  leadBoardFilters,
  leadBoardInput,
  leadBoardPages,
  leadBoardViewOfKey,
  leadCountInput,
  nextRow,
  roomGuide,
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
  });

  it('are not entered by the keys of the camera or by other keys', () => {
    for (const key of ['0', '+', '-', 'e', 'E', 'Enter', '9']) expect(roomOfKey(key)).toBeNull();
  });
});

describe('roomGuide', () => {
  it('lets only an AI employee that works or waits for work hold the room', () => {
    expect(roomGuide('working')).toBe('employee');
    expect(roomGuide('idle')).toBe('employee');
    expect(roomGuide('attention')).toBe('employee');
  });

  it('says so when the AI employee is in training, paused or not hired', () => {
    expect(roomGuide('training')).toBe('training');
    expect(roomGuide('paused')).toBe('paused');
    expect(roomGuide('vacant')).toBe('vacant');
  });
});

describe('the lead board', () => {
  it('opens on what nobody has started on, and reports views it can show', () => {
    expect(LEAD_BOARD_VIEWS).toContain(LEAD_BOARD_FIRST_VIEW);
    for (const view of LEAD_REPORT_VIEWS) expect(LEAD_BOARD_VIEWS).toContain(view);
  });

  it('chooses a view with its number key', () => {
    LEAD_BOARD_VIEWS.forEach((view, index) => {
      expect(leadBoardViewOfKey(String(index + 1))).toBe(view);
    });
    expect(leadBoardViewOfKey(String(LEAD_BOARD_VIEWS.length + 1))).toBeNull();
    expect(leadBoardViewOfKey('0')).toBeNull();
    expect(leadBoardViewOfKey('a')).toBeNull();
  });

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
      expect(listLeadsSchema.safeParse(leadCountInput(view, ORG_ID, NOW)).success).toBe(true);
    }
  });

  it('asks for a single row when only the total is needed', () => {
    expect(leadCountInput('consultation', ORG_ID, NOW)).toMatchObject({
      organizationId: ORG_ID,
      consultationRequested: true,
      limit: 1,
      offset: 0,
    });
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
