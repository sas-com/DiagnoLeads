/**
 * Everything of the 3D office that does not move (#1149): the building (slab, the two back walls
 * with their window frames, the glass partitions), the furniture, the plants and the lamps, as a
 * list of simple solids. It is the office of the 2D picture (office-scene.ts) built instead of
 * drawn: the same pieces at the same places (office-map-layout.ts, office-furniture.ts), in the
 * same materials: walnut on black steel, marble, brass, leather, velvet.
 *
 * Floor units and axes as in the 2D office: x along the back wall, y towards the viewer, z up.
 * A part is given by its centre and its size; the renderer (office-scenery-3d-view.tsx) draws all
 * parts of one shape and finish in one call.
 *
 * Pure: the test counts the pieces and checks that they stay inside the building.
 */
import { AI_EMPLOYEE_ROLES } from '@/lib/features/ai-employees/types/roles';
import {
  ALL_CHAIRS,
  BACK_WINDOWS,
  CHARGERS,
  COFFEE_TABLE,
  CREDENZA,
  type ChairPlace,
  DRINKS_CABINET,
  type DeskPlace,
  ENTRANCE_MAT,
  FLOOR_LAMP,
  LEFT_WINDOWS,
  LOUNGE_COUNTER,
  LOUNGE_RUG,
  LOUNGE_TABLE,
  MARKETING_DESKS,
  MARKETING_TABLE,
  MEETING_RUG,
  MEETING_TABLE,
  PARTITIONS,
  PARTITION_HEIGHT,
  PENDANTS,
  PENDANT_CORD_TOP,
  PENDANT_HEIGHT,
  PLANTER_SIDE,
  PLANTS,
  type PlantPlace,
  RECEPTION_BENCH,
  type RoundTablePlace,
  SALES_DESKS,
  SERVER_RACKS,
  SOFA,
  SPARE_STUDY_DESKS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WINDOW_SILL,
  WINDOW_TOP,
} from '../office-furniture';
import {
  AREA_RECTS,
  CHARGING_PADS,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  type FloorRect,
  ROLE_DESKS,
  TRAINING_DESKS,
} from '../office-map-layout';

export type SceneryShape = 'box' | 'cylinder' | 'cone' | 'ball';
/**
 * How a surface takes the light: `matte` plaster and cloth, `satin` wood, leather and laminate,
 * `polished` marble, `metal` brass and steel, `glass`, and `glow` for what shines by itself
 * (a lamp, a status light) and is not lit by the room.
 */
export type SceneryFinish = 'matte' | 'satin' | 'polished' | 'metal' | 'glass' | 'glow';
/** What a part belongs to */
export type SceneryKind =
  | 'building'
  | 'window'
  | 'wall-decor'
  | 'partition'
  | 'desk'
  | 'chair'
  | 'plant'
  | 'table'
  | 'lamp'
  | 'storage'
  | 'lounge'
  | 'charging'
  | 'rug';

export interface SceneryPart {
  kind: SceneryKind;
  shape: SceneryShape;
  finish: SceneryFinish;
  colour: string;
  /** For what glows: its colour at night, when the lamps are on */
  night?: string;
  /** The centre */
  x: number;
  y: number;
  z: number;
  /** The size along x, along y and up. A cylinder, a cone and a ball are as wide as `w` and `d` */
  w: number;
  d: number;
  h: number;
}

const WALNUT = '#7b5235';
const WALNUT_DARK = '#5f3d26';
const MARBLE = '#f0eee9';
const STEEL = '#23282f';
const BRASS = '#c9a25a';
const LEATHER = '#30353d';
const COGNAC = '#a0643c';
const EMERALD = '#1f6b54';
const WALL = '#e8e2d9';
const FRAME = '#15181d';
const GLASS = '#bcd5e4';
/** The warm light of a lamp that is on */
const LAMP_LIGHT = '#ffe2a0';

type Look = readonly [finish: SceneryFinish, colour: string, night?: string];

/** Collects the parts of the office while it is built */
class Builder {
  readonly parts: SceneryPart[] = [];
  kind: SceneryKind = 'building';

