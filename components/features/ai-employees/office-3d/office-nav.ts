/**
 * How an AI employee walks from one place of the office floor to another (#1135, #1149): around
 * the desks, the plants and the sofas, through the doors in the glass partitions, the shortest
 * way. The floor and what stands on it are the ones of the 2D office (office-map-layout.ts,
 * office-furniture.ts): x along the back wall, y towards the viewer.
 *
 * The floor is laid out as a grid of small cells; a cell is closed when it is nearer to a piece
 * of furniture, a partition or the edge of the floor than a walker needs. The way is the shortest
 * one over the open cells (A*), then straightened: every corner that can be cut without touching
 * anything is cut.
 *
 * Pure functions: the 3D scene only draws what these return.
 */
import { OBSTACLES, type Obstacle, doorOf } from '../office-furniture';
import {
  AREA_RECTS,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  type FloorPoint,
  OFFICE_AREAS,
  type OfficeArea,
} from '../office-map-layout';

export { doorOf };

/** The middle line of the corridor */
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

/** The side of a cell of the grid */
const CELL = 0.1;
/**
 * How far a walker keeps from what it goes around. The office is furnished like the 2D picture,
 * closely: more than this would close the aisles between the desks.
 */
export const WALK_CLEARANCE = 0.18;
const COLUMNS = Math.round(FLOOR_WIDTH / CELL);
const ROWS = Math.round(FLOOR_DEPTH / CELL);

const cellOf = (value: number, count: number) =>
  Math.min(count - 1, Math.max(0, Math.floor(value / CELL)));
const centre = (index: number) => (index + 0.5) * CELL;

/** Closes the cells whose centre is within the clearance of the obstacle */
function close(grid: Uint8Array, obstacle: Obstacle): void {
  const x0 = obstacle.x - WALK_CLEARANCE;
  const x1 = obstacle.x + obstacle.w + WALK_CLEARANCE;
  const y0 = obstacle.y - WALK_CLEARANCE;
  const y1 = obstacle.y + obstacle.h + WALK_CLEARANCE;
  for (let row = cellOf(y0, ROWS); row <= cellOf(y1, ROWS); row++) {
    const y = centre(row);
    if (y < y0 || y > y1) continue;
    for (let column = cellOf(x0, COLUMNS); column <= cellOf(x1, COLUMNS); column++) {
      const x = centre(column);
      if (x >= x0 && x <= x1) grid[row * COLUMNS + column] = 1;
    }
  }
}

let fixed: Uint8Array | null = null;
/** The cells closed by everything but the chairs, and by the edge of the floor */
function fixedGrid(): Uint8Array {
  if (fixed) return fixed;
  const grid = new Uint8Array(COLUMNS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const x = centre(column);
      const y = centre(row);
      if (
        x < WALK_CLEARANCE ||
        x > FLOOR_WIDTH - WALK_CLEARANCE ||
        y < WALK_CLEARANCE ||
        y > FLOOR_DEPTH - WALK_CLEARANCE
      ) {
        grid[row * COLUMNS + column] = 1;
      }
    }
  }
  for (const obstacle of OBSTACLES) if (!obstacle.seat) close(grid, obstacle);
  fixed = grid;
  return grid;
}

const within = (point: FloorPoint, r: Obstacle) =>
  point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h;

/**
 * The grid for a walk between the two points: a chair is in the way, except the ones the walk
 * starts from or ends on
 */
function gridFor(from: FloorPoint, to: FloorPoint): Uint8Array {
  const grid = fixedGrid().slice();
  for (const obstacle of OBSTACLES) {
    if (obstacle.seat && !within(from, obstacle) && !within(to, obstacle)) close(grid, obstacle);
  }
  return grid;
}

