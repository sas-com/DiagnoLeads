/**
 * What stands in the office and where (#1149): the data the 2D picture, the 3D scenery and the
 * walking routes share, and the 3D scenery built from it
 */
import { officeScenery } from '@/components/features/ai-employees/office-3d/office-scenery-3d';
import {
  ROOM_LAMPS,
  ROOM_LIGHTS,
  WALL_SCREENS,
} from '@/components/features/ai-employees/office-3d/office-scenery-3d';
import {
  ALL_CHAIRS,
  ALL_DESKS,
  BACK_WINDOWS,
  LEFT_WINDOWS,
  OBSTACLES,
  PARTITIONS,
  PENDANTS,
  PLANTS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  chairOfDesk,
  doorOf,
  onFloor,
} from '@/components/features/ai-employees/office-furniture';
import {
  AREA_RECTS,
  DESK_SEATS,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  OFFICE_AREAS,
  ROLE_DESKS,
  spotOf,
} from '@/components/features/ai-employees/office-map-layout';
import { DESK_STATUSES } from '@/lib/features/ai-employees/office';
import { AI_EMPLOYEE_ROLES } from '@/lib/features/ai-employees/types/roles';
import { describe, expect, it } from 'vitest';

const rooms = OFFICE_AREAS.filter((area) => area !== 'corridor');
const plants = Object.values(PLANTS).flat();

describe('the furniture of the office', () => {
  it('leaves a door for every room, in a gap of the glass', () => {
    for (const room of rooms) {
      const door = doorOf(room);
      const r = AREA_RECTS[room];
      expect(door.x).toBeGreaterThan(r.x);
      expect(door.x).toBeLessThan(r.x + r.w);
      const glass = PARTITIONS.filter(
        (p) => p.along === 'x' && p.at === door.y && door.x >= p.from && door.x <= p.to
      );
      expect(glass, `the door of ${room} is behind glass`).toEqual([]);
    }
  });

  it('keeps every partition on a border between two areas, inside the floor', () => {
    const borders = { x: new Set<number>(), y: new Set<number>() };
    for (const area of OFFICE_AREAS) {
      const r = AREA_RECTS[area];
      borders.y.add(r.x).add(r.x + r.w);
      borders.x.add(r.y).add(r.y + r.h);
    }
    for (const p of PARTITIONS) {
      // A partition along y stands at an x where an area begins or ends, and the other way round
      expect(borders[p.along].has(p.at), JSON.stringify(p)).toBe(true);
      expect(p.from).toBeLessThan(p.to);
      expect(p.from).toBeGreaterThanOrEqual(0);
      expect(p.to).toBeLessThanOrEqual(p.along === 'x' ? FLOOR_WIDTH : FLOOR_DEPTH);
    }
  });

  it('puts a chair behind every desk, and the roles on the chairs of their own desks', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      const seat = DESK_SEATS[role];
      expect(chairOfDesk(ROLE_DESKS[role])).toMatchObject({ x: seat.x, y: seat.y });
    }
    for (const desk of ALL_DESKS) {
      const chair = chairOfDesk(desk);
      expect(ALL_CHAIRS).toContainEqual(expect.objectContaining({ x: chair.x, y: chair.y }));
    }
  });

  it('stands on the floor, and on no place where an employee can be', () => {
    for (const obstacle of OBSTACLES) {
      expect(onFloor({ x: obstacle.x, y: obstacle.y }), JSON.stringify(obstacle)).toBe(true);
      expect(
        onFloor({ x: obstacle.x + obstacle.w, y: obstacle.y + obstacle.h }),
        JSON.stringify(obstacle)
      ).toBe(true);
    }
    for (const role of AI_EMPLOYEE_ROLES) {
      for (const status of DESK_STATUSES) {
        const spot = spotOf(role, status);
        // An employee sits on a chair; everything else it would stand inside of
        const within = OBSTACLES.filter(
          (o) =>
            !o.seat && spot.x > o.x && spot.x < o.x + o.w && spot.y > o.y && spot.y < o.y + o.h
        );
        expect(within, `${role} ${status} is inside ${JSON.stringify(within)}`).toEqual([]);
      }
    }
  });
});

describe('officeScenery', () => {
  const parts = officeScenery();

  it('is built once', () => {
    expect(officeScenery()).toBe(parts);
  });

  it('has every piece of the 2D office', () => {
    const count = (test: (part: (typeof parts)[number]) => boolean) => parts.filter(test).length;
    // A chair stands on one round base, a plant has one brass rim, a pendant one bulb
    expect(count((p) => p.kind === 'chair' && p.shape === 'cylinder' && p.h === 0.03)).toBe(
      ALL_CHAIRS.length
    );
    expect(count((p) => p.kind === 'plant' && p.finish === 'metal')).toBe(plants.length);
    expect(count((p) => p.kind === 'lamp' && p.shape === 'cone')).toBe(PENDANTS.length);
    expect(count((p) => p.kind === 'partition' && p.finish === 'glass')).toBe(PARTITIONS.length);
    expect(count((p) => p.kind === 'window' && p.finish === 'glass')).toBe(
      BACK_WINDOWS.length + LEFT_WINDOWS.length
    );
    for (const kind of ['desk', 'table', 'storage', 'lounge', 'charging', 'rug', 'wall-decor']) {
      expect(count((p) => p.kind === kind), kind).toBeGreaterThan(0);
    }
  });

  it('stays inside the building', () => {
    for (const part of parts) {
      const label = JSON.stringify(part);
      expect(part.w, label).toBeGreaterThan(0);
      expect(part.d, label).toBeGreaterThan(0);
      expect(part.h, label).toBeGreaterThan(0);
      // The leaves of a plant by the edge of the floor may hang over it a little
      const over = (part.kind === 'plant' && part.shape === 'ball' ? 0.3 : 0) + 1e-9;
      expect(part.x - part.w / 2, label).toBeGreaterThanOrEqual(-WALL_THICKNESS - over);
      expect(part.x + part.w / 2, label).toBeLessThanOrEqual(FLOOR_WIDTH + over);
      expect(part.y - part.d / 2, label).toBeGreaterThanOrEqual(-WALL_THICKNESS - over);
      expect(part.y + part.d / 2, label).toBeLessThanOrEqual(FLOOR_DEPTH + over);
      expect(part.z - part.h / 2, label).toBeGreaterThanOrEqual(-0.5);
      // Only the cords of the lamps reach above the walls
      expect(part.z + part.h / 2, label).toBeLessThanOrEqual(part.kind === 'lamp' ? 4 : WALL_HEIGHT + 1e-9);
    }
  });

  it('lights only what shines by itself differently at night', () => {
    for (const part of parts) {
      if (part.night) expect(part.finish, JSON.stringify(part)).toBe('glow');
    }
  });

  it('lights the room at night from every lamp, and shows something on both screens', () => {
    expect(ROOM_LAMPS.length).toBe(PENDANTS.length + 1);
    for (const lamp of [...ROOM_LAMPS, ...ROOM_LIGHTS]) expect(onFloor(lamp)).toBe(true);
    // A handful of lights for the whole office, not one per lamp
    expect(ROOM_LIGHTS.length).toBeLessThanOrEqual(6);
    expect(WALL_SCREENS.map((screen) => screen.shows).sort()).toEqual(['chart', 'slide']);
  });
});