  /** A box from its corner, like the boxes of the 2D scene */
  box(x: number, y: number, z: number, w: number, d: number, h: number, look: Look): void {
    this.add('box', x + w / 2, y + d / 2, z + h / 2, w, d, h, look);
  }
  /** A standing cylinder of the diameter, from `z` up */
  cylinder(x: number, y: number, z: number, diameter: number, h: number, look: Look): void {
    this.add('cylinder', x, y, z + h / 2, diameter, diameter, h, look);
  }
  /** A shade: narrow at the top, as wide as the diameter at `z` */
  cone(x: number, y: number, z: number, diameter: number, h: number, look: Look): void {
    this.add('cone', x, y, z + h / 2, diameter, diameter, h, look);
  }
  ball(x: number, y: number, z: number, diameter: number, look: Look): void {
    this.add('ball', x, y, z, diameter, diameter, diameter, look);
  }
  private add(
    shape: SceneryShape,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    [finish, colour, night]: Look
  ): void {
    this.parts.push({ kind: this.kind, shape, finish, colour, night, x, y, z, w, d, h });
  }
}

/** A desk like the ones of the 2D office: a walnut top on two steel legs, keyboard and monitors */
function desk(b: Builder, { x, y, w, d, monitors }: DeskPlace): void {
  b.box(x + 0.05, y + 0.08, 0, 0.07, d - 0.16, 0.68, ['metal', STEEL]);
  b.box(x + w - 0.12, y + 0.08, 0, 0.07, d - 0.16, 0.68, ['metal', STEEL]);
  b.box(x, y, 0.68, w, d, 0.06, ['satin', WALNUT]);
  b.box(x + w * 0.3, y + d * 0.14, 0.74, w * 0.4, d * 0.24, 0.025, ['satin', '#d9dde3']);
  const mw = monitors === 2 ? w * 0.36 : w * 0.5;
  const starts = monitors === 2 ? [x + w * 0.1, x + w * 0.54] : [x + w * 0.25];
  for (const mx of starts) {
    b.box(mx + mw / 2 - 0.07, y + d - 0.2, 0.74, 0.14, 0.1, 0.14, ['satin', '#3b424d']);
    b.box(mx, y + d - 0.24, 0.86, mw, 0.05, 0.46, ['satin', '#1d2127']);
  }
}

function studyDesk(b: Builder, { x, y, w, h: d }: FloorRect): void {
  b.box(x + 0.05, y + 0.08, 0, 0.07, d - 0.16, 0.66, ['metal', STEEL]);
  b.box(x + w - 0.12, y + 0.08, 0, 0.07, d - 0.16, 0.66, ['metal', STEEL]);
  b.box(x, y, 0.66, w, d, 0.06, ['satin', '#eceef1']);
  // An open book
  b.box(x + w / 2 - 0.36, y + 0.16, 0.72, 0.34, 0.44, 0.03, ['matte', '#ffffff']);
  b.box(x + w / 2 + 0.02, y + 0.16, 0.72, 0.34, 0.44, 0.03, ['matte', '#eef2f7']);
}

/**
 * The reception counter, where the back office works: marble with a brass line, a walnut top,
 * and the monitor on the far edge like on the desks
 */
function counter(b: Builder, { x, y, w, d }: { x: number; y: number; w: number; d: number }): void {
  b.box(x, y, 0, w, d, 1.08, ['polished', MARBLE]);
  b.box(x, y + d, 0.12, w, 0.012, 0.04, ['metal', BRASS]);
  b.box(x - 0.1, y - 0.1, 1.08, w + 0.2, d + 0.2, 0.07, ['satin', WALNUT]);
  b.box(x + w * 0.38, y + 0.05, 1.15, w * 0.24, d * 0.3, 0.025, ['satin', '#d9dde3']);
  b.box(x + w / 2 - 0.07, y + d - 0.16, 1.15, 0.14, 0.1, 0.12, ['satin', '#3b424d']);
  b.box(x + w / 2 - 0.45, y + d - 0.2, 1.25, 0.9, 0.05, 0.44, ['satin', '#1d2127']);
}

/** An office chair on its base; its backrest is on the side it is turned away from */
function chair(b: Builder, { x, y, facing, cognac }: ChairPlace): void {
  const colour = cognac ? COGNAC : LEATHER;
  b.cylinder(x, y, 0, 0.56, 0.03, ['satin', FRAME]);
  b.cylinder(x, y, 0.03, 0.08, 0.37, ['metal', '#3a4049']);
  b.box(x - 0.3, y - 0.3, 0.4, 0.6, 0.6, 0.1, ['satin', colour]);
  if (facing === '+y') b.box(x - 0.3, y - 0.36, 0.5, 0.6, 0.1, 0.66, ['satin', colour]);
  else if (facing === '-y') b.box(x - 0.3, y + 0.26, 0.5, 0.6, 0.1, 0.66, ['satin', colour]);
  else if (facing === '+x') b.box(x - 0.36, y - 0.3, 0.5, 0.1, 0.6, 0.66, ['satin', colour]);
  else b.box(x + 0.26, y - 0.3, 0.5, 0.1, 0.6, 0.66, ['satin', colour]);
}