/** The open cell nearest to the point (the point's own cell when it is open) */
function openCellNear(grid: Uint8Array, point: FloorPoint): number {
  const column = cellOf(point.x, COLUMNS);
  const row = cellOf(point.y, ROWS);
  for (let reach = 0; reach < Math.max(COLUMNS, ROWS); reach++) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let r = row - reach; r <= row + reach; r++) {
      if (r < 0 || r >= ROWS) continue;
      for (let c = column - reach; c <= column + reach; c++) {
        if (c < 0 || c >= COLUMNS) continue;
        // Only the ring: the cells inside it were looked at before
        if (Math.max(Math.abs(r - row), Math.abs(c - column)) !== reach) continue;
        if (grid[r * COLUMNS + c]) continue;
        const distance = Math.hypot(centre(c) - point.x, centre(r) - point.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = r * COLUMNS + c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return row * COLUMNS + column;
}

const pointOf = (cell: number): FloorPoint => ({
  // Rounded: sums of the cell size would leave 3.4500000000000006
  x: Math.round(centre(cell % COLUMNS) * 100) / 100,
  y: Math.round(centre(Math.floor(cell / COLUMNS)) * 100) / 100,
});

/** Whether the straight line between the two points touches no closed cell */
function clear(grid: Uint8Array, a: FloorPoint, b: FloorPoint): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const column = cellOf(a.x + (b.x - a.x) * t, COLUMNS);
    const row = cellOf(a.y + (b.y - a.y) * t, ROWS);
    if (grid[row * COLUMNS + column]) return false;
  }
  return true;
}

const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** The shortest way over the open cells from one cell to another (A*), or null when there is none */
function cellsBetween(grid: Uint8Array, start: number, goal: number): number[] | null {
  const cost = new Float32Array(COLUMNS * ROWS).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(COLUMNS * ROWS).fill(-1);
  const done = new Uint8Array(COLUMNS * ROWS);
  const goalColumn = goal % COLUMNS;
  const goalRow = Math.floor(goal / COLUMNS);
  const guess = (cell: number) =>
    Math.hypot((cell % COLUMNS) - goalColumn, Math.floor(cell / COLUMNS) - goalRow);
  // A binary heap of [cost so far + guess, cell]
  const heap: [number, number][] = [[guess(start), start]];
  const push = (entry: [number, number]) => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((heap[parent] as [number, number])[0] <= entry[0]) break;
      heap[i] = heap[parent] as [number, number];
      i = parent;
    }
    heap[i] = entry;
  };
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= heap.length) break;
        if (
          child + 1 < heap.length &&
          (heap[child + 1] as [number, number])[0] < (heap[child] as [number, number])[0]
        ) {
          child += 1;
        }
        if ((heap[child] as [number, number])[0] >= last[0]) break;
        heap[i] = heap[child] as [number, number];
        i = child;
      }
      heap[i] = last;
    }
    return top;
  };
  cost[start] = 0;
  while (heap.length > 0) {
    const [, cell] = pop();
    if (done[cell]) continue;
    done[cell] = 1;
    if (cell === goal) {
      const cells = [cell];
      for (let at = cameFrom[cell] as number; at >= 0; at = cameFrom[at] as number) cells.push(at);
      return cells.reverse();
    }
    const column = cell % COLUMNS;
    const row = Math.floor(cell / COLUMNS);
    for (const [dx, dy, length] of STEPS) {
      const c = column + dx;
      const r = row + dy;
      if (c < 0 || c >= COLUMNS || r < 0 || r >= ROWS) continue;
      const next = r * COLUMNS + c;
      if (grid[next] || done[next]) continue;
      // No cutting of a corner: a diagonal step needs both cells beside it open
      if (dx !== 0 && dy !== 0 && (grid[row * COLUMNS + c] || grid[r * COLUMNS + column])) continue;
      const reached = (cost[cell] as number) + length;
      if (reached < (cost[next] as number)) {
        cost[next] = reached;
        cameFrom[next] = cell;
        push([reached + guess(next), next]);
      }
    }
  }
  return null;
}

/**
 * The way from one point to another as a line of points, the first being `from` and the last
 * `to`: around the furniture and through the doors. When the floor offers no way (it always
 * does between the places of the office), the straight line.
 */
export function routeBetween(from: FloorPoint, to: FloorPoint): FloorPoint[] {
  if (from.x === to.x && from.y === to.y) return [from];
  const grid = gridFor(from, to);
  const start = openCellNear(grid, from);
  const goal = openCellNear(grid, to);
  const cells = cellsBetween(grid, start, goal);
  if (!cells) return [from, to];
  // From the seat to the nearest open cell and from the last one to the seat it is a step or two,
  // straight
  const way = [from, ...cells.map(pointOf), to];
  const points: FloorPoint[] = [from];
  let anchor = 0;
  while (anchor < way.length - 1) {
    // The farthest point that can be walked to in a straight line
    let next = anchor + 1;
    for (let i = way.length - 1; i > anchor + 1; i--) {
      if (clear(grid, way[anchor] as FloorPoint, way[i] as FloorPoint)) {
        next = i;
        break;
      }
    }
    points.push(way[next] as FloorPoint);
    anchor = next;
  }
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
