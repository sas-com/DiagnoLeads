/**
 * The virtual office (#1101): where each robot goes by its status, every place inside its room,
 * no two robots on the same spot, seats behind their desks with the robot turned to the desk, the
 * drawing kept inside its box, and a robot of its own for every role.
 */
import {
  AREA_RECTS,
  DESK_SEATS,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  ROLE_DESKS,
  TRAINING_DESKS,
  areaOf,
  spotOf,
} from '@/components/features/ai-employees/office-map-layout';
import {
  ROBOT_EXTENT,
  ROLE_ACCENTS,
  robotPrims,
} from '@/components/features/ai-employees/office-robot';
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

  it('seats each robot centred behind its desk, turned towards it', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      const desk = ROLE_DESKS[role];
      const seat = DESK_SEATS[role];
      expect(seat.x).toBeCloseTo(desk.x + desk.w / 2);
      // Behind the desk (smaller y), facing +y: the desk is in front of the robot
      expect(seat.y).toBeLessThan(desk.y);
      expect(seat.facing).toBe('left');
      for (const status of ['working', 'attention', 'vacant'] as const) {
        expect(spotOf(role, status)).toEqual(seat);
      }
      // In training it sits behind a study desk the same way
      const study = spotOf(role, 'training');
      const studyDesk = TRAINING_DESKS.find((d) => Math.abs(d.x + d.w / 2 - study.x) < 0.01);
      expect(studyDesk).toBeDefined();
      expect(study.y).toBeLessThan(studyDesk?.y ?? 0);
      expect(study.facing).toBe('left');
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
        // The antenna and the bubbles reach this far above the feet
        expect(sy - ROBOT_EXTENT.top).toBeGreaterThanOrEqual(0);
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

describe('robots', () => {
  const gradient = (name: string) => `url(#${name})`;
  const draw = (
    role: AiEmployeeRole,
    status: DeskStatus,
    facing: 'left' | 'right' = 'left',
    x = 0
  ) => robotPrims({ role, status, x, y: 0, facing, night: false, gradient });
  const fills = (prims: ReturnType<typeof draw>) =>
    new Set(prims.flatMap((prim) => [prim.fill, prim.stroke ?? '']));

  it('gives every role a build of its own in its own colour', () => {
    const shapes = AI_EMPLOYEE_ROLES.map((role) => JSON.stringify(draw(role, 'working')));
    expect(new Set(shapes).size).toBe(AI_EMPLOYEE_ROLES.length);
    expect(new Set(Object.values(ROLE_ACCENTS)).size).toBe(AI_EMPLOYEE_ROLES.length);
    for (const role of AI_EMPLOYEE_ROLES) {
      expect(fills(draw(role, 'working'))).toContain(ROLE_ACCENTS[role]);
      for (const other of AI_EMPLOYEE_ROLES) {
        if (other !== role) expect(fills(draw(role, 'working'))).not.toContain(ROLE_ACCENTS[other]);
      }
    }
  });

  it('changes pose and look with the status', () => {
    const looks = DESK_STATUSES.map((status) => JSON.stringify(draw('lead_scorer', status)));
    expect(new Set(looks).size).toBe(DESK_STATUSES.length);
    // A paused robot is switched off: no pulsing beacon, no glow of the eyes
    expect(draw('lead_scorer', 'paused').some((prim) => prim.pulse)).toBe(false);
    expect(draw('lead_scorer', 'working').some((prim) => prim.pulse)).toBe(true);
    // A vacant desk shows a faint outline only
    expect(
      draw('lead_scorer', 'vacant').every((prim) => prim.filter === 'soft' || (prim.op ?? 1) < 0.5)
    ).toBe(true);
  });

  it('mirrors the robot when it faces right, and stays inside its extent', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const status of DESK_STATUSES) {
        const left = draw(role, status, 'left');
        const right = draw(role, status, 'right');
        expect(right).toHaveLength(left.length);
        left.forEach((prim, index) => {
          const other = right[index];
          if (prim.kind === 'ellipse' && other.kind === 'ellipse') {
            expect(other.cx).toBeCloseTo(-prim.cx);
            expect(other.cy).toBeCloseTo(prim.cy);
            expect(Math.abs(prim.cx) + prim.rx).toBeLessThanOrEqual(
              Math.max(ROBOT_EXTENT.left, ROBOT_EXTENT.right)
            );
            expect(-(prim.cy - prim.ry)).toBeLessThanOrEqual(ROBOT_EXTENT.top);
          }
        });
      }
    }
  });
});