/** A plant in a black planter with a brass rim; a tall one grows on a stem */
function plant(b: Builder, { x, y, tall }: PlantPlace): void {
  const lift = tall ? 0.75 : 0;
  b.cylinder(x, y, 0, PLANTER_SIDE, 0.62, ['satin', '#22262d']);
  b.cylinder(x, y, 0.6, PLANTER_SIDE + 0.03, 0.03, ['metal', BRASS]);
  if (tall) b.cylinder(x, y, 0.62, 0.05, 0.9, ['matte', '#5b4630']);
  b.ball(x + 0.05, y + 0.12, 0.98 + lift, 0.58, ['matte', '#1d5c3a']);
  b.ball(x, y, 1.15 + lift, 0.76, ['matte', '#2a8a55']);
  b.ball(x + 0.2, y - 0.1, 1.36 + lift, 0.58, ['matte', '#36a468']);
  b.ball(x - 0.15, y + 0.1, 1.48 + lift, 0.54, ['matte', '#226f45']);
  b.ball(x - 0.2, y - 0.14, 1.08 + lift, 0.5, ['matte', '#2f9a5f']);
  b.ball(x + 0.14, y + 0.2, 1.27 + lift, 0.44, ['matte', '#3fae70']);
}

/** A round table: a marble top on a brass pedestal */
function roundTable(b: Builder, { x, y, r }: RoundTablePlace): void {
  b.cylinder(x, y, 0, 0.62, 0.03, ['metal', BRASS]);
  b.cylinder(x, y, 0.03, 0.2, 0.67, ['metal', BRASS]);
  b.cylinder(x, y, 0.7, r * 2, 0.05, ['polished', MARBLE]);
}

/** A pendant lamp on its cord: a brass shade, and the bulb that is on at night */
function pendant(b: Builder, x: number, y: number): void {
  const shadeTop = PENDANT_HEIGHT + 0.28;
  b.cylinder(x, y, shadeTop, 0.02, PENDANT_CORD_TOP - shadeTop, ['satin', STEEL]);
  b.cone(x, y, PENDANT_HEIGHT, 0.6, 0.28, ['metal', BRASS]);
  b.ball(x, y, PENDANT_HEIGHT + 0.02, 0.22, ['glow', '#f6efdc', '#fff3cf']);
}

/** A rug lying on the floor, with a border of another colour */
function rug(b: Builder, r: FloorRect, colour: string, border: Look, inset: number): void {
  b.box(r.x, r.y, 0.004, r.w, r.h, 0.016, ['matte', colour]);
  const x0 = r.x + inset;
  const y0 = r.y + inset;
  const w = r.w - inset * 2;
  const d = r.h - inset * 2;
  b.box(x0, y0, 0.02, w, 0.035, 0.004, border);
  b.box(x0, y0 + d - 0.035, 0.02, w, 0.035, 0.004, border);
  b.box(x0, y0, 0.02, 0.035, d, 0.004, border);
  b.box(x0 + w - 0.035, y0, 0.02, 0.035, d, 0.004, border);
}

/**
 * A back wall with its windows: the wall between, under and over them, and for each window a
 * black frame with mullions and a transom. `along` is the axis the wall runs along; it stands
 * outside the floor, behind 0 on the other axis.
 */
