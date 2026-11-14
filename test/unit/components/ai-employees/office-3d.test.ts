/** The 3D office (#1135, #1149): how the robots walk between rooms, and what they feel and show */
import {
  EMOTIONS,
  OFFICE_EVENTS,
  emotionOf,
  expressionOf,
  gestureScale,
} from '@/components/features/ai-employees/office-3d/office-emotion';
import {
  CORRIDOR_LANE,
  areaAt,
  doorOf,
  pointAlong,
  routeBetween,
  routeLength,
} from '@/components/features/ai-employees/office-3d/office-nav';
import { OBSTACLES, onFloor } from '@/components/features/ai-employees/office-furniture';
import {
  AREA_RECTS,
  OFFICE_AREAS,
  spotOf,
} from '@/components/features/ai-employees/office-map-layout';
import { AI_TONES } from '@/lib/features/ai-employees/types/profile';
import { AI_EMPLOYEE_ROLES } from '@/lib/features/ai-employees/types/roles';
import { describe, expect, it } from 'vitest';

const STATUSES = ['working', 'attention', 'idle', 'training', 'paused'] as const;
const rooms = OFFICE_AREAS.filter((area) => area !== 'corridor');

describe('areaAt and doorOf', () => {
  it('finds the room of every place a robot can be', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const status of STATUSES) {
        expect(areaAt(spotOf(role, status))).not.toBe('corridor');
      }
    }
    expect(areaAt({ x: 12, y: CORRIDOR_LANE })).toBe('corridor');
  });

  it('puts the door of every room on its side of the corridor', () => {
    const corridor = AREA_RECTS.corridor;
    for (const room of rooms) {
      const door = doorOf(room);
      const r = AREA_RECTS[room];
      expect(door.x).toBeGreaterThan(r.x);
      expect(door.x).toBeLessThan(r.x + r.w);
      expect([corridor.y, corridor.y + corridor.h]).toContain(door.y);
    }
  });
});

/** Whether the point is strictly inside the rectangle */
const inside = (
  point: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number }
) => point.x > r.x && point.x < r.x + r.w && point.y > r.y && point.y < r.y + r.h;
const on = (point: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
  point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h;

/** Points along the route, close enough to each other to meet a sheet of glass */
function* along(route: readonly { x: number; y: number }[]) {
  for (let i = 1; i < route.length; i++) {
    const p = route[i - 1] as { x: number; y: number };
    const q = route[i] as { x: number; y: number };
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.02));
    for (let k = 0; k <= steps; k++) {
      yield { x: p.x + ((q.x - p.x) * k) / steps, y: p.y + ((q.y - p.y) * k) / steps };
    }
  }
}

describe('routeBetween', () => {
  it('is a straight line when nothing is in the way', () => {
    const from = { x: 2, y: CORRIDOR_LANE };
    const to = { x: 20, y: CORRIDOR_LANE };
    expect(routeBetween(from, to)).toEqual([from, to]);
    expect(routeBetween(from, from)).toEqual([from]);
  });

  it('starts and ends at the two places, whatever they are', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const a of STATUSES) {
        for (const b of STATUSES) {
          const from = spotOf(role, a);
          const to = spotOf(role, b);
          const route = routeBetween(from, to);
          expect(route[0]).toEqual(from);
          expect(route.at(-1)).toEqual(to);
        }
      }
    }
  });

  it('walks through no desk, plant, sofa or sheet of glass, and stays on the floor', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const a of STATUSES) {
        for (const b of STATUSES) {
          const from = spotOf(role, a);
          const to = spotOf(role, b);
          // The chair it gets up from and the one it sits down on are its own
          const inTheWay = OBSTACLES.filter(
            (obstacle) => !(obstacle.seat && (on(from, obstacle) || on(to, obstacle)))
          );
          for (const point of along(routeBetween(from, to))) {
            expect(onFloor(point), `${role} ${a} → ${b} leaves the floor`).toBe(true);
            const hit = inTheWay.find((obstacle) => inside(point, obstacle));
            expect(
              hit,
              `${role} ${a} → ${b} walks through ${JSON.stringify(hit)} at ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`
            ).toBeUndefined();
          }
        }
      }
    }
  });

  it('goes around instead of jumping: there is a way between every two places', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const a of STATUSES) {
        for (const b of STATUSES) {
          const from = spotOf(role, a);
          const to = spotOf(role, b);
          if (areaAt(from) === areaAt(to)) continue;
          // Without a way it would be the straight line through the walls: two points
          const route = routeBetween(from, to);
          expect(route.length).toBeGreaterThan(2);
          // Between two rooms it is never much more than around the floor
          expect(routeLength(route)).toBeLessThan(45);
        }
      }
    }
  });

  it('crosses the corridor between a front room and a back room', () => {
    const route = routeBetween(spotOf('sales', 'training'), spotOf('sales', 'working'));
    const corridor = AREA_RECTS.corridor;
    const inCorridor = [...along(route)].filter(
      (point) => point.y > corridor.y && point.y < corridor.y + corridor.h
    );
    expect(inCorridor.length).toBeGreaterThan(0);
  });

  it('has no stretch of no length', () => {
    const route = routeBetween(doorOf('sales'), spotOf('sales', 'idle'));
    for (let i = 1; i < route.length; i++) {
      expect(routeLength([route[i - 1], route[i]] as never)).toBeGreaterThan(0);
    }
  });
});

