/**
 * The president's side of the full-screen office (#1109): day and night by the clock, the
 * president's tasks from the real state of the office, what can be answered in a conversation,
 * and where the camera goes.
 */
import {
  PRESIDENT_TASKS_MAX,
  cameraOffset,
  firstRoleToVisit,
  HOME_CLOSE_UP,
  HUD_SIDES,
  homeCloseUp,
  homeShift,
  homeView,
  hourIn,
  isNightHour,
  presidentTasks,
  statusByRole,
  talkChoices,
} from '@/components/features/ai-employees/office-president';
import { DESK_STATUSES } from '@/lib/features/ai-employees/office';
import { AI_EMPLOYEE_ROLES } from '@/lib/features/ai-employees/types/roles';
import { describe, expect, it } from 'vitest';

describe('the president’s office', () => {
  it('is night from 18:00 to 6:00', () => {
    expect([5, 6, 12, 17, 18, 23, 0].map(isNightHour)).toEqual([
      true,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it('reads the hour in the time zone the clock on the screen shows', () => {
    // 16:29 UTC is 01:29 the next day in Japan: night, though it is afternoon in UTC
    const now = new Date('2026-11-12T16:29:00Z');
    expect(hourIn(now, 'Asia/Tokyo')).toBe(1);
    expect(hourIn(now, 'UTC')).toBe(16);
    expect(isNightHour(hourIn(now, 'Asia/Tokyo'))).toBe(true);
    expect(hourIn(new Date('2026-11-12T15:00:00Z'), 'Asia/Tokyo')).toBe(0);
  });

  it('reads a vacant desk for every role nobody was hired for', () => {
    expect(statusByRole([{ role: 'sales', deskStatus: 'training' }])).toEqual({
      marketer: 'vacant',
      sales: 'training',
      engineer: 'vacant',
      back_office: 'vacant',
    });
  });

  it('lists stopped work first, then paused staff, then vacant departments', () => {
    const statuses = statusByRole([
      { role: 'marketer', deskStatus: 'paused' },
      { role: 'sales', deskStatus: 'attention' },
      { role: 'back_office', deskStatus: 'training' },
    ]);
    expect(presidentTasks(statuses, true)).toEqual([
      { kind: 'consult', role: 'sales' },
      { kind: 'resume', role: 'marketer' },
      { kind: 'hire', role: 'engineer' },
    ]);
    expect(firstRoleToVisit(statuses, true)).toBe('sales');
  });

  it('offers hiring and resuming only to those who may manage', () => {
    const statuses = statusByRole([{ role: 'marketer', deskStatus: 'paused' }]);
    expect(presidentTasks(statuses, false)).toEqual([]);
    expect(firstRoleToVisit(statuses, false)).toBe('marketer');
    for (const status of DESK_STATUSES) {
      expect(talkChoices(status, false)).toEqual(['leave']);
    }
  });

  it('shows at most a few tasks, and none when everyone is at work', () => {
    expect(presidentTasks(statusByRole([]), true)).toHaveLength(PRESIDENT_TASKS_MAX);
    const all = statusByRole(
      AI_EMPLOYEE_ROLES.map((role) => ({ role, deskStatus: 'training' as const }))
    );
    expect(presidentTasks(all, true)).toEqual([]);
    expect(firstRoleToVisit(all, true)).toBe(AI_EMPLOYEE_ROLES[0]);
  });

  it('answers a vacant desk by hiring, a paused employee by resuming, the others by pausing', () => {
    expect(talkChoices('vacant', true)).toEqual(['hire', 'leave']);
    expect(talkChoices('paused', true)).toEqual(['resume', 'leave']);
    for (const status of ['training', 'idle', 'working', 'attention'] as const) {
      expect(talkChoices(status, true)).toEqual(['pause', 'leave']);
    }
  });

  it('moves the stage so that a point lands where the camera wants it', () => {
    const offset = cameraOffset({
      width: 1000,
      height: 700,
      scale: 2,
      px: 0.5,
      py: 0.25,
      targetX: 320,
      targetY: 400,
    });
    // The point is at (2 * 500, 2 * 175) of the scaled stage
    expect(offset).toEqual({ x: 320 - 1000, y: 400 - 350 });
  });

  it('starts closer than the whole floor where the side panels leave room, covering the screen on a narrow one', () => {
    const aspect = 10 / 7;
    // 1920 x 1080: room between the panels, so the floor starts larger than the screen holds
    const wide = homeView({ w: 1920, h: 1080 }, aspect);
    const closeUp = homeCloseUp({ w: 1920, h: 1080 }, aspect);
    expect(closeUp).toBeGreaterThan(1.1);
    expect(closeUp).toBeLessThanOrEqual(HOME_CLOSE_UP);
    expect(wide.zoom).toBeCloseTo(((1080 * aspect) / 1920) * closeUp, 5);
    // Stepping back as far as the camera goes brings the whole floor into view
    expect(wide.zoom * wide.out).toBeCloseTo((1080 * aspect) / 1920, 5);
    // A screen wider than the floor: the floor already fits by its height
    const ultra = homeView({ w: 2560, h: 1080 }, aspect);
    expect(homeCloseUp({ w: 2560, h: 1080 }, aspect)).toBe(HOME_CLOSE_UP);
    expect(ultra.zoom * ultra.out).toBeCloseTo((1080 * aspect) / 2560, 5);
    expect(homeView({ w: 390, h: 844 }, aspect)).toEqual({ zoom: 1, x: 0, y: 0, out: 1 });
  });

  it('starts with the whole floor in view where the side panels leave little room (#1183)', () => {
    const aspect = 10 / 7;
    // 1440 x 900: closer, the training room in the left corner would stand under the staff list
    for (const size of [
      { w: 1280, h: 720 },
      { w: 1440, h: 900 },
      { w: 1680, h: 1050 },
    ]) {
      expect(homeCloseUp(size, aspect)).toBe(1);
      expect(homeView(size, aspect).out).toBe(1);
    }
    const home = homeView({ w: 1440, h: 900 }, aspect);
    expect(home.zoom).toBeCloseTo((900 * aspect) / 1440, 5);
    // Centred between the side panels, which are not equally wide
    expect(home).toMatchObject({ x: (HUD_SIDES.left - HUD_SIDES.right) / 2, y: -27 });
    expect(homeShift({ w: 390, h: 844 })).toBe(0);
  });
});