function wall(
  b: Builder,
  along: 'x' | 'y',
  from: number,
  to: number,
  windows: readonly (readonly [number, number])[]
): void {
  /** A box given along the wall (`u`), into the wall (`depth` from its inner face, `t` thick) */
  const piece = (
    u: number,
    length: number,
    z: number,
    h: number,
    depth: number,
    t: number,
    look: Look
  ) => {
    if (along === 'x') b.box(u, -depth - t, z, length, t, h, look);
    else b.box(-depth - t, u, z, t, length, h, look);
  };
  const solid: Look = ['matte', WALL];
  let at = from;
  for (const [a, c] of windows) {
    b.kind = 'building';
    piece(at, a - at, 0, WALL_HEIGHT, 0, WALL_THICKNESS, solid);
    piece(a, c - a, 0, WINDOW_SILL, 0, WALL_THICKNESS, solid);
    piece(a, c - a, WINDOW_TOP, WALL_HEIGHT - WINDOW_TOP, 0, WALL_THICKNESS, solid);
    at = c;

    b.kind = 'window';
    const frame: Look = ['satin', FRAME];
    const bar = 0.07;
    const tall = WINDOW_TOP - WINDOW_SILL;
    piece(a, c - a, WINDOW_SILL, bar, 0.04, 0.12, frame);
    piece(a, c - a, WINDOW_TOP - bar, bar, 0.04, 0.12, frame);
    piece(a, c - a, WINDOW_SILL + tall * 0.74, bar * 0.7, 0.05, 0.1, frame);
    const panes = Math.max(1, Math.round((c - a) / 1.05));
    for (let i = 0; i <= panes; i++) {
      const u = a + ((c - a - bar) * i) / panes;
      piece(u, bar, WINDOW_SILL, tall, 0.04, 0.12, frame);
    }
    // The sill inside, and the glass
    piece(a - 0.05, c - a + 0.1, WINDOW_SILL - 0.04, 0.04, -0.08, 0.2, ['polished', MARBLE]);
    piece(a, c - a, WINDOW_SILL, tall, 0.09, 0.02, ['glass', GLASS]);
  }
  b.kind = 'building';
  piece(at, to - at, 0, WALL_HEIGHT, 0, WALL_THICKNESS, solid);
}

/** A walnut panel of vertical slats on the inner face of a wall */
function slatPanel(b: Builder, along: 'x' | 'y', from: number, to: number): void {
  const on = (u: number, length: number, depth: number, t: number, look: Look) => {
    if (along === 'x') b.box(u, depth, 0, length, t, WALL_HEIGHT, look);
    else b.box(depth, u, 0, t, length, WALL_HEIGHT, look);
  };
  on(from, to - from, 0, 0.03, ['satin', WALNUT_DARK]);
  for (let u = from + 0.06; u < to - 0.1; u += 0.3) on(u, 0.16, 0.03, 0.035, ['satin', WALNUT]);
}

/** A screen on a wall: where its picture is, for the renderer to show something on it */
export interface WallScreen {
  wall: 'back' | 'left';
  from: number;
  to: number;
  z0: number;
  z1: number;
  /** How far its picture stands off the wall */
  off: number;
  shows: 'chart' | 'slide';
}
export const WALL_SCREENS: readonly WallScreen[] = [
  // The marketing room's wall screen, with a rising line chart
  { wall: 'back', from: 10.9, to: 15.9, z0: 1.1, z1: 2.75, off: 0.125, shows: 'chart' },
  // The training room's screen
  { wall: 'left', from: 11, to: 15, z0: 1.0, z1: 2.6, off: 0.125, shows: 'slide' },
];

let built: readonly SceneryPart[] | null = null;

