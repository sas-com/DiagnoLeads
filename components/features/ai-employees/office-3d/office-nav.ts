/**
 * How an AI employee walks from one place of the office floor to another (#1135, spike): out of
 * its room through the room's door, along the corridor, and in through the door of the other
 * room. The floor is the one of the 2D office (office-map-layout.ts): x along the back wall, y
 * towards the viewer, the corridor between the two rows of rooms.
 *
 * Pure functions: the 3D scene only draws what these return.
 */
import { AREA_RECTS, type FloorPoint, OFFICE_AREAS, type OfficeArea } from '../office-map-layout';

/** The middle line of the corridor, where the robots walk along it */
const CORRIDOR = AREA_RECTS.corridor;
export const CORRIDOR_LANE = CORRIDOR.y + CORRIDOR.h / 2;

/** The area a point of the floor lies in; the corridor for a point on no room */
export function areaAt(point: FloorPoint): OfficeArea {
  for (const area of OFFICE_AREAS) {
    if (area === 'corridor') continue;
    const r = AREA_RECTS[area];
    if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) {
      return area;
    }
  }
  return 'corridor';
}

/** The door of a room: the middle of its side on the corridor */
export function doorOf(area: Exclude<OfficeArea, 'corridor'>): FloorPoint {
  const r = AREA_RECTS[area];
  const behindCorridor = r.y < CORRIDOR.y;
  return { x: r.x + r.w / 2, y: behindCorridor ? r.y + r.h : r.y };
}

/**
 * The way from one point to another as a line of points, the first being `from` and the last
 * `to`. Inside one room it is the straight line; between rooms it passes both doors and the
 * corridor's lane.
 */
export function routeBetween(from: FloorPoint, to: FloorPoint): FloorPoint[] {
  const start = areaAt(from);
  const end = areaAt(to);
  if (start === end) return [from, to];
  const points: FloorPoint[] = [from];
  if (start !== 'corridor') {
    const door = doorOf(start);
    points.push(door, { x: door.x, y: CORRIDOR_LANE });
  } else {
    points.push({ x: from.x, y: CORRIDOR_LANE });
  }
  if (end !== 'corridor') {
    const door = doorOf(end);
    points.push({ x: door.x, y: CORRIDOR_LANE }, door);
  } else {
    points.push({ x: to.x, y: CORRIDOR_LANE });
  }
  points.push(to);
  // Two points at the same place add nothing to walk
  return points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1]?.x || point.y !== points[index - 1]?.y
  );
}

export function routeLength(route: readonly FloorPoint[]): number {
  let length = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as FloorPoint;
    const b = route[i] as FloorPoint;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/**
 * Where a walker is after `distance` along the route, and which way it faces there (radians,
 * 0 towards +y, growing towards +x). Before the start it stands at the start, after the end at
 * the end, facing along the nearest stretch.
 */
export function pointAlong(
  route: readonly FloorPoint[],
  distance: number
): FloorPoint & { heading: number } {
  const first = route[0] as FloorPoint;
  if (route.length < 2) return { ...first, heading: 0 };
  let left = Math.max(0, distance);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as FloorPoint;
    const b = route[i] as FloorPoint;
    const stretch = Math.hypot(b.x - a.x, b.y - a.y);
    const heading = Math.atan2(b.x - a.x, b.y - a.y);
    if (left <= stretch || i === route.length - 1) {
      const t = stretch === 0 ? 1 : Math.min(1, left / stretch);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading };
    }
    left -= stretch;
  }
  return { ...first, heading: 0 };
}
