/**
 * What stands in the virtual office and where (#1149), in the floor units of office-map-layout.ts
 * (x along the back wall, y towards the viewer, z up). Pure data: the 2D scene (office-scene.ts)
 * draws it, the 3D scenery (office-3d/office-scenery-3d.ts) builds it, and the walking routes
 * (office-3d/office-nav.ts) go around it. One place for the three, so that a desk, a door or a
 * plant is at the same spot in both pictures and nobody walks through it.
 *
 * The pieces there is only one of (the sofa, the counters, the cabinet, the credenza, the meeting
 * table, the bench) are drawn part by part in each picture; here are their footprints, which the
 * 3D scenery and the routes read. office-scene.ts draws them at the same numbers.
 */
import { AI_EMPLOYEE_ROLES } from '@/lib/features/ai-employees/types/roles';
import {
  AREA_RECTS,
  CHARGING_PADS,
  DESK_SEATS,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  type FloorPoint,
  type FloorRect,
  type OfficeArea,
  ROLE_DESKS,
  SEAT_BEHIND_DESK,
  TRAINING_DESKS,
} from './office-map-layout';

/** How high the two back walls are */
export const WALL_HEIGHT = 3.2;
/** How thick they are (they stand outside the floor) */
export const WALL_THICKNESS = 0.3;

/** The windows of the back wall (along x) and of the left wall (along y): from, to */
export const BACK_WINDOWS: readonly (readonly [number, number])[] = [
  [0.6, 4.7],
  [5.3, 9.4],
  [17.4, 19.3],
];
export const LEFT_WINDOWS: readonly (readonly [number, number])[] = [
  [0.6, 3.8],
  [4.3, 7.5],
];
/** A window reaches from its sill to its top */
export const WINDOW_SILL = 0.3;
export const WINDOW_TOP = 2.9;

/**
 * Where the pendant lamps hang: over the aisles, the tables and the counter. None hangs between
 * the viewer and a place where a robot can be (in the 2D picture a lamp is drawn 2.85 above its
 * floor point, so it would cover the robot); the test checks it.
 */
export const PENDANTS: readonly (readonly [number, number])[] = [
  [3.6, 6.6],
  [7.2, 6.6],
  [8.6, 3.9],
  [12.4, 5.9],
  [20.4, 6.9],
  [12.3, 11.2],
  [7.2, 11.0],
  [7.5, 15.6],
  [4.7, 9],
  [13.3, 9],
  [19.7, 9],
  [22.1, 13.6],
];
/** How high a pendant lamp hangs, and where its cord is fixed */
export const PENDANT_HEIGHT = 2.85;
export const PENDANT_CORD_TOP = 3.95;

/** How high the glass partitions between the rooms are */
export const PARTITION_HEIGHT = 1.5;

/**
 * A glass partition: it runs along y at x = `at` (`along: 'y'`), or along x at y = `at`, from
 * `from` to `to`. The gaps between them are the doors.
 */