/** The whole office, built once */
export function officeScenery(): readonly SceneryPart[] {
  if (built) return built;
  const b = new Builder();

  // ---- The building ------------------------------------------------------------------------
  b.kind = 'building';
  b.box(
    -WALL_THICKNESS,
    -WALL_THICKNESS,
    -0.45,
    FLOOR_WIDTH + WALL_THICKNESS,
    FLOOR_DEPTH + WALL_THICKNESS,
    0.44,
    ['matte', '#646c79']
  );
  wall(b, 'x', -WALL_THICKNESS, FLOOR_WIDTH, BACK_WINDOWS);
  wall(b, 'y', 0, FLOOR_DEPTH, LEFT_WINDOWS);
  // A brass strip on either side of the corridor
  const corridor = AREA_RECTS.corridor;
  b.box(0, corridor.y + 0.05, 0.001, FLOOR_WIDTH, 0.03, 0.006, ['metal', BRASS]);
  b.box(0, corridor.y + corridor.h - 0.08, 0.001, FLOOR_WIDTH, 0.03, 0.006, ['metal', BRASS]);

  // ---- On the walls ------------------------------------------------------------------------
  b.kind = 'wall-decor';
  slatPanel(b, 'x', 10.2, 16.8);
  b.box(10.9, 0.065, 1.1, 5.0, 0.055, 1.65, ['satin', '#0b1220']);
  slatPanel(b, 'y', 10.4, 15.7);
  b.box(0.065, 11, 1.0, 0.055, 4, 1.6, ['satin', '#0b1220']);
  // The engineering room's glass board with sticky notes
  b.box(19.7, 0, 1.0, 3.8, 0.03, 1.6, ['polished', '#f8fafc']);
  b.box(19.66, 0, 0.96, 3.88, 0.02, 0.04, ['metal', '#9aa3af']);
  for (const [u, z, colour] of [
    [20.0, 1.9, '#fde047'],
    [20.6, 1.9, '#f9a8d4'],
    [21.2, 1.9, '#7dd3fc'],
    [20.0, 1.3, '#bef264'],
    [20.6, 1.3, '#fde047'],
  ] as const) {
    b.box(u, 0.03, z, 0.45, 0.012, 0.45, ['matte', colour]);
  }
  // A framed picture where the corridor meets the left wall
  b.box(0, 8.2, 0.95, 0.04, 1.6, 1.5, ['satin', STEEL]);
  b.box(0.04, 8.25, 1.0, 0.012, 1.5, 1.4, ['matte', '#f4f1ea']);
  b.box(0.052, 8.45, 1.2, 0.008, 0.75, 0.7, ['matte', EMERALD]);
  b.box(0.06, 8.9, 1.55, 0.008, 0.65, 0.65, ['matte', BRASS]);
  b.box(0.068, 8.6, 1.95, 0.008, 0.4, 0.3, ['matte', '#27364f']);

  // ---- The glass partitions, with a black rail on top and a post at each end -----------------
  b.kind = 'partition';
  for (const p of PARTITIONS) {
    const length = p.to - p.from;
    if (p.along === 'x') {
      b.box(p.from, p.at - 0.025, 0, length, 0.05, PARTITION_HEIGHT, ['glass', GLASS]);
      b.box(p.from, p.at - 0.04, PARTITION_HEIGHT, length, 0.08, 0.05, ['satin', STEEL]);
      for (const u of [p.from, p.to - 0.07]) {
        b.box(u, p.at - 0.04, 0, 0.07, 0.08, PARTITION_HEIGHT, ['satin', STEEL]);
      }
    } else {
      b.box(p.at - 0.025, p.from, 0, 0.05, length, PARTITION_HEIGHT, ['glass', GLASS]);
      b.box(p.at - 0.04, p.from, PARTITION_HEIGHT, 0.08, length, 0.05, ['satin', STEEL]);
      for (const u of [p.from, p.to - 0.07]) {
        b.box(p.at - 0.04, u, 0, 0.08, 0.07, PARTITION_HEIGHT, ['satin', STEEL]);
      }
    }
  }

  // ---- Rugs --------------------------------------------------------------------------------
  b.kind = 'rug';
  rug(b, MEETING_RUG, '#27364f', ['metal', BRASS], 0.2);
  rug(b, LOUNGE_RUG, '#e9e2d2', ['matte', EMERALD], 0.25);
  b.box(ENTRANCE_MAT.x, ENTRANCE_MAT.y, 0.004, ENTRANCE_MAT.w, ENTRANCE_MAT.h, 0.02, [
    'matte',
    '#3b424d',
  ]);

  // ---- Desks and chairs --------------------------------------------------------------------
  b.kind = 'desk';
  for (const role of AI_EMPLOYEE_ROLES) {
    const own = ROLE_DESKS[role];
    if (own.counter) counter(b, own);
    else desk(b, own);
  }
  for (const own of [...SALES_DESKS, ...MARKETING_DESKS]) desk(b, own);
  for (const own of TRAINING_DESKS) studyDesk(b, { x: own.x, y: own.y, w: own.w, h: own.d });
  for (const own of SPARE_STUDY_DESKS) studyDesk(b, own);
  b.kind = 'chair';
  for (const own of ALL_CHAIRS) chair(b, own);

  // ---- Tables ------------------------------------------------------------------------------
  b.kind = 'table';
  roundTable(b, MARKETING_TABLE);
  roundTable(b, LOUNGE_TABLE);
  // The meeting table of the engineering room
  b.box(20.3, 4.2, 0, 0.3, 0.6, 0.68, ['metal', STEEL]);
  b.box(22.2, 4.2, 0, 0.3, 0.6, 0.68, ['metal', STEEL]);
  b.box(MEETING_TABLE.x, MEETING_TABLE.y, 0.68, MEETING_TABLE.w, MEETING_TABLE.h, 0.07, [
    'satin',
    WALNUT,
  ]);

  // ---- Storage: the credenza with the printer, the server racks ------------------------------
  b.kind = 'storage';
  b.box(CREDENZA.x, CREDENZA.y, 0, CREDENZA.w, CREDENZA.h, 0.7, ['satin', WALNUT]);
  b.box(0.5, 7.35, 0.38, 0.3, 0.012, 0.03, ['metal', BRASS]);
  b.box(1.1, 7.35, 0.38, 0.3, 0.012, 0.03, ['metal', BRASS]);
  b.box(0.45, 6.85, 0.7, 0.6, 0.42, 0.28, ['satin', '#e8eaee']);
  b.box(0.5, 6.9, 0.98, 0.5, 0.3, 0.03, ['satin', '#9aa1ab']);
  for (const rack of SERVER_RACKS) {
    b.box(rack.x, rack.y, 0, rack.w, rack.h, 2.3, ['satin', '#191c22']);
    for (let i = 0; i < 6; i++) {
      b.box(rack.x + 0.12, rack.y + rack.h, 0.4 + i * 0.3, 0.48, 0.012, 0.03, [
        'glow',
        i % 2 ? '#22c55e' : '#60a5fa',
      ]);
    }
  }

  // ---- The lounge --------------------------------------------------------------------------
  b.kind = 'lounge';
  // A marble counter with the espresso machine, two cups and a tray
  b.box(LOUNGE_COUNTER.x, LOUNGE_COUNTER.y, 0, LOUNGE_COUNTER.w, LOUNGE_COUNTER.h, 0.98, [
    'satin',
    '#262b33',
  ]);
  b.box(11, 10.85, 0.1, 4, 0.012, 0.04, ['metal', BRASS]);
  b.box(10.95, 10.1, 0.98, 4.1, 0.8, 0.07, ['polished', MARBLE]);
  b.box(11.2, 10.25, 1.05, 0.6, 0.5, 0.62, ['metal', '#c9ced6']);
  b.box(11.3, 10.75, 1.25, 0.4, 0.02, 0.2, ['satin', FRAME]);
  b.cylinder(12.19, 10.44, 1.05, 0.16, 0.18, ['polished', '#ffffff']);
  b.cylinder(12.54, 10.44, 1.05, 0.16, 0.18, ['polished', '#ffffff']);
  b.box(13.4, 10.3, 1.05, 0.5, 0.4, 0.05, ['satin', WALNUT]);
  // A drinks cabinet, lit from inside
  b.box(DRINKS_CABINET.x, DRINKS_CABINET.y, 0, DRINKS_CABINET.w, DRINKS_CABINET.h, 2.1, [
    'satin',
    '#191c22',
  ]);
  b.box(15.08, 10.85, 0.2, 0.69, 0.012, 1.75, ['glow', '#f1e3c2', LAMP_LIGHT]);
  for (const z of [0.75, 1.3]) b.box(15.08, 10.862, z, 0.69, 0.02, 0.03, ['satin', '#191c22']);
  for (const [u, z, colour] of [
    [15.2, 0.3, '#7f1d1d'],
    [15.45, 0.3, '#14532d'],
    [15.3, 0.85, '#1e3a8a'],
    [15.55, 0.85, '#7f1d1d'],
    [15.25, 1.4, '#14532d'],
    [15.5, 1.4, '#92400e'],
  ] as const) {
    b.box(u, 10.862, z, 0.12, 0.03, 0.34, ['polished', colour]);
  }
  // A velvet sofa with two cushions
  b.box(SOFA.x, SOFA.y, 0, SOFA.w, SOFA.h, 0.45, ['matte', EMERALD]);
  b.box(SOFA.x, SOFA.y, 0.45, 0.32, SOFA.h, 0.62, ['matte', '#1b5f4b']);
  b.box(SOFA.x, SOFA.y, 0.45, SOFA.w, 0.25, 0.3, ['matte', '#1b5f4b']);
  b.box(SOFA.x, SOFA.y + SOFA.h - 0.25, 0.45, SOFA.w, 0.25, 0.3, ['matte', '#1b5f4b']);
  b.box(8.95, 11.6, 0.45, 0.22, 0.5, 0.42, ['matte', '#e9e2d2']);
  b.box(8.95, 14.1, 0.45, 0.22, 0.5, 0.42, ['matte', BRASS]);
  // A marble coffee table on brass legs, a book on it
  for (const [u, v] of [
    [11.0, 12.5],
    [11.92, 12.5],
    [11.0, 13.82],
    [11.92, 13.82],
  ] as const) {
    b.box(u, v, 0, 0.08, 0.08, 0.34, ['metal', BRASS]);
  }
  b.box(COFFEE_TABLE.x, COFFEE_TABLE.y, 0.34, COFFEE_TABLE.w, COFFEE_TABLE.h, 0.06, [
    'polished',
    MARBLE,
  ]);
  b.box(11.3, 13.0, 0.4, 0.3, 0.4, 0.05, ['matte', '#27364f']);
  // The leather bench of the reception
  b.box(23.25, 13.3, 0, 0.08, 1.8, 0.3, ['metal', STEEL]);
  b.box(RECEPTION_BENCH.x, RECEPTION_BENCH.y, 0.3, RECEPTION_BENCH.w, RECEPTION_BENCH.h, 0.16, [
    'satin',
    COGNAC,
  ]);

  // ---- The charging station: a pad with a brass ring per role, wired to a slim charger -------
  b.kind = 'charging';
  CHARGING_PADS.forEach((pad, index) => {
    const cx = pad.x + pad.w / 2;
    const cy = pad.y + pad.d / 2;
    const ring = Math.min(pad.w, pad.d) - 0.16;
    b.box(pad.x, pad.y + 0.05, 0, pad.w, pad.d - 0.1, 0.1, ['satin', '#2b3038']);
    b.cylinder(cx, cy, 0.1, ring, 0.012, ['glow', BRASS, '#fcd34d']);
    b.cylinder(cx, cy, 0.1, ring - 0.12, 0.016, ['satin', '#2b3038']);
    const charger = CHARGERS[index] as FloorRect;
    b.box(charger.x, charger.y, 0, charger.w, charger.h, 1.25, ['satin', '#262b33']);
    b.box(charger.x - 0.012, cy - 0.15, 0.8, 0.012, 0.3, 0.2, ['glow', '#22c55e']);
    b.box(18.3, cy - 0.04, 0, 1.2, 0.08, 0.04, ['satin', FRAME]);
  });

  // ---- Plants and lamps --------------------------------------------------------------------
  b.kind = 'plant';
  for (const own of Object.values(PLANTS).flat()) plant(b, own);
  b.kind = 'lamp';
  for (const [x, y] of PENDANTS) pendant(b, x, y);
  // A floor lamp by the sofa
  b.box(FLOOR_LAMP.x - 0.15, FLOOR_LAMP.y - 0.15, 0, 0.3, 0.3, 0.05, ['metal', STEEL]);
  b.cylinder(FLOOR_LAMP.x, FLOOR_LAMP.y, 0.05, 0.03, 1.8, ['metal', BRASS]);
  b.cylinder(FLOOR_LAMP.x, FLOOR_LAMP.y, 1.85, 0.42, 0.36, ['glow', '#f3ead6', '#fff0c9']);

  built = b.parts;
  return built;
}

