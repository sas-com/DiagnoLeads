/**
 * The floor plan of the virtual office (#1101): where each robot goes by its status, every place
 * inside its room, and no two robots on the same spot.
 */
import {
  AREA_RECTS,
  MAP_HEIGHT,
  MAP_WIDTH,
  areaOf,
  spotOf,
  toPercent,
} from '@/components/features/ai-employees/office-map-layout';
import { DESK_STATUSES } from '@/lib/features/ai-employees/office';
import {
  AI_EMPLOYEE_ROLES,
  AI_EMPLOYEE_ROLE_DEFINITIONS,
} from '@/lib/features/ai-employees/types/roles';
import { describe, expect, it } from 'vitest';

describe('virtual office layout', () => {
  it('sends a robot where its status takes it', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      const room = AI_EMPLOYEE_ROLE_DEFINITIONS[role].room;
      expect(areaOf(role, 'working')).toBe(room);
      expect(areaOf(role, 'attention')).toBe(room);
      expect(areaOf(role, 'vacant')).toBe(room);
      expect(areaOf(role, 'idle')).toBe('lounge');
      expect(areaOf(role, 'training')).toBe('training');
      expect(areaOf(role, 'paused')).toBe('charging');
    }
  });

  it('keeps every spot inside its area, with room for the robot', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const status of DESK_STATUSES) {
        const spot = spotOf(role, status);
        const area = AREA_RECTS[areaOf(role, status)];
        expect(spot.x - 18).toBeGreaterThanOrEqual(area.x);
        expect(spot.x + 18).toBeLessThanOrEqual(area.x + area.w);
        expect(spot.y - 18).toBeGreaterThanOrEqual(area.y);
        expect(spot.y + 18).toBeLessThanOrEqual(area.y + area.h);
      }
    }
  });

  it('never puts two robots on the same spot, whatever their statuses', () => {
    for (const status of DESK_STATUSES) {
      const spots = AI_EMPLOYEE_ROLES.map((role) => {
        const spot = spotOf(role, status);
        return `${spot.x},${spot.y}`;
      });
      expect(new Set(spots).size).toBe(spots.length);
    }
  });

  it('places HTML over the drawing in percentages of the map', () => {
    expect(toPercent({ x: MAP_WIDTH / 2, y: MAP_HEIGHT })).toEqual({ left: '50%', top: '100%' });
  });
});