export interface Partition {
  along: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

const CORRIDOR = AREA_RECTS.corridor;
const partition = (along: 'x' | 'y', at: number, from: number, to: number): Partition => ({
  along,
  at,
  from,
  to,
});

export const PARTITIONS: readonly Partition[] = [
  // Between the sales floor, the marketing room and the engineering room: a door in each
  partition('y', 10, 0, 3),
  partition('y', 10, 4.4, 8),
  partition('y', 17, 0, 3),
  partition('y', 17, 4.4, 8),
  // Between the back rooms and the corridor
  partition('x', CORRIDOR.y, 0, 4),
  partition('x', CORRIDOR.y, 5.4, 12.6),
  partition('x', CORRIDOR.y, 14, 19),
  partition('x', CORRIDOR.y, 20.4, 24),
  // Between the corridor and the front rooms
  partition('x', CORRIDOR.y + CORRIDOR.h, 0, 3),
  partition('x', CORRIDOR.y + CORRIDOR.h, 4.4, 10.5),
  partition('x', CORRIDOR.y + CORRIDOR.h, 13.5, 17.2),
  partition('x', CORRIDOR.y + CORRIDOR.h, 18.6, 21.4),
  partition('x', CORRIDOR.y + CORRIDOR.h, 22.8, 24),
  // Between the front rooms
  partition('y', 8, 10, 16),
  partition('y', 16, 10, 16),
  partition('y', 20, 10, 16),
];

/**
 * The door of a room onto the corridor: the middle of the gap in the partitions on its side of
 * the corridor
 */
export function doorOf(area: Exclude<OfficeArea, 'corridor'>): FloorPoint {
  const room = AREA_RECTS[area];
  const y = room.y < CORRIDOR.y ? CORRIDOR.y : CORRIDOR.y + CORRIDOR.h;
  const glass = PARTITIONS.filter((p) => p.along === 'x' && p.at === y).sort(
    (a, b) => a.from - b.from
  );
  for (let i = 1; i < glass.length; i++) {
    const from = (glass[i - 1] as Partition).to;
    const to = (glass[i] as Partition).from;
    const middle = (from + to) / 2;
    if (middle > room.x && middle < room.x + room.w) return { x: middle, y };
  }
  throw new Error(`The ${area} room has no door onto the corridor`);
}

/** A desk with its monitors; whoever works there sits behind it (office-map-layout.ts) */
export interface DeskPlace {
  x: number;
  y: number;
  w: number;
  d: number;
  monitors: 1 | 2;
}

const SALES_DESK_COLUMNS = [1.2, 3.2, 5.2, 7.2] as const;
const SALES_DESK_ROWS = [ROLE_DESKS.sales.y, 5.1] as const;

/** The sales floor: two rows of desks. One of them is the desk of the sales role itself */
export const SALES_DESKS: readonly DeskPlace[] = SALES_DESK_COLUMNS.flatMap((x) =>
  SALES_DESK_ROWS.filter((y) => x !== ROLE_DESKS.sales.x || y !== ROLE_DESKS.sales.y).map((y) => ({
    x,
    y,
    w: 1.8,
    d: 0.9,
    monitors: 1 as const,
  }))
);

/** The marketing room: a desk on either side of the role's own */
export const MARKETING_DESKS: readonly DeskPlace[] = [10.6, 15.0].map((x) => ({
  x,
  y: 2.0,
  w: 1.6,
  d: 0.9,
  monitors: 2 as const,
}));

/** The study desks nobody is assigned to: they fill the back row of the training room */
export const SPARE_STUDY_DESKS: readonly FloorRect[] = [
  { x: 3.2, y: 14.7, w: 1.6, h: 0.8 },
  { x: 5.5, y: 14.7, w: 1.6, h: 0.8 },
];

/** Which way a chair is turned: towards the floor's +y (the default), -y, +x or -x */
export type ChairFacing = '+y' | '-y' | '+x' | '-x';
export interface ChairPlace extends FloorPoint {
  facing: ChairFacing;
  /** Cognac leather instead of black */
  cognac?: boolean;
}

/** The chairs around the marketing room's round table */
export const MARKETING_TABLE_CHAIRS: readonly ChairPlace[] = [
  { x: 11.5, y: 5.9, facing: '+x' },
  { x: 13.3, y: 5.9, facing: '-x' },
  { x: 12.4, y: 6.85, facing: '-y' },
];
/** The chairs along the two long sides of the meeting table */
export const MEETING_CHAIRS: readonly ChairPlace[] = [20.3, 21.4, 22.5].flatMap((x) => [
  { x, y: 3.3, facing: '+y' as const, cognac: true },
  { x, y: 5.7, facing: '-y' as const, cognac: true },
]);
/** The chairs at the lounge's round table */
export const LOUNGE_CHAIRS: readonly ChairPlace[] = [
  { x: 15.35, y: 13.0, facing: '-x', cognac: true },
  { x: 13.45, y: 13.0, facing: '+x', cognac: true },
];

/** The chair of a desk: centred behind it, turned towards it */
export function chairOfDesk(desk: { x: number; y: number; w: number }): ChairPlace {
  return { x: desk.x + desk.w / 2, y: desk.y - SEAT_BEHIND_DESK, facing: '+y' };
}

/** A round table: a marble top of this radius on a brass pedestal */
export interface RoundTablePlace extends FloorPoint {
  r: number;
}
export const MARKETING_TABLE: RoundTablePlace = { x: 12.4, y: 5.9, r: 0.8 };
export const LOUNGE_TABLE: RoundTablePlace = { x: 14.4, y: 13.0, r: 0.85 };

export interface PlantPlace extends FloorPoint {
  /** Grows on a stem */
  tall?: boolean;
}
/** The plants, by the room they stand in */
export const PLANTS: Readonly<
  Record<
    'sales' | 'marketing' | 'engineering' | 'corridor' | 'lounge' | 'backoffice',
    readonly PlantPlace[]
  >
> = {
  sales: [
    { x: 9.4, y: 0.7, tall: true },
    { x: 9.5, y: 4.0 },
  ],
  marketing: [{ x: 10.6, y: 7.4 }],
  engineering: [
    { x: 17.6, y: 7.4 },
    { x: 23.5, y: 0.7, tall: true },
  ],
  corridor: [
    { x: 0.5, y: 9, tall: true },
    { x: 23.5, y: 9 },
  ],
  lounge: [
    { x: 8.6, y: 15.5 },
    { x: 13.2, y: 15.4, tall: true },
  ],
  backoffice: [{ x: 23.7, y: 10.5, tall: true }],
};
/** A planter is a square of this side */
export const PLANTER_SIDE = 0.48;

/** The server racks of the marketing room */
export const SERVER_RACKS: readonly FloorRect[] = [4.8, 5.8].map((y) => ({
  x: 15.6,
  y,
  w: 0.8,
  h: 0.9,
}));

// ---- The pieces there is only one of: their footprints ------------------------------------
/** The credenza with the printer, on the sales floor */
export const CREDENZA: FloorRect = { x: 0.3, y: 6.75, w: 1.3, h: 0.6 };
/** The meeting table of the engineering room, and the rug under it */
export const MEETING_TABLE: FloorRect = { x: 19.8, y: 3.7, w: 3.2, h: 1.6 };
export const MEETING_RUG: FloorRect = { x: 19.3, y: 2.9, w: 4.2, h: 3.3 };
/** The lounge: the counter with the espresso machine, the drinks cabinet, the sofa, the table */
export const LOUNGE_COUNTER: FloorRect = { x: 11, y: 10.15, w: 4, h: 0.7 };
export const DRINKS_CABINET: FloorRect = { x: 15.0, y: 10.15, w: 0.85, h: 0.7 };
export const SOFA: FloorRect = { x: 8.6, y: 11.2, w: 1.0, h: 3.8 };
export const COFFEE_TABLE: FloorRect = { x: 10.9, y: 12.4, w: 1.2, h: 1.6 };
export const LOUNGE_RUG: FloorRect = { x: 8.7, y: 11, w: 4.2, h: 4.4 };
export const FLOOR_LAMP: FloorPoint = { x: 8.45, y: 10.5 };
/** The chargers the pads of the charging station are wired to, one per pad */
export const CHARGERS: readonly FloorRect[] = CHARGING_PADS.map((pad) => ({
  x: 19.5,
  y: pad.y + pad.d / 2 - 0.3,
  w: 0.3,
  h: 0.6,
}));
/** The reception: a leather bench and the mat at the entrance */
export const RECEPTION_BENCH: FloorRect = { x: 23.2, y: 13.2, w: 0.6, h: 2.0 };
export const ENTRANCE_MAT: FloorRect = { x: 21.6, y: 14.8, w: 1.6, h: 1.0 };

// ---- What a walker goes around --------------------------------------------------------------
/** Half the side of a chair's seat */
const CHAIR_HALF = 0.3;

/** A piece of the floor nobody walks through. A seat is free for whoever sits on it. */
export interface Obstacle extends FloorRect {
  seat?: boolean;
}

const around = (point: FloorPoint, half: number): FloorRect => ({
  x: point.x - half,
  y: point.y - half,
  w: half * 2,
  h: half * 2,
});
const ofDesk = (desk: { x: number; y: number; w: number; d: number }): FloorRect => ({
  x: desk.x,
  y: desk.y,
  w: desk.w,
  h: desk.d,
});

/** Every desk of the office that has a chair behind it */
export const ALL_DESKS: readonly { x: number; y: number; w: number; d: number }[] = [
  ...AI_EMPLOYEE_ROLES.map((role) => ROLE_DESKS[role]),
  ...SALES_DESKS,
  ...MARKETING_DESKS,
  ...TRAINING_DESKS,
  ...SPARE_STUDY_DESKS.map((desk) => ({ x: desk.x, y: desk.y, w: desk.w, d: desk.h })),
];

/** Every chair of the office */
export const ALL_CHAIRS: readonly ChairPlace[] = [
  ...AI_EMPLOYEE_ROLES.map((role) => ({ ...DESK_SEATS[role], facing: '+y' as const })),
  ...[...SALES_DESKS, ...MARKETING_DESKS, ...TRAINING_DESKS].map(chairOfDesk),
  ...SPARE_STUDY_DESKS.map(chairOfDesk),
  ...MARKETING_TABLE_CHAIRS,
  ...MEETING_CHAIRS,
  ...LOUNGE_CHAIRS,
];

const GLASS_HALF = 0.03;

/** The furniture, the partitions and the chairs: what the routes go around */
export const OBSTACLES: readonly Obstacle[] = [
  ...ALL_DESKS.map(ofDesk),
  ...ALL_CHAIRS.map((chair) => ({ ...around(chair, CHAIR_HALF), seat: true })),
  ...Object.values(PLANTS)
    .flat()
    .map((plant) => around(plant, PLANTER_SIDE / 2)),
  ...[MARKETING_TABLE, LOUNGE_TABLE].map((table) => around(table, table.r * 0.8)),
  ...SERVER_RACKS,
  CREDENZA,
  MEETING_TABLE,
  { ...LOUNGE_COUNTER, x: LOUNGE_COUNTER.x - 0.05, y: LOUNGE_COUNTER.y - 0.05, w: 4.1, h: 0.8 },
  DRINKS_CABINET,
  SOFA,
  COFFEE_TABLE,
  around(FLOOR_LAMP, 0.2),
  ...CHARGERS,
  RECEPTION_BENCH,
  ...PARTITIONS.map((p) =>
    p.along === 'x'
      ? { x: p.from, y: p.at - GLASS_HALF, w: p.to - p.from, h: GLASS_HALF * 2 }
      : { x: p.at - GLASS_HALF, y: p.from, w: GLASS_HALF * 2, h: p.to - p.from }
  ),
];

/** Whether the point is on the floor of the building */
export function onFloor(point: FloorPoint): boolean {
  return point.x >= 0 && point.x <= FLOOR_WIDTH && point.y >= 0 && point.y <= FLOOR_DEPTH;
}
