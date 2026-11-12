/**
 * The virtual office drawn in isometric projection (Refs #1101): the building (floor slab, rooms,
 * back walls with tall windows, glass partitions), the furniture, the lamps and the robots
 * (office-robot.ts), as SVG primitives in painter's order. Desks, chairs and robots are turned to
 * match: a seat is behind its desk and whoever sits there faces it (office-map-layout.ts).
 *
 * Two times of day, for the light and the dark theme:
 * - day: a blue sky with the sun and the city behind the windows, sunlight falling through them
 *   on the floor
 * - night: stars and the moon, the lit windows of the city, the pendant lamps on with their pools
 *   of light, moonlight through the windows
 *
 * Materials: walnut desk tops on black steel legs, oak and walnut floors, a marble corridor and
 * reception, brass details, black window frames, leather chairs and a velvet sofa.
 *
 * Floor units: the floor is 24 x 16; x runs to the lower right of the screen, y to the lower
 * left, z up. Lit from the upper left: tops are the plain colour, the faces turned to the viewer
 * are darker. Pure; office-map.tsx renders it once for the day and once for the night.
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import {
  AREA_RECTS,
  CHARGING_PADS,
  DESK_SEATS,
  FLOOR_WIDTH,
  OFFICE_AREAS,
  type OfficeArea,
  ROLE_DESKS,
  SEAT_BEHIND_DESK,
  TRAINING_DESKS,
  spotOf,
} from './office-map-layout';
import { type PrimStyle, type SceneGradient, type ScenePrim, shade, tint } from './office-prims';
import { robotPrims } from './office-robot';

export const SCENE_WIDTH = 1000;
export const SCENE_HEIGHT = 700;

const S = 26;
const C = 0.8660254;
const OX = 390;
const OY = 132;

/** A point on the floor (or above it) on the screen */
export function project(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * C * S + OX, (x + y) * 0.5 * S - z * S + OY];
}

export interface SceneLabel {
  area: OfficeArea;
  x: number;
  y: number;
  /** The label stands above this point (over the back wall) instead of hanging below it */
  above: boolean;
}

export interface OfficeScene {
  prims: ScenePrim[];
  labels: SceneLabel[];
}

const WALNUT = '#7b5235';
const OAK = '#dcc7a6';
const MARBLE = '#f0eee9';
const STEEL = '#23282f';
const BRASS = '#c9a25a';
const LEATHER = '#30353d';
const COGNAC = '#a0643c';
const EMERALD = '#1f6b54';
const WALL = '#e8e2d9';
/** The warm light of a lamp that is on */
const LAMP_LIGHT = '#ffe2a0';

const FLOOR_COLOURS: Record<OfficeArea, string> = {
  sales: OAK,
  marketing: '#d3d8de',
  engineering: OAK,
  corridor: MARBLE,
  training: '#d9dfe8',
  lounge: '#a9825c',
  charging: '#c9ced5',
  backoffice: MARBLE,
};

type P3 = readonly [number, number, number];
type Style = Omit<PrimStyle, 'fill'>;
type OnWall = (u: number, z: number, lift?: number) => P3;

const pt = (x: number, y: number, z: number) => {
  const [sx, sy] = project(x, y, z);
  return `${sx.toFixed(1)},${sy.toFixed(1)}`;
};
const pts = (list: readonly P3[]) => list.map(([x, y, z]) => pt(x, y, z)).join(' ');

