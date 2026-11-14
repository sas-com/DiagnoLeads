/** The 3D office spike (#1135): how the robots walk between rooms, and what they feel and show */
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

describe('routeBetween', () => {
  it('is a straight line inside one room', () => {
    const from = spotOf('sales', 'working');
    const to = { x: from.x + 2, y: from.y + 1 };
    expect(routeBetween(from, to)).toEqual([from, to]);
  });

  it('leaves by the door, follows the corridor and enters by the other door', () => {
    const from = spotOf('sales', 'training'); // the training room, in front
    const to = spotOf('sales', 'working'); // the sales floor, at the back
    const route = routeBetween(from, to);
    expect(route[0]).toEqual(from);
    expect(route.at(-1)).toEqual(to);
    expect(route).toContainEqual(doorOf('training'));
    expect(route).toContainEqual(doorOf('sales'));
    // Between the doors it stays on the corridor's lane
    const inCorridor = route.filter((point) => point.y === CORRIDOR_LANE);
    expect(inCorridor.length).toBeGreaterThanOrEqual(2);
  });

  it('never crosses a wall: every stretch stays in one room or runs along the corridor', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const a of STATUSES) {
        for (const b of STATUSES) {
          const route = routeBetween(spotOf(role, a), spotOf(role, b));
          for (let i = 1; i < route.length; i++) {
            const p = route[i - 1] as { x: number; y: number };
            const q = route[i] as { x: number; y: number };
            // A stretch is either inside one room (door included) or straight along x or y
            const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
            const straight = p.x === q.x || p.y === q.y;
            expect(straight || areaAt(mid) === areaAt(route[0]) || areaAt(mid) === areaAt(q)).toBe(
              true
            );
          }
        }
      }
    }
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
