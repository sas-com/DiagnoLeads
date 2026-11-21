/**
 * The pure rules of the reception's counter (#1196): which key opens which shelf, where the doors
 * lead, and which figures the counter may say.
 */
import {
  RECEPTION_SHELVES,
  SETTINGS_DOORS,
  SHELF_KEYS,
  invitationNamed,
  dueFigures,
  dueLine,
  invitationFigures,
  membersLine,
  overdueCount,
  shelfOfKey,
} from '@/components/features/ai-employees/rooms/reception';
import { describe, expect, it } from 'vitest';

describe('the shelves of the reception', () => {
  it('gives each shelf its own key', () => {
    expect(RECEPTION_SHELVES.map((shelf) => SHELF_KEYS[shelf])).toEqual(['1', '2', '3']);
    expect(shelfOfKey('1')).toBe('due');
    expect(shelfOfKey('2')).toBe('members');
    expect(shelfOfKey('3')).toBe('settings');
    expect(shelfOfKey('4')).toBeNull();
    expect(shelfOfKey('Z')).toBeNull();
  });

  it('only has doors to fixed settings pages of this app', () => {
    for (const door of SETTINGS_DOORS) {
      expect(door.path).toMatch(/^\/settings(\/[a-z-]+)?$/);
    }
    expect(new Set(SETTINGS_DOORS.map((door) => door.path)).size).toBe(SETTINGS_DOORS.length);
  });
});

describe('the figures of the counter', () => {
  const items = [{ dueOn: '2026-11-10' }, { dueOn: '2026-11-13' }, { dueOn: '2026-11-14' }];

  it('counts what lies before today', () => {
    expect(overdueCount(items, '2026-11-13')).toBe(1);
    expect(overdueCount(items, '')).toBe(0);
  });

  it('knows what is due once it was read, and not how many are overdue when some were not read', () => {
    expect(dueFigures(undefined, null)).toEqual({ state: 'reading' });
    expect(dueFigures(undefined, 'forbidden')).toEqual({ state: 'forbidden' });
    expect(dueFigures({ items, total: 3, today: '2026-11-13' }, null)).toEqual({
      state: 'ready',
      total: 3,
      overdue: 1,
    });
    expect(dueFigures({ items, total: 250, today: '2026-11-13' }, null)).toEqual({
      state: 'ready',
      total: 250,
      overdue: null,
    });
  });

  it('chooses the sentence about what is due', () => {
    expect(dueLine({ state: 'reading' })).toBeNull();
    expect(dueLine({ state: 'error' })).toBe('error');
    expect(dueLine({ state: 'ready', total: 0, overdue: 0 })).toBe('none');
    expect(dueLine({ state: 'ready', total: 2, overdue: 0 })).toBe('some');
    expect(dueLine({ state: 'ready', total: 2, overdue: null })).toBe('some');
    expect(dueLine({ state: 'ready', total: 2, overdue: 1 })).toBe('overdue');
  });

  it('keeps the invitations from who may not see them, and counts the expired ones apart', () => {
    expect(invitationFigures(undefined, 'forbidden')).toEqual({ state: 'hidden' });
    expect(invitationFigures(undefined, 'error')).toEqual({ state: 'error' });
    expect(invitationFigures(undefined, null)).toEqual({ state: 'reading' });
    const known = invitationFigures([{ expired: false }, { expired: true }], null);
    expect(known).toEqual({ state: 'ready', waiting: 1, expired: 1 });
    expect(membersLine(3, known)).toBe('withInvitations');
    expect(membersLine(3, { state: 'hidden' })).toBe('members');
    expect(membersLine(null, known)).toBeNull();
  });
});

describe('the invitation an address names (#1197)', () => {
  const pending = [{ id: 'a', email: 'first@example.com' }, { id: 'b', email: 'second@example.com' }];

  it('names one only by its whole address, whatever the case and the width of the letters', () => {
    expect(invitationNamed('second@example.com', pending)?.id).toBe('b');
    expect(invitationNamed('  First@Example.COM ', pending)?.id).toBe('a');
    expect(invitationNamed('ｆｉｒｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ', pending)?.id).toBe('a');
    expect(invitationNamed('first@example', pending)).toBeNull();
    expect(invitationNamed('', pending)).toBeNull();
    expect(invitationNamed('1', pending)).toBeNull();
    expect(invitationNamed('first@example.com', [])).toBeNull();
  });
});
