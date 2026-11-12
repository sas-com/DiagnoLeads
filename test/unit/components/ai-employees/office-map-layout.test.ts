/**
 * The virtual office (#1101): where each robot goes by its status, every place inside its room,
 * no two robots on the same spot, and the drawing kept inside its box with a robot for every role.
 */
import {
  AREA_RECTS,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  areaOf,
  spotOf,
} from '@/components/features/ai-employees/office-map-layout';
import {
  SCENE_HEIGHT,
  SCENE_WIDTH,
  buildOfficeScene,
  project,
} from '@/components/features/ai-employees/office-scene';
import { DESK_STATUSES, type DeskStatus } from '@/lib/features/ai-employees/office';
import {
  AI_EMPLOYEE_ROLES,
  AI_EMPLOYEE_ROLE_DEFINITIONS,
  type AiEmployeeRole,
} from '@/lib/features/ai-employees/types/roles';
import { describe, expect, it } from 'vitest';

const allAs = (status: DeskStatus) =>
  Object.fromEntries(AI_EMPLOYEE_ROLES.map((role) => [role, status])) as Record<
    AiEmployeeRole,
    DeskStatus
  >;

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

  it('keeps every spot inside its area, away from the walls', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const status of DESK_STATUSES) {
        const spot = spotOf(role, status);
        const area = AREA_RECTS[areaOf(role, status)];
        expect(spot.x).toBeGreaterThan(area.x + 0.3);
        expect(spot.x).toBeLessThan(area.x + area.w - 0.3);
        expect(spot.y).toBeGreaterThan(area.y + 0.3);
        expect(spot.y).toBeLessThan(area.y + area.h - 0.3);
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

  it('tiles the floor with the areas', () => {
    const surface = Object.values(AREA_RECTS).reduce((sum, r) => sum + r.w * r.h, 0);
    expect(surface).toBe(FLOOR_WIDTH * FLOOR_DEPTH);
  });
});

describe('isometric scene', () => {
  it('fits the floor and the robots inside the drawing', () => {
    for (const [x, y] of [
      [0, 0],
      [FLOOR_WIDTH, 0],
      [0, FLOOR_DEPTH],
      [FLOOR_WIDTH, FLOOR_DEPTH],
    ]) {
      const [sx, sy] = project(x, y);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(SCENE_WIDTH);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(SCENE_HEIGHT);
    }
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const status of DESK_STATUSES) {
        const spot = spotOf(role, status);
        const [, sy] = project(spot.x, spot.y);
        // The antenna and the bubbles reach about 105 above the feet
        expect(sy - 105).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('draws every role, lights the monitors of the robots at work, and labels the rooms', () => {
    const gradient = (name: string) => `url(#${name})`;
    const busy = buildOfficeScene(
      { follow_up_keeper: 'working', lead_scorer: 'attention', timing_watcher: 'idle' },
      false,
      gradient
    );
    const quiet = buildOfficeScene(allAs('paused'), false, gradient);
    const glowingScreens = (scene: typeof busy) =>
      scene.prims.filter((prim) => prim.kind === 'ellipse' && prim.fill === '#7dd3fc').length;
    expect(glowingScreens(busy)).toBe(3); // one monitor in sales, two in analysis
    expect(glowingScreens(quiet)).toBe(0);
    expect(busy.prims.some((prim) => prim.pulse)).toBe(true);
    expect(busy.labels.map((label) => label.area)).not.toContain('corridor');
    expect(busy.labels).toHaveLength(7);
  });

  it('dims the colours at night and turns on the lamps', () => {
    const gradient = (name: string) => `url(#${name})`;
    const day = buildOfficeScene(allAs('idle'), false, gradient);
    const night = buildOfficeScene(allAs('idle'), true, gradient);
    const pools = (scene: typeof day) =>
      scene.prims.filter((prim) => prim.fill === 'url(#pool)').length;
    expect(pools(day)).toBe(0);
    expect(pools(night)).toBeGreaterThan(0);
  });
});