describe('pointAlong', () => {
  const route = [
    { x: 0, y: 0 },
    { x: 0, y: 4 },
    { x: 3, y: 4 },
  ];

  it('walks the stretches in order, facing along each', () => {
    expect(routeLength(route)).toBe(7);
    expect(pointAlong(route, 2)).toEqual({ x: 0, y: 2, heading: 0 });
    const turned = pointAlong(route, 5);
    expect(turned.x).toBeCloseTo(1);
    expect(turned.y).toBe(4);
    expect(turned.heading).toBeCloseTo(Math.PI / 2);
  });

  it('stands at the start before it and at the end after it', () => {
    expect(pointAlong(route, -1)).toMatchObject({ x: 0, y: 0 });
    expect(pointAlong(route, 99)).toMatchObject({ x: 3, y: 4 });
    expect(pointAlong([{ x: 2, y: 2 }], 5)).toEqual({ x: 2, y: 2, heading: 0 });
  });
});

describe('emotionOf', () => {
  it('follows the status when nothing happened', () => {
    expect(emotionOf('working')).toBe('focused');
    expect(emotionOf('attention')).toBe('troubled');
    expect(emotionOf('idle')).toBe('relaxed');
    expect(emotionOf('training')).toBe('studious');
    expect(emotionOf('paused')).toBe('asleep');
  });

  it('shows what just happened over the status', () => {
    expect(emotionOf('idle', 'run_succeeded')).toBe('proud');
    expect(emotionOf('training', 'hired')).toBe('happy');
    expect(emotionOf('idle', 'resumed')).toBe('happy');
    expect(emotionOf('working', 'president_near')).toBe('attentive');
  });

  it('never cheers over a stopped run or in its sleep', () => {
    for (const event of OFFICE_EVENTS) {
      expect(emotionOf('attention', event)).toBe('troubled');
      expect(emotionOf('paused', event)).toBe('asleep');
    }
  });

  it('is only proud of a run that succeeded', () => {
    for (const status of STATUSES) {
      for (const event of [null, 'hired', 'resumed', 'president_near'] as const) {
        expect(emotionOf(status, event)).not.toBe('proud');
      }
    }
  });
});

describe('expressionOf and gestureScale', () => {
  it('gives every emotion a face, a movement and a lean', () => {
    for (const emotion of EMOTIONS) {
      const expression = expressionOf(emotion);
      expect(expression.bob).toBeGreaterThan(0);
      expect(Math.abs(expression.lean)).toBeLessThan(0.5);
    }
    expect(expressionOf('asleep')).toMatchObject({ eyes: 'closed', icon: 'sleep' });
    expect(expressionOf('troubled')).toMatchObject({ eyes: 'down', icon: 'alert' });
    expect(expressionOf('proud').icon).toBe('check');
  });

  it('makes the gestures of a spirited employee the largest and of a brisk one the smallest', () => {
    const scales = AI_TONES.map(gestureScale);
    expect(gestureScale('polite')).toBe(1);
    expect(Math.max(...scales)).toBe(gestureScale('spirited'));
    expect(Math.min(...scales)).toBe(gestureScale('brisk'));
  });
});