/** A lamp that is on at night: where its bulb is */
export interface RoomLamp {
  x: number;
  y: number;
  z: number;
  /** How strong it is next to a pendant lamp (1) */
  strength: number;
}
/** Every lamp: at night each throws a pool of light on the floor under it */
export const ROOM_LAMPS: readonly RoomLamp[] = [
  ...PENDANTS.map(([x, y]) => ({ x, y, z: PENDANT_HEIGHT - 0.1, strength: 1 })),
  { x: FLOOR_LAMP.x, y: FLOOR_LAMP.y, z: 1.9, strength: 0.6 },
];
/**
 * The light of the lamps on the furniture and the robots at night, gathered into one light per
 * part of the office: a light for each lamp would cost every surface a dozen lights to work out,
 * for a picture that looks the same
 */
export const ROOM_LIGHTS: readonly RoomLamp[] = [
  { x: 5, y: 4.4, z: 3, strength: 1 },
  { x: 13.4, y: 4.6, z: 3, strength: 0.9 },
  { x: 20.6, y: 4.8, z: 3, strength: 0.9 },
  { x: 4, y: 13, z: 3, strength: 0.8 },
  { x: 11.6, y: 12.6, z: 3, strength: 1 },
  { x: 20, y: 12.8, z: 3, strength: 0.8 },
];