/** A number between 0 and 1 that is always the same for the same seed */
function seeded(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/** A point on the back wall (along x) or on the left wall (along y), a little off the wall */
const onBack: OnWall = (u, z, lift = 0.006) => [u, lift, z];
const onLeft: OnWall = (u, z, lift = 0.006) => [lift, u, z];
const rectOn = (at: OnWall, a: number, b: number, z0: number, z1: number, lift?: number) =>
  pts([at(a, z0, lift), at(b, z0, lift), at(b, z1, lift), at(a, z1, lift)]);

/** The windows of the back wall (along x) and of the left wall (along y) */
const BACK_WINDOWS: readonly (readonly [number, number])[] = [
  [0.6, 4.7],
  [5.3, 9.4],
  [17.4, 19.3],
];
const LEFT_WINDOWS: readonly (readonly [number, number])[] = [
  [0.6, 3.8],
  [4.3, 7.5],
];

/**
 * Where the pendant lamps hang: over the aisles, the tables and the counter. None hangs between
 * the viewer and a place where a robot can be (a lamp is drawn 2.85 above its floor point, so it
 * would cover the robot); the test checks it.
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
/** How high a pendant lamp hangs */
export const PENDANT_HEIGHT = 2.85;

/** The outline of the floor on the screen, to cut the light on the floor off at its edge */
export const FLOOR_OUTLINE = pts([
  [0, 0, 0],
  [24, 0, 0],
  [24, 16, 0],
  [0, 16, 0],
]);

/**
 * The whole office for the given statuses, by day or by night. `gradient` names a gradient by
 * its id in the renderer.
 */
export function buildOfficeScene(
  statuses: Readonly<Record<AiEmployeeRole, DeskStatus>>,
  night: boolean,
  gradient: (name: SceneGradient) => string
): OfficeScene {
  // At night what is not lit goes dark; the lamps, the screens and the city stay bright
  const dim = night ? 0.46 : 1;
  const col = (hex: string) => shade(hex, dim);
  const poly = (points: string, fill: string, style: Style = {}): ScenePrim => ({
    kind: 'poly',
    points,
    fill,
    ...style,
  });
  const ellipse = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: string,
    style: Style = {}
  ): ScenePrim => ({ kind: 'ellipse', cx, cy, rx, ry, fill, ...style });
  const path = (d: string, fill: string, style: Style = {}): ScenePrim => ({
    kind: 'path',
    d,
    fill,
    ...style,
  });
  const line = (a: P3, b: P3, colour: string, op: number, sw?: number) =>
    poly(pts([a, b]), 'none', { stroke: col(colour), op, sw });

  /** A box: its top (with a lighter edge) and the two faces turned to the viewer */
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    colour: string,
    options: { op?: number; lit?: boolean } = {}
  ): ScenePrim[] => {
    const c = options.lit ? colour : col(colour);
    const op = options.op ?? 1;
    return [
      poly(
        pts([
          [x, y + d, z],
          [x + w, y + d, z],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        ]),
        shade(c, 0.84),
        { op }
      ),
      poly(
        pts([
          [x + w, y, z],
          [x + w, y + d, z],
          [x + w, y + d, z + h],
          [x + w, y, z + h],
        ]),
        shade(c, 0.66),
        { op }
      ),
      poly(
        pts([
          [x, y, z + h],
          [x + w, y, z + h],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        ]),
        c,
        { op, stroke: tint(c, 0.2) }
      ),
    ];
  };
  /** A flat patch on the floor */
  const floorPatch = (
    x: number,
    y: number,
    w: number,
    d: number,
    fill: string,
    style: Style = {}
  ) =>
    poly(
      pts([
        [x, y, 0.004],
        [x + w, y, 0.004],
        [x + w, y + d, 0.004],
        [x, y + d, 0.004],
      ]),
      fill,
      style
    );
  const shadow = (x: number, y: number, rx: number, ry: number) => {
    const [cx, cy] = project(x, y);
    return ellipse(cx, cy, rx, ry, '#0b1220', { op: night ? 0.4 : 0.22, filter: 'soft' });
  };

  // ---- The sky around the building --------------------------------------------------------
  const base: ScenePrim[] = [];
  if (night) {
    for (let i = 0; i < 46; i++) {
      base.push(
        ellipse(seeded(i + 1) * SCENE_WIDTH, seeded(i + 101) * 330, 0.9, 0.9, '#ffffff', {
          op: 0.45 + 0.5 * seeded(i + 201),
        })
      );
    }
    base.push(
      ellipse(905, 70, 44, 44, '#dfe8ff', { op: 0.28, filter: 'glow' }),
      ellipse(905, 70, 19, 19, '#f6f1dc'),
      ellipse(898, 64, 4, 4, '#e3dcc0', { op: 0.7 }),
      ellipse(911, 77, 2.6, 2.6, '#e3dcc0', { op: 0.7 })
    );
  } else {
    base.push(
      ellipse(92, 70, 86, 86, gradient('sunGlow')),
      ellipse(92, 70, 17, 17, '#fffbe8', { op: 0.95 }),
      ellipse(815, 92, 62, 15, '#ffffff', { op: 0.75, filter: 'soft' }),
      ellipse(866, 106, 40, 11, '#ffffff', { op: 0.7, filter: 'soft' }),
      ellipse(250, 40, 46, 11, '#ffffff', { op: 0.6, filter: 'soft' })
    );
  }
  // The shadow of the building on the ground
  base.push(
    poly(
      pts([
        [0, 0, -1.2],
        [24, 0, -1.2],
        [24, 16, -1.2],
        [0, 16, -1.2],
      ]),
      '#0b1220',
      { op: night ? 0.5 : 0.16, filter: 'soft' }
    )
  );

  // ---- The building: slab, floors, light on the floor, walls ------------------------------
  base.push(...box(0, 0, -0.45, 24, 16, 0.45, '#646c79'));
  for (const area of OFFICE_AREAS) {
    const r = AREA_RECTS[area];
    base.push(floorPatch(r.x, r.y, r.w, r.h, col(FLOOR_COLOURS[area])));
  }
  // Oak planks in the sales floor and the engineering room, walnut planks in the lounge
  for (let j = 1; j < 16; j++) {
    base.push(line([0, j * 0.5, 0.005], [10, j * 0.5, 0.005], '#b89f78', 0.5));
    base.push(line([17, j * 0.5, 0.005], [24, j * 0.5, 0.005], '#b89f78', 0.5));
  }
  for (let j = 1; j < 15; j++) {
    base.push(line([8, 10 + j * 0.4, 0.005], [16, 10 + j * 0.4, 0.005], '#7d5c3c', 0.6));
  }
  // Carpet tiles in the marketing room and the training room
  for (let i = 1; i < 7; i++) {
    base.push(line([10 + i, 0, 0.005], [10 + i, 8, 0.005], '#aab2bc', 0.4));
  }
  for (let j = 1; j < 8; j++) base.push(line([10, j, 0.005], [17, j, 0.005], '#aab2bc', 0.4));
  for (let i = 1; i < 8; i++) base.push(line([i, 10, 0.005], [i, 16, 0.005], '#b3bcc9', 0.4));
  // Marble slabs with veins in the corridor and the reception, a brass strip along the corridor
  for (let i = 1; i < 12; i++) {
    base.push(line([i * 2, 8, 0.005], [i * 2, 10, 0.005], '#cfcbc3', 0.8));
  }
  for (let j = 1; j < 3; j++) {
    base.push(line([20, 10 + j * 2, 0.005], [24, 10 + j * 2, 0.005], '#cfcbc3', 0.8));
  }
  for (let i = 0; i < 9; i++) {
    const x = 0.8 + i * 2.6;
    const y = 8.3 + seeded(i + 31) * 1.2;
    base.push(
      line([x, y, 0.006], [x + 1.1, y + 0.25 - seeded(i + 41) * 0.5, 0.006], '#b9b3a8', 0.55)
    );
  }
  base.push(
    line([0, 8.06, 0.006], [24, 8.06, 0.006], BRASS, 0.9, 1.4),
    line([0, 9.94, 0.006], [24, 9.94, 0.006], BRASS, 0.9, 1.4)
  );
  // Rugs: under the meeting table, in the lounge; a mat at the entrance
  base.push(
    floorPatch(19.3, 2.9, 4.2, 3.3, col('#27364f'), { op: 0.95 }),
    floorPatch(19.5, 3.1, 3.8, 2.9, 'none', { stroke: col(BRASS), op: 0.7 }),
    floorPatch(8.7, 11, 4.2, 4.4, col('#e9e2d2'), { op: 0.96 }),
    floorPatch(8.95, 11.25, 3.7, 3.9, 'none', { stroke: col(EMERALD), op: 0.8 }),
    floorPatch(21.6, 14.8, 1.6, 1.0, col('#3b424d'))
  );

  // Daylight (or moonlight) falling through the windows on the floor
  for (const [a, b] of BACK_WINDOWS) {
    base.push(
      poly(
        pts([
          [a, 0.02, 0.007],
          [b, 0.02, 0.007],
          [b + 1.0, 3.8, 0.007],
          [a + 1.0, 3.8, 0.007],
        ]),
        gradient('sun')
      )
    );
  }
  for (const [a, b] of LEFT_WINDOWS) {
    base.push(
      poly(
        pts([
          [0.02, a, 0.007],
          [0.02, b, 0.007],
          [3.8, b + 1.0, 0.007],
          [3.8, a + 1.0, 0.007],
        ]),
        gradient('sunSide')
      )
    );
  }
  // The pools of light under the lamps at night
  if (night) {
    for (const [x, y] of PENDANTS) {
      const [cx, cy] = project(x, y);
      base.push(ellipse(cx, cy, 118, 59, gradient('pool'), { clip: true }));
    }
    const [cx, cy] = project(8.9, 11.0);
    base.push(ellipse(cx, cy, 90, 45, gradient('pool'), { clip: true }));
  }

  // The back walls
  base.push(...box(-0.3, 0, 0, 0.3, 16, 3.2, WALL), ...box(-0.3, -0.3, 0, 24.3, 0.3, 3.2, WALL));

  /** A tall window with a black frame: the sky, the city behind it, reflections on the glass */
  const tallWindow = (at: OnWall, a: number, b: number, seed: number) => {
    const z0 = 0.3;
    const z1 = 2.9;
    base.push(poly(rectOn(at, a, b, z0, z1), gradient('sky')));
    let index = 0;
    for (let u = a + 0.04; u < b - 0.3; u += 0.46) {
      const h = 0.45 + 1.35 * seeded(seed + index);
      const w = Math.min(0.42, b - u - 0.04);
      base.push(
        poly(rectOn(at, u, u + w, z0, z0 + h, 0.008), night ? '#111b36' : '#a8c1da', {
          op: night ? 1 : 0.85,
        })
      );
      if (night) {
        for (let k = 0; k < 3; k++) {
          if (seeded(seed + index * 7 + k) < 0.35) continue;
          const wz = z0 + 0.15 + (h - 0.3) * seeded(seed + index * 13 + k);
          const wu = u + 0.06 + (w - 0.2) * seeded(seed + index * 17 + k);
          base.push(poly(rectOn(at, wu, wu + 0.09, wz, wz + 0.07, 0.01), LAMP_LIGHT, { op: 0.9 }));
        }
      }
      index += 1;
    }
    // Reflections across the glass
    for (const offset of [0.25, 0.75]) {
      base.push(
        poly(
          pts([
            at(a + offset, z0, 0.011),
            at(a + offset + 0.22, z0, 0.011),
            at(Math.min(b, a + offset + 1.5), z1, 0.011),
            at(Math.min(b, a + offset + 1.28), z1, 0.011),
          ]),
          '#ffffff',
          { op: night ? 0.05 : 0.2 }
        )
      );
    }
    // The frame, its mullions and a transom
    const frame = night ? '#0d1016' : '#20252c';
    base.push(poly(rectOn(at, a, b, z0, z1, 0.012), 'none', { stroke: frame, sw: 2.2 }));
    const panes = Math.max(2, Math.round((b - a) / 1.35));
    for (let i = 1; i < panes; i++) {
      const u = a + ((b - a) * i) / panes;
      base.push(
        poly(pts([at(u, z0, 0.012), at(u, z1, 0.012)]), 'none', { stroke: frame, sw: 1.4 })
      );
    }
    base.push(
      poly(pts([at(a, 2.3, 0.012), at(b, 2.3, 0.012)]), 'none', { stroke: frame, sw: 1.4 })
    );
  };
  BACK_WINDOWS.forEach(([a, b], i) => tallWindow(onBack, a, b, 11 + i * 50));
  LEFT_WINDOWS.forEach(([a, b], i) => tallWindow(onLeft, a, b, 211 + i * 50));

  /** A walnut panel of vertical slats on a wall */
  const slatPanel = (at: OnWall, a: number, b: number) => {
    base.push(poly(rectOn(at, a, b, 0, 3.2), col(WALNUT)));
    for (let u = a + 0.3; u < b - 0.05; u += 0.3) {
      base.push(
        poly(pts([at(u, 0, 0.008), at(u, 3.2, 0.008)]), 'none', {
          stroke: col('#5a3a24'),
          op: 0.7,
        })
      );
    }
  };
  // The marketing room's wall screen on its walnut panel, with a rising line chart
  slatPanel(onBack, 10.2, 16.8);
  base.push(
    poly(rectOn(onBack, 10.9, 15.9, 1.1, 2.75, 0.01), '#0b1220', { stroke: '#2a2f37', sw: 1.6 }),
    poly(
      pts([
        onBack(11.2, 1.45, 0.012),
        onBack(12.2, 1.8, 0.012),
        onBack(13.1, 1.65, 0.012),
        onBack(14.0, 2.15, 0.012),
        onBack(15.0, 2.0, 0.012),
        onBack(15.6, 2.5, 0.012),
      ]),
      'none',
      { stroke: '#34d399', sw: 1.8 }
    )
  );
  if (night) {
    const [gx, gy] = project(13.4, 0.2, 1.9);
    base.push(ellipse(gx, gy, 70, 30, '#34d399', { op: 0.12, filter: 'glow' }));
  }
  // The engineering room's glass board with sticky notes
  base.push(
    poly(rectOn(onBack, 19.7, 23.5, 1.0, 2.6, 0.01), col('#f8fafc'), {
      stroke: col('#9aa3af'),
      sw: 1.4,
    })
  );
  for (const [u, z, colour] of [
    [20.0, 1.9, '#fde047'],
    [20.6, 1.9, '#f9a8d4'],
    [21.2, 1.9, '#7dd3fc'],
    [20.0, 1.3, '#bef264'],
    [20.6, 1.3, '#fde047'],
  ] as const) {
    base.push(poly(rectOn(onBack, u, u + 0.45, z, z + 0.45, 0.012), col(colour)));
  }
  base.push(
    poly(
      pts([onBack(22.0, 1.5, 0.012), onBack(22.6, 1.9, 0.012), onBack(23.2, 1.7, 0.012)]),
      'none',
      { stroke: '#2563eb', sw: 1.6 }
    )
  );
  // The training room's screen on its walnut panel
  slatPanel(onLeft, 10.4, 15.7);
  base.push(
    poly(rectOn(onLeft, 11, 15, 1.0, 2.6, 0.01), '#0b1220', { stroke: '#2a2f37', sw: 1.6 }),
    poly(rectOn(onLeft, 11.3, 14.7, 1.25, 2.35, 0.012), night ? '#3b6cf0' : '#2452c9', {
      op: 0.85,
    }),
    poly(pts([onLeft(11.8, 1.9, 0.014), onLeft(14.0, 1.9, 0.014)]), 'none', {
      stroke: '#ffffff',
      op: 0.8,
      sw: 1.6,
    }),
    poly(pts([onLeft(11.8, 1.6, 0.014), onLeft(13.2, 1.6, 0.014)]), 'none', {
      stroke: '#ffffff',
      op: 0.5,
      sw: 1.2,
    })
  );
  // A framed picture where the corridor meets the left wall
  base.push(
    poly(rectOn(onLeft, 8.25, 9.75, 1.0, 2.4, 0.01), col('#f4f1ea'), {
      stroke: col(STEEL),
      sw: 2,
    }),
    poly(rectOn(onLeft, 8.45, 9.2, 1.2, 1.9, 0.012), col(EMERALD)),
    poly(rectOn(onLeft, 8.9, 9.55, 1.55, 2.2, 0.014), col(BRASS), { op: 0.9 }),
    poly(rectOn(onLeft, 8.6, 9.0, 1.95, 2.25, 0.016), col('#27364f'))
  );

  // ---- Everything that stands on the floor, sorted back to front ---------------------------
  const items: { key: number; prims: ScenePrim[] }[] = [];
  const add = (cx: number, cy: number, prims: ScenePrim[]) => items.push({ key: cx + cy, prims });

  // Glass partitions with a black top rail, in pieces of one unit so they sort with the furniture
  const GLASS = '#bcd5e4';
  const glassAlongY = (x: number, y0: number, y1: number) => {
    for (let y = y0; y < y1 - 0.001; y += 1) {
      const d = Math.min(1, y1 - y);
      add(x, y + d / 2, [
        ...box(x - 0.03, y, 0, 0.06, d, 1.5, GLASS, { op: 0.26 }),
        line([x, y, 1.5], [x, y + d, 1.5], STEEL, 1, 1.8),
      ]);
    }
  };
  const glassAlongX = (y: number, x0: number, x1: number) => {
    for (let x = x0; x < x1 - 0.001; x += 1) {
      const w = Math.min(1, x1 - x);
      add(x + w / 2, y, [
        ...box(x, y - 0.03, 0, w, 0.06, 1.5, GLASS, { op: 0.26 }),
        line([x, y, 1.5], [x + w, y, 1.5], STEEL, 1, 1.8),
      ]);
    }
  };
  glassAlongY(10, 0, 3);
  glassAlongY(10, 4.4, 8);
  glassAlongY(17, 0, 3);
  glassAlongY(17, 4.4, 8);
  for (const [x0, x1] of [
    [0, 4],
    [5.4, 12.6],
    [14, 19],
    [20.4, 24],
  ] as const) {
    glassAlongX(8, x0, x1);
  }
  for (const [x0, x1] of [
    [0, 3],
    [4.4, 10.5],
    [13.5, 17.2],
    [18.6, 21.4],
    [22.8, 24],
  ] as const) {
    glassAlongX(10, x0, x1);
  }
  glassAlongY(8, 10, 16);
  glassAlongY(16, 10, 16);
  glassAlongY(20, 10, 16);

  const atDesk = (role: AiEmployeeRole) =>
    statuses[role] === 'working' || statuses[role] === 'attention';

  /**
   * A desk: a walnut top on black steel legs. Whoever works at it sits behind it (on its -y
   * side) and faces +y, towards the viewer's lower left: the keyboard is on their side, the
   * monitors stand on the far edge and show their backs to the viewer. A lit screen throws its
   * light back at the seat.
   */
  const desk = (x: number, y: number, w: number, d: number, monitors: 1 | 2, lit: boolean) => {
    const prims = [
      shadow(x + w / 2, y + d / 2, 46, 18),
      ...box(x + 0.05, y + 0.08, 0, 0.07, d - 0.16, 0.68, STEEL),
      ...box(x + w - 0.12, y + 0.08, 0, 0.07, d - 0.16, 0.68, STEEL),
      ...box(x, y, 0.68, w, d, 0.06, WALNUT),
      line([x + 0.12, y + d * 0.42, 0.742], [x + w - 0.12, y + d * 0.42, 0.742], '#553722', 0.45),
      line([x + 0.3, y + d * 0.7, 0.742], [x + w - 0.2, y + d * 0.7, 0.742], '#553722', 0.35),
      ...box(x + w * 0.3, y + d * 0.14, 0.74, w * 0.4, d * 0.24, 0.025, '#d9dde3'),
    ];
    const mw = monitors === 2 ? w * 0.36 : w * 0.5;
    const starts = monitors === 2 ? [x + w * 0.1, x + w * 0.54] : [x + w * 0.25];
    for (const mx of starts) {
      if (lit) {
        const [gx, gy] = project(mx + mw / 2, y + d - 0.42, 1.06);
        prims.push(ellipse(gx, gy, 20, 10, '#7dd3fc', { op: night ? 0.75 : 0.55, filter: 'glow' }));
      }
      prims.push(
        ...box(mx + mw / 2 - 0.07, y + d - 0.2, 0.74, 0.14, 0.1, 0.14, '#3b424d'),
        ...box(mx, y + d - 0.24, 0.86, mw, 0.05, 0.46, '#1d2127')
      );
      const [lx, ly] = project(mx + mw / 2, y + d - 0.19, 1.09);
      prims.push(ellipse(lx, ly, 1.6, 1.6, col('#aab2bc')));
    }
    add(x + w / 2, y + d / 2, prims);
  };
  /** An office chair on its base, turned towards the floor's +y (the default), -y, +x or -x */
  const chair = (
    x: number,
    y: number,
    colour = LEATHER,
    facing: '+y' | '-y' | '+x' | '-x' = '+y'
  ) => {
    const [bx, by] = project(x, y);
    const seat = [
      shadow(x, y, 16, 7),
      ellipse(bx, by, 9, 4.5, col('#15181d')),
      ...box(x - 0.05, y - 0.05, 0.03, 0.1, 0.1, 0.37, '#3a4049'),
      ...box(x - 0.3, y - 0.3, 0.4, 0.6, 0.6, 0.1, colour),
    ];
    const back =
      facing === '+y'
        ? box(x - 0.3, y - 0.36, 0.5, 0.6, 0.1, 0.66, colour)
        : facing === '-y'
          ? box(x - 0.3, y + 0.26, 0.5, 0.6, 0.1, 0.66, colour)
          : facing === '+x'
            ? box(x - 0.36, y - 0.3, 0.5, 0.1, 0.6, 0.66, colour)
            : box(x + 0.26, y - 0.3, 0.5, 0.1, 0.6, 0.66, colour);
    // The backrest is behind whoever sits there when the chair is turned to the viewer, and in
    // front of them otherwise
    if (facing === '+y' || facing === '+x') add(x, y - 0.02, [...back, ...seat]);
    else {
      add(x, y - 0.02, seat);
      add(x, y + 0.3, back);
    }
  };
  /** A plant in a black planter with a brass rim; a tall one grows on a stem */
  const plant = (x: number, y: number, tall = false) => {
    const lift = tall ? 0.75 : 0;
    const [ax, ay] = project(x, y, 1.15 + lift);
    const [bx, by] = project(x - 0.15, y + 0.1, 1.48 + lift);
    const [cx, cy] = project(x + 0.2, y - 0.1, 1.36 + lift);
    const [dx, dy] = project(x + 0.05, y + 0.12, 0.98 + lift);
    const prims = [
      shadow(x, y, 16, 7),
      ...box(x - 0.24, y - 0.24, 0, 0.48, 0.48, 0.62, '#22262d'),
      line([x - 0.24, y + 0.24, 0.62], [x + 0.24, y + 0.24, 0.62], BRASS, 1, 1.4),
      line([x + 0.24, y + 0.24, 0.62], [x + 0.24, y - 0.24, 0.62], BRASS, 1, 1.4),
    ];
    if (tall) prims.push(line([x, y, 0.62], [x, y, 1.5], '#5b4630', 1, 2));
    prims.push(
      ellipse(dx, dy, 13, 9, col('#1d5c3a')),
      ellipse(ax, ay, 17, 13, col('#2a8a55')),
      ellipse(cx, cy, 13, 11, col('#36a468')),
      ellipse(bx, by, 12, 10, col('#226f45'))
    );
    add(x, y, prims);
  };
  /** A round table: a marble top on a brass pedestal */
  const roundTable = (x: number, y: number, rx: number) => {
    const [tx, ty] = project(x, y, 0.74);
    add(x, y, [
      shadow(x, y, rx, rx * 0.45),
      ...box(x - 0.12, y - 0.12, 0, 0.24, 0.24, 0.7, BRASS),
      ellipse(tx, ty + 2.5, rx, rx / 2, col('#bdb8ae')),
      ellipse(tx, ty, rx, rx / 2, col(MARBLE), { stroke: col('#ffffff') }),
    ]);
  };
  /** A pendant lamp: on at night with its halo (its pool of light is on the floor) */
  const pendant = (x: number, y: number) => {
    const [tx, ty] = project(x, y, 3.95);
    const [lx, ly] = project(x, y, PENDANT_HEIGHT);
    const f = (value: number) => value.toFixed(1);
    const prims: ScenePrim[] = [
      path(`M${f(tx)} ${f(ty)} L${f(lx)} ${f(ly - 9)}`, 'none', { stroke: col(STEEL), sw: 1 }),
    ];
    if (night) prims.push(ellipse(lx, ly + 3, 30, 21, gradient('lamp')));
    prims.push(
      path(
        `M${f(lx - 10)} ${f(ly)} Q${f(lx - 9)} ${f(ly - 11)} ${f(lx)} ${f(ly - 11)} Q${f(lx + 9)} ${f(ly - 11)} ${f(lx + 10)} ${f(ly)} Z`,
        night ? shade(BRASS, 0.8) : BRASS,
        { stroke: shade(BRASS, night ? 0.6 : 0.8) }
      ),
      ellipse(lx, ly, 10, 4, night ? '#fff3cf' : '#f6efdc')
    );
    add(x, y + 0.6, prims);
  };

  /**
   * The reception counter, where the back office works: marble with a brass plate, a walnut
   * top, and the monitor on the far edge like on the desks
   */
  const counter = (x: number, y: number, w: number, d: number, lit: boolean) => {
    const [px, py] = project(x + w / 2, y + d + 0.005, 0.6);
    const prims = [
      shadow(x + w / 2, y + d / 2, 60, 20),
      ...box(x, y, 0, w, d, 1.08, MARBLE),
      line([x, y + d, 0.14], [x + w, y + d, 0.14], BRASS, 1, 1.6),
      ellipse(px, py, 15, 5, col(BRASS)),
      ...box(x - 0.1, y - 0.1, 1.08, w + 0.2, d + 0.2, 0.07, WALNUT),
      ...box(x + w * 0.38, y + 0.05, 1.15, w * 0.24, d * 0.3, 0.025, '#d9dde3'),
    ];
    if (lit) {
      const [gx, gy] = project(x + w / 2, y + d - 0.4, 1.45);
      prims.push(ellipse(gx, gy, 20, 10, '#7dd3fc', { op: night ? 0.75 : 0.55, filter: 'glow' }));
    }
    prims.push(
      ...box(x + w / 2 - 0.07, y + d - 0.16, 1.15, 0.14, 0.1, 0.12, '#3b424d'),
      ...box(x + w / 2 - 0.45, y + d - 0.2, 1.25, 0.9, 0.05, 0.44, '#1d2127')
    );
    add(x + w / 2, y + d / 2, prims);
  };

  // The desk of each role (a counter for the back office), its chair behind it
  for (const role of AI_EMPLOYEE_ROLES) {
    const own = ROLE_DESKS[role];
    if (own.counter) counter(own.x, own.y, own.w, own.d, atDesk(role));
    else desk(own.x, own.y, own.w, own.d, own.monitors, atDesk(role));
    chair(DESK_SEATS[role].x, DESK_SEATS[role].y);
  }

  // Sales floor: two rows of desks, a credenza with the printer
  for (const x of [1.2, 3.2, 5.2, 7.2]) {
    if (x !== ROLE_DESKS.sales.x) {
      desk(x, 2.3, 1.8, 0.9, 1, false);
      chair(x + 0.9, 2.3 - SEAT_BEHIND_DESK);
    }
    desk(x, 5.1, 1.8, 0.9, 1, false);
    chair(x + 0.9, 5.1 - SEAT_BEHIND_DESK);
  }
  add(0.9, 7.1, [
    shadow(0.9, 7.1, 34, 12),
    ...box(0.3, 6.75, 0, 1.3, 0.6, 0.7, WALNUT),
    line([0.5, 7.35, 0.4], [0.8, 7.35, 0.4], BRASS, 1, 1.6),
    line([1.1, 7.35, 0.4], [1.4, 7.35, 0.4], BRASS, 1, 1.6),
    ...box(0.45, 6.85, 0.7, 0.6, 0.42, 0.28, '#e8eaee'),
    ...box(0.5, 6.9, 0.98, 0.5, 0.3, 0.03, '#9aa1ab'),
  ]);
  plant(9.4, 0.7, true);
  plant(9.5, 4.0);

  // Marketing room: desks with two monitors, server racks, a small round table
  for (const x of [10.6, 15.0]) {
    desk(x, 2.0, 1.6, 0.9, 2, false);
    chair(x + 0.8, 2.0 - SEAT_BEHIND_DESK);
  }
  for (const y of [4.8, 5.8]) {
    const prims = [shadow(16.0, y + 0.4, 18, 8), ...box(15.6, y, 0, 0.8, 0.9, 2.3, '#191c22')];
    for (let i = 0; i < 6; i++) {
      const [ax, ay] = project(15.72, y + 0.9, 0.4 + i * 0.3);
      const [bx, by] = project(16.2, y + 0.9, 0.4 + i * 0.3);
      prims.push(
        path(`M${ax} ${ay} L${bx} ${by}`, 'none', {
          stroke: i % 2 ? '#22c55e' : '#60a5fa',
          sw: 1.4,
        })
      );
    }
    if (night) {
      const [gx, gy] = project(16.0, y + 0.95, 1.2);
      prims.push(ellipse(gx, gy, 16, 24, '#60a5fa', { op: 0.18, filter: 'glow' }));
    }
    add(16.0, y + 0.45, prims);
  }
  roundTable(12.4, 5.9, 30);
  chair(11.5, 5.9, undefined, '+x');
  chair(13.3, 5.9, undefined, '-x');
  chair(12.4, 6.85, undefined, '-y');
  plant(10.6, 7.4);

  // Engineering room: the meeting table on its rug (the role's desk is by the window)
  add(21.4, 4.5, [
    shadow(21.4, 4.5, 80, 30),
    ...box(20.3, 4.2, 0, 0.3, 0.6, 0.68, STEEL),
    ...box(22.2, 4.2, 0, 0.3, 0.6, 0.68, STEEL),
    ...box(19.8, 3.7, 0.68, 3.2, 1.6, 0.07, WALNUT),
    line([20.0, 4.3, 0.752], [22.8, 4.3, 0.752], '#553722', 0.45),
    line([20.2, 4.8, 0.752], [22.6, 4.8, 0.752], '#553722', 0.35),
  ]);
  for (const x of [20.3, 21.4, 22.5]) {
    chair(x, 3.3, COGNAC);
    chair(x, 5.7, COGNAC, '-y');
  }
  plant(17.6, 7.4);
  plant(23.5, 0.7, true);

  // Corridor
  plant(0.5, 9, true);
  plant(23.5, 9);

  // Training room: study desks turned like the work desks, an open book on each
  const studyDesk = (x: number, y: number, w: number, d: number) => {
    add(x + w / 2, y + d / 2, [
      shadow(x + w / 2, y + d / 2, 40, 16),
      ...box(x + 0.05, y + 0.08, 0, 0.07, d - 0.16, 0.66, STEEL),
      ...box(x + w - 0.12, y + 0.08, 0, 0.07, d - 0.16, 0.66, STEEL),
      ...box(x, y, 0.66, w, d, 0.06, '#eceef1'),
      ...box(x + w / 2 - 0.36, y + 0.16, 0.72, 0.34, 0.44, 0.03, '#ffffff'),
      ...box(x + w / 2 + 0.02, y + 0.16, 0.72, 0.34, 0.44, 0.03, '#eef2f7'),
    ]);
    chair(x + w / 2, y - SEAT_BEHIND_DESK);
  };
  for (const own of TRAINING_DESKS) studyDesk(own.x, own.y, own.w, own.d);
  // Two more desks fill the back row
  studyDesk(3.2, 14.7, 1.6, 0.8);
  studyDesk(5.5, 14.7, 1.6, 0.8);

  // Lounge: a marble counter with the espresso machine, a lit drinks cabinet, a velvet sofa with
  // cushions, a marble coffee table, a round table and a floor lamp
  add(13, 10.5, [
    ...box(11, 10.15, 0, 4, 0.7, 0.98, '#262b33'),
    line([11, 10.85, 0.12], [15, 10.85, 0.12], BRASS, 1, 1.4),
    ...box(10.95, 10.1, 0.98, 4.1, 0.8, 0.07, MARBLE),
    ...box(11.2, 10.25, 1.05, 0.6, 0.5, 0.62, '#c9ced6'),
    ...box(11.3, 10.76, 1.25, 0.4, 0.02, 0.2, '#15181d'),
    ...box(12.1, 10.35, 1.05, 0.18, 0.18, 0.2, '#ffffff'),
    ...box(12.45, 10.35, 1.05, 0.18, 0.18, 0.2, '#ffffff'),
    ...box(13.4, 10.3, 1.05, 0.5, 0.4, 0.05, WALNUT),
  ]);
  {
    const prims = [
      ...box(15.0, 10.15, 0, 0.85, 0.7, 2.1, '#191c22'),
      poly(
        pts([
          [15.08, 10.86, 0.2],
          [15.77, 10.86, 0.2],
          [15.77, 10.86, 1.95],
          [15.08, 10.86, 1.95],
        ]),
        night ? LAMP_LIGHT : '#f1e3c2',
        { op: night ? 0.92 : 0.75 }
      ),
    ];
    for (const z of [0.75, 1.3]) {
      prims.push(
        poly(
          pts([
            [15.08, 10.87, z],
            [15.77, 10.87, z],
          ]),
          'none',
          { stroke: '#191c22', sw: 1.4 }
        )
      );
    }
    for (const [u, z, colour] of [
      [15.2, 0.3, '#7f1d1d'],
      [15.45, 0.3, '#14532d'],
      [15.3, 0.85, '#1e3a8a'],
      [15.55, 0.85, '#7f1d1d'],
      [15.25, 1.4, '#14532d'],
      [15.5, 1.4, '#92400e'],
    ] as const) {
      prims.push(
        poly(
          pts([
            [u, 10.875, z],
            [u + 0.12, 10.875, z],
            [u + 0.12, 10.875, z + 0.34],
            [u, 10.875, z + 0.34],
          ]),
          colour
        )
      );
    }
    if (night) {
      const [gx, gy] = project(15.4, 11.2, 1.0);
      prims.push(ellipse(gx, gy, 26, 34, LAMP_LIGHT, { op: 0.16, filter: 'glow' }));
    }
    add(15.4, 10.5, prims);
  }
  add(9.1, 13.1, [
    shadow(9.1, 13.1, 34, 60),
    ...box(8.6, 11.2, 0, 1.0, 3.8, 0.45, EMERALD),
    ...box(8.6, 11.2, 0.45, 0.32, 3.8, 0.62, shade(EMERALD, 0.9)),
    ...box(8.6, 11.2, 0.45, 1.0, 0.25, 0.3, shade(EMERALD, 0.9)),
    ...box(8.6, 14.75, 0.45, 1.0, 0.25, 0.3, shade(EMERALD, 0.9)),
    ...box(8.95, 11.6, 0.45, 0.22, 0.5, 0.42, '#e9e2d2'),
    ...box(8.95, 14.1, 0.45, 0.22, 0.5, 0.42, BRASS),
  ]);
  add(11.5, 13.2, [
    shadow(11.5, 13.2, 30, 16),
    ...box(11.0, 12.5, 0, 0.08, 0.08, 0.34, BRASS),
    ...box(11.92, 12.5, 0, 0.08, 0.08, 0.34, BRASS),
    ...box(11.0, 13.82, 0, 0.08, 0.08, 0.34, BRASS),
    ...box(11.92, 13.82, 0, 0.08, 0.08, 0.34, BRASS),
    ...box(10.9, 12.4, 0.34, 1.2, 1.6, 0.06, MARBLE),
    ...box(11.3, 13.0, 0.4, 0.3, 0.4, 0.05, '#27364f'),
  ]);
  roundTable(14.4, 13.0, 32);
  chair(15.35, 13.0, COGNAC, '-x');
  chair(13.45, 13.0, COGNAC, '+x');
  {
    // A floor lamp by the sofa
    const [sx, sy] = project(8.45, 10.5, 2.0);
    const prims = [
      ...box(8.3, 10.35, 0, 0.3, 0.3, 0.05, STEEL),
      line([8.45, 10.5, 0.05], [8.45, 10.5, 1.85], BRASS, 1, 1.6),
    ];
    if (night) prims.push(ellipse(sx, sy + 4, 30, 24, gradient('lamp')));
    prims.push(
      ...box(8.25, 10.3, 1.85, 0.4, 0.4, 0.36, night ? '#fff0c9' : '#f3ead6', { lit: true })
    );
    add(8.45, 10.5, prims);
  }
  plant(8.6, 15.5);
  plant(13.2, 15.4, true);

  // Charging station: a pad with a brass ring per role, wired to slim chargers
  for (const pad of CHARGING_PADS) {
    const cy = pad.y + pad.d / 2;
    const [rx, ry] = project(pad.x + pad.w / 2, cy, 0.11);
    add(pad.x + pad.w / 2, cy, [
      ...box(pad.x, pad.y + 0.05, 0, pad.w, pad.d - 0.1, 0.1, '#2b3038'),
      ellipse(rx, ry, 22, 11, 'none', { stroke: night ? '#fcd34d' : BRASS, op: 0.95, sw: 1.8 }),
      ellipse(rx, ry, 22, 11, '#fbbf24', { op: night ? 0.38 : 0.2, filter: 'glow' }),
    ]);
    add(19.65, cy, [
      ...box(19.5, cy - 0.3, 0, 0.3, 0.6, 1.25, '#262b33'),
      ...box(19.48, cy - 0.15, 0.8, 0.02, 0.3, 0.2, '#22c55e', { lit: true }),
    ]);
    add(18.9, cy, box(18.3, cy - 0.04, 0, 1.2, 0.08, 0.04, '#15181d'));
  }

  // Reception: the counter is the back office's desk (above); a leather bench and a plant
  add(23.5, 14.2, [
    shadow(23.5, 14.2, 18, 34),
    ...box(23.25, 13.3, 0, 0.08, 1.8, 0.3, STEEL),
    ...box(23.2, 13.2, 0.3, 0.6, 2.0, 0.16, COGNAC),
  ]);
  plant(23.7, 10.5, true);

  // The pendant lamps
  for (const [x, y] of PENDANTS) pendant(x, y);

  // ---- The robots, each turned towards its desk or table -----------------------------------
  for (const role of AI_EMPLOYEE_ROLES) {
    const status = statuses[role];
    const spot = spotOf(role, status);
    const [x, y] = project(spot.x, spot.y);
    add(
      spot.x,
      spot.y + 0.01,
      robotPrims({ role, status, x, y, facing: spot.facing, night, gradient })
    );
  }

  items.sort((a, b) => a.key - b.key);

  // The names of the rooms stay off the floor, clear of the robots and their name tags: over the
  // back wall for the rooms along it, under the front edges of the floor for the others
  const labels: SceneLabel[] = OFFICE_AREAS.filter((area) => area !== 'corridor').map((area) => {
    const r = AREA_RECTS[area];
    const centre = r.x + r.w / 2 + (area === 'marketing' ? 2.7 : area === 'engineering' ? 1 : 0);
    const above = r.y === 0;
    // The room in the front corner is named under the right edge of the floor, away from the
    // very front where the full-screen office keeps its actions
    const corner = !above && r.x + r.w === FLOOR_WIDTH;
    const [x, y] = above
      ? project(centre, 0, 3.2)
      : corner
        ? project(FLOOR_WIDTH + 0.6, r.y + 0.5, -1.7)
        : project(centre, r.y + r.h, -0.45);
    return { area, x, y, above };
  });

  return { prims: [...base, ...items.flatMap((item) => item.prims)], labels };
}
