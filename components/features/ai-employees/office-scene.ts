/**
 * The virtual office drawn in isometric projection (Refs #1101): the building (floor slab, rooms,
 * back walls with windows, glass partitions), the furniture and the robots, as SVG primitives in
 * painter's order. Pure; office-map.tsx renders it twice (day palette, and the night palette for
 * dark mode). The design was made on a Claude Design canvas and moved here as code.
 *
 * Floor units: the floor is 24 x 16; x runs to the lower right of the screen, y to the lower
 * left, z up. Lit from the upper left: tops are the plain colour, the faces turned to the viewer
 * are darker.
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { AREA_RECTS, OFFICE_AREAS, type OfficeArea, spotOf } from './office-map-layout';

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

interface PrimStyle {
  fill: string;
  op?: number;
  stroke?: string;
  filter?: 'soft' | 'glow';
  /** Pulses for people who do not ask for reduced motion */
  pulse?: boolean;
}

export type ScenePrim =
  | ({ kind: 'poly'; points: string } & PrimStyle)
  | ({ kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number } & PrimStyle)
  | ({ kind: 'path'; d: string } & PrimStyle);

export interface SceneLabel {
  area: OfficeArea;
  x: number;
  y: number;
}

export interface OfficeScene {
  prims: ScenePrim[];
  labels: SceneLabel[];
}

/** Gradients the scene refers to by name; the renderer defines them under its own ids */
export const SCENE_GRADIENTS = ['sky', 'bodyOn', 'headOn', 'bodyOff', 'headOff', 'pool'] as const;
export type SceneGradient = (typeof SCENE_GRADIENTS)[number];

const STATUS_LIGHT: Record<DeskStatus, string> = {
  working: '#22c55e',
  attention: '#ef4444',
  idle: '#38bdf8',
  training: '#f59e0b',
  paused: '#6b7280',
  vacant: '#9ca3af',
};

const FLOOR_COLOURS: Record<OfficeArea, string> = {
  sales: '#e1e8f0',
  analysis: '#d9eee3',
  planning: '#f2e8d6',
  corridor: '#cfd5dc',
  training: '#dde7f5',
  lounge: '#e4c99c',
  charging: '#d8dde4',
  entrance: '#e8e1d4',
};

function shade(hex: string, factor: number): string {
  const channels = [1, 3, 5].map((i) =>
    Math.max(0, Math.min(255, Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * factor)))
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y} h${w - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${h - 2 * r} a${r} ${r} 0 0 1 -${r} ${r} h-${w - 2 * r} a${r} ${r} 0 0 1 -${r} -${r} v-${h - 2 * r} a${r} ${r} 0 0 1 ${r} -${r} z`;
}

const pt = (x: number, y: number, z: number) => {
  const [sx, sy] = project(x, y, z);
  return `${sx.toFixed(1)},${sy.toFixed(1)}`;
};
const pts = (list: readonly (readonly [number, number, number])[]) =>
  list.map(([x, y, z]) => pt(x, y, z)).join(' ');

/**
 * The whole office for the given statuses. `night` dims the colours, darkens the sky and turns on
 * pools of light, for dark mode. `gradient` names a gradient by its id in the renderer.
 */
export function buildOfficeScene(
  statuses: Readonly<Record<AiEmployeeRole, DeskStatus>>,
  night: boolean,
  gradient: (name: SceneGradient) => string
): OfficeScene {
  const dim = night ? 0.5 : 1;
  const col = (hex: string) => shade(hex, dim);
  const poly = (points: string, fill: string, style: Omit<PrimStyle, 'fill'> = {}): ScenePrim => ({
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
    style: Omit<PrimStyle, 'fill'> = {}
  ): ScenePrim => ({ kind: 'ellipse', cx, cy, rx, ry, fill, ...style });
  const path = (d: string, fill: string, style: Omit<PrimStyle, 'fill'> = {}): ScenePrim => ({
    kind: 'path',
    d,
    fill,
    ...style,
  });
  const line = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    colour: string,
    op: number
  ) => poly(pts([a, b]), 'none', { stroke: col(colour), op });

  /** A box: its top and the two faces turned to the viewer */
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    colour: string,
    options: { op?: number; edge?: string } = {}
  ): ScenePrim[] => {
    const c = col(colour);
    const op = options.op ?? 1;
    return [
      poly(
        pts([
          [x, y + d, z],
          [x + w, y + d, z],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        ]),
        shade(c, 0.86),
        { op }
      ),
      poly(
        pts([
          [x + w, y, z],
          [x + w, y + d, z],
          [x + w, y + d, z + h],
          [x + w, y, z + h],
        ]),
        shade(c, 0.7),
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
        { op, stroke: options.edge }
      ),
    ];
  };
  const shadow = (x: number, y: number, rx: number, ry: number) => {
    const [cx, cy] = project(x, y);
    return ellipse(cx, cy, rx, ry, '#0b1220', { op: night ? 0.35 : 0.2, filter: 'soft' });
  };

  // ---- The building ----------------------------------------------------------------------
  const base: ScenePrim[] = [...box(0, 0, -0.45, 24, 16, 0.45, '#8f99a6')];
  for (const area of OFFICE_AREAS) {
    const r = AREA_RECTS[area];
    base.push(
      poly(
        pts([
          [r.x, r.y, 0],
          [r.x + r.w, r.y, 0],
          [r.x + r.w, r.y + r.h, 0],
          [r.x, r.y + r.h, 0],
        ]),
        col(FLOOR_COLOURS[area])
      )
    );
  }
  // Carpet tiles, wood planks and corridor tiles
  for (let i = 1; i < 10; i++) base.push(line([i, 0, 0.002], [i, 8, 0.002], '#b9c4d1', 0.35));
  for (let j = 1; j < 8; j++) base.push(line([0, j, 0.002], [10, j, 0.002], '#b9c4d1', 0.35));
  for (let j = 1; j < 12; j++) {
    base.push(line([8, 10 + j * 0.5, 0.002], [16, 10 + j * 0.5, 0.002], '#b8925e', 0.55));
  }
  for (let i = 1; i < 12; i++)
    base.push(line([i * 2, 8, 0.002], [i * 2, 10, 0.002], '#aab2bc', 0.6));
  // A rug in the lounge, a mat at the entrance
  base.push(
    poly(
      pts([
        [8.7, 11, 0.01],
        [12.7, 11, 0.01],
        [12.7, 15.4, 0.01],
        [8.7, 15.4, 0.01],
      ]),
      col('#b9a3d9'),
      { op: 0.9 }
    ),
    poly(
      pts([
        [21.6, 14.8, 0.01],
        [23.2, 14.8, 0.01],
        [23.2, 15.8, 0.01],
        [21.6, 15.8, 0.01],
      ]),
      col('#59616c')
    )
  );
  // Back walls with windows
  base.push(
    ...box(-0.3, 0, 0, 0.3, 16, 3.2, '#efe9e0'),
    ...box(-0.3, -0.3, 0, 24.3, 0.3, 3.2, '#efe9e0')
  );
  const sky = gradient('sky');
  const windowOnBack = (a: number, b: number) => {
    base.push(
      poly(
        pts([
          [a, 0.01, 0.95],
          [b, 0.01, 0.95],
          [b, 0.01, 2.75],
          [a, 0.01, 2.75],
        ]),
        sky,
        { stroke: '#ffffff' }
      ),
      line([(a + b) / 2, 0.02, 0.95], [(a + b) / 2, 0.02, 2.75], '#ffffff', 1)
    );
  };
  const windowOnLeft = (a: number, b: number) => {
    base.push(
      poly(
        pts([
          [0.01, a, 0.95],
          [0.01, b, 0.95],
          [0.01, b, 2.75],
          [0.01, a, 2.75],
        ]),
        sky,
        { stroke: '#ffffff' }
      ),
      line([0.02, (a + b) / 2, 0.95], [0.02, (a + b) / 2, 2.75], '#ffffff', 1)
    );
  };
  windowOnBack(0.8, 4.4);
  windowOnBack(5.4, 9.2);
  windowOnBack(17.4, 19.0);
  windowOnLeft(0.8, 3.8);
  windowOnLeft(4.4, 7.4);
  // The analysis room's wall screen with a rising line chart
  base.push(
    poly(
      pts([
        [10.9, 0.01, 1.2],
        [15.9, 0.01, 1.2],
        [15.9, 0.01, 2.75],
        [10.9, 0.01, 2.75],
      ]),
      '#0f172a'
    ),
    poly(
      pts([
        [11.2, 0.02, 1.5],
        [12.2, 0.02, 1.85],
        [13.1, 0.02, 1.7],
        [14.0, 0.02, 2.2],
        [15.0, 0.02, 2.05],
        [15.6, 0.02, 2.5],
      ]),
      'none',
      { stroke: '#34d399' }
    )
  );
  // The planning room's whiteboard with sticky notes
  base.push(
    poly(
      pts([
        [19.5, 0.01, 1.1],
        [23.4, 0.01, 1.1],
        [23.4, 0.01, 2.6],
        [19.5, 0.01, 2.6],
      ]),
      '#fbfbfb',
      { stroke: '#cbd5e1' }
    )
  );
  for (const [x, z, colour] of [
    [19.8, 1.9, '#fde047'],
    [20.4, 1.9, '#f9a8d4'],
    [21.0, 1.9, '#7dd3fc'],
    [19.8, 1.3, '#bef264'],
    [20.4, 1.3, '#fde047'],
  ] as const) {
    base.push(
      poly(
        pts([
          [x, 0.02, z],
          [x + 0.45, 0.02, z],
          [x + 0.45, 0.02, z + 0.45],
          [x, 0.02, z + 0.45],
        ]),
        colour
      )
    );
  }
  base.push(
    poly(
      pts([
        [21.8, 0.02, 1.5],
        [22.4, 0.02, 1.9],
        [23.0, 0.02, 1.7],
      ]),
      'none',
      { stroke: '#2563eb' }
    )
  );
  // The training room's screen on the left wall
  base.push(
    poly(
      pts([
        [0.01, 11, 1.0],
        [0.01, 15, 1.0],
        [0.01, 15, 2.6],
        [0.01, 11, 2.6],
      ]),
      '#111827'
    ),
    poly(
      pts([
        [0.02, 11.4, 1.3],
        [0.02, 14.6, 1.3],
        [0.02, 14.6, 2.3],
        [0.02, 11.4, 2.3],
      ]),
      '#1d4ed8',
      { op: 0.75 }
    )
  );
  // Pools of light from the ceiling lamps at night
  if (night) {
    for (const [x, y] of [
      [4.5, 3],
      [13.5, 3],
      [20.5, 4.5],
      [12, 13],
      [4, 13],
      [18, 13],
      [22, 13],
    ] as const) {
      const [cx, cy] = project(x, y);
      base.push(ellipse(cx, cy, 120, 60, gradient('pool')));
    }
  }

  // ---- Everything that stands on the floor, sorted back to front ---------------------------
  const items: { key: number; prims: ScenePrim[] }[] = [];
  const add = (cx: number, cy: number, prims: ScenePrim[]) => items.push({ key: cx + cy, prims });

  // Glass partitions, in pieces of one unit so they sort with the furniture
  const glassAlongY = (x: number, y0: number, y1: number) => {
    for (let y = y0; y < y1 - 0.001; y += 1) {
      const d = Math.min(1, y1 - y);
      add(
        x,
        y + d / 2,
        box(x - 0.04, y, 0, 0.08, d, 1.3, '#a9d4f5', { op: 0.38, edge: '#ffffff' })
      );
    }
  };
  const glassAlongX = (y: number, x0: number, x1: number) => {
    for (let x = x0; x < x1 - 0.001; x += 1) {
      const w = Math.min(1, x1 - x);
      add(
        x + w / 2,
        y,
        box(x, y - 0.04, 0, w, 0.08, 1.3, '#a9d4f5', { op: 0.38, edge: '#ffffff' })
      );
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

  const desk = (x: number, y: number, w: number, d: number, monitors: 1 | 2, lit: boolean) => {
    const prims = [shadow(x + w / 2, y + d / 2, 46, 18), ...box(x, y, 0, w, d, 0.74, '#c79c6a')];
    const mw = monitors === 2 ? w * 0.36 : w * 0.5;
    const starts = monitors === 2 ? [x + w * 0.1, x + w * 0.54] : [x + w * 0.25];
    for (const mx of starts) {
      prims.push(...box(mx, y + 0.12, 0.74, mw, 0.07, 0.5, '#272c35'));
      if (lit) {
        const [gx, gy] = project(mx + mw / 2, y + 0.1, 1.0);
        prims.push(ellipse(gx, gy, 20, 10, '#7dd3fc', { op: 0.55, filter: 'glow' }));
      }
    }
    prims.push(...box(x + w * 0.3, y + d * 0.55, 0.74, w * 0.4, d * 0.22, 0.03, '#e5e7eb'));
    add(x + w / 2, y + d / 2, prims);
  };
  const chair = (x: number, y: number, colour = '#3f4753') => {
    add(x, y - 0.02, [
      shadow(x, y, 16, 7),
      ...box(x - 0.3, y - 0.3, 0.42, 0.6, 0.6, 0.08, colour),
      ...box(x - 0.3, y - 0.36, 0.5, 0.6, 0.1, 0.62, colour),
    ]);
  };
  const plant = (x: number, y: number) => {
    const [ax, ay] = project(x, y, 1.05);
    const [bx, by] = project(x - 0.15, y + 0.1, 1.35);
    const [cx, cy] = project(x + 0.2, y - 0.1, 1.25);
    add(x, y, [
      shadow(x, y, 16, 7),
      ...box(x - 0.24, y - 0.24, 0, 0.48, 0.48, 0.55, '#b4673f'),
      ellipse(ax, ay, 17, 13, col('#2f9e5b')),
      ellipse(cx, cy, 13, 11, col('#3db36f')),
      ellipse(bx, by, 12, 10, col('#258049')),
    ]);
  };

  // Sales floor: two rows of desks and a printer
  for (const x of [1.2, 3.2, 5.2, 7.2]) {
    desk(x, 2.3, 1.8, 0.9, 1, x === 1.2 && atDesk('follow_up_keeper'));
    if (x !== 1.2) chair(x + 0.9, 1.75);
    desk(x, 5.1, 1.8, 0.9, 1, false);
    chair(x + 0.9, 4.55);
  }
  add(0.7, 7.0, [
    shadow(0.7, 7.0, 22, 9),
    ...box(0.3, 6.6, 0, 0.8, 0.7, 0.95, '#e8eaee'),
    ...box(0.4, 6.7, 0.95, 0.6, 0.4, 0.06, '#9aa1ab'),
  ]);
  plant(9.4, 0.7);
  plant(9.5, 4.0);

  // Analysis room: desks with two monitors, server racks and a small table
  for (const x of [10.6, 12.8, 15.0])
    desk(x, 2.0, 1.6, 0.9, 2, x === 12.8 && atDesk('lead_scorer'));
  chair(11.4, 1.45);
  chair(15.8, 1.45);
  for (const y of [4.8, 5.8]) {
    const prims = [shadow(16.0, y + 0.4, 18, 8), ...box(15.6, y, 0, 0.8, 0.9, 2.3, '#2d333c')];
    for (let i = 0; i < 6; i++) {
      const [ax, ay] = project(15.72, y + 0.9, 0.4 + i * 0.3);
      const [bx, by] = project(16.2, y + 0.9, 0.4 + i * 0.3);
      prims.push(
        path(`M${ax} ${ay} L${bx} ${by}`, 'none', { stroke: i % 2 ? '#22c55e' : '#60a5fa' })
      );
    }
    add(16.0, y + 0.45, prims);
  }
  {
    const [tx, ty] = project(12.4, 5.9, 0.74);
    add(12.4, 5.9, [
      shadow(12.4, 5.9, 30, 13),
      ...box(12.25, 5.75, 0, 0.3, 0.3, 0.74, '#9a7b5a'),
      ellipse(tx, ty, 30, 15, col('#d4b083')),
    ]);
  }
  chair(11.6, 5.6);
  chair(13.3, 6.6);
  chair(12.4, 7.0);
  plant(10.6, 7.4);

  // Planning room: a desk by the window and the meeting table
  desk(17.6, 2.0, 1.6, 0.9, 1, atDesk('timing_watcher'));
  add(21.4, 4.5, [shadow(21.4, 4.5, 80, 30), ...box(19.8, 3.7, 0, 3.2, 1.6, 0.74, '#c79c6a')]);
  for (const x of [20.3, 21.4, 22.5]) {
    chair(x, 3.45, '#5b6472');
    chair(x, 5.85, '#5b6472');
  }
  plant(17.6, 7.4);
  plant(23.5, 0.7);

  // Corridor
  plant(0.5, 9);
  plant(23.5, 9);

  // Training room: a lectern and desks facing the screen
  add(1.15, 12.85, [shadow(1.15, 12.85, 14, 6), ...box(0.9, 12.5, 0, 0.5, 0.7, 1.1, '#a8794f')]);
  for (const y of [10.7, 12.5, 14.3]) {
    add(3.45, y + 0.7, [
      shadow(3.45, y + 0.7, 26, 12),
      ...box(3.0, y, 0, 0.9, 1.4, 0.72, '#d6dbe3'),
      ...box(3.2, y + 0.4, 0.72, 0.5, 0.6, 0.02, '#ffffff'),
    ]);
    add(6.05, y + 0.7, [
      shadow(6.05, y + 0.7, 26, 12),
      ...box(5.6, y, 0, 0.9, 1.4, 0.72, '#d6dbe3'),
    ]);
    chair(7.0, y + 0.7);
  }

  // Lounge: a counter with the coffee machine, a vending machine, a sofa and tables
  add(13, 10.5, [
    ...box(11, 10.15, 0, 4, 0.7, 1.0, '#a3aab4'),
    ...box(11, 10.15, 1.0, 4, 0.7, 0.06, '#eceff3'),
    ...box(11.2, 10.25, 1.06, 0.6, 0.5, 0.62, '#1f2937'),
    ...box(12.1, 10.35, 1.06, 0.18, 0.18, 0.2, '#ffffff'),
    ...box(12.45, 10.35, 1.06, 0.18, 0.18, 0.2, '#ffffff'),
  ]);
  add(15.4, 10.5, [
    ...box(15.0, 10.15, 0, 0.85, 0.7, 2.1, '#d63c3c'),
    poly(
      pts([
        [15.1, 10.86, 0.9],
        [15.75, 10.86, 0.9],
        [15.75, 10.86, 1.9],
        [15.1, 10.86, 1.9],
      ]),
      night ? '#fde68a' : '#fee2e2',
      { op: 0.9 }
    ),
  ]);
  add(9.1, 13.1, [
    shadow(9.1, 13.1, 34, 60),
    ...box(8.6, 11.2, 0, 1.0, 3.8, 0.45, '#5b61d6'),
    ...box(8.6, 11.2, 0.45, 0.32, 3.8, 0.6, '#4f55c9'),
    ...box(8.6, 11.2, 0.45, 1.0, 0.25, 0.28, '#4f55c9'),
    ...box(8.6, 14.75, 0.45, 1.0, 0.25, 0.28, '#4f55c9'),
  ]);
  add(11.0, 13.2, [shadow(11.0, 13.2, 30, 16), ...box(10.4, 12.4, 0, 1.2, 1.6, 0.38, '#9a6f45')]);
  {
    const [tx, ty] = project(14.4, 13.0, 0.74);
    add(14.4, 13.0, [
      shadow(14.4, 13.0, 32, 14),
      ...box(14.25, 12.85, 0, 0.3, 0.3, 0.74, '#8a6a4c'),
      ellipse(tx, ty, 32, 16, col('#e8d6bb')),
    ]);
  }
  chair(15.3, 13.4, '#7c5c3e');
  chair(13.6, 12.9, '#7c5c3e');
  plant(8.6, 15.5);
  plant(15.5, 11.3);

  // Charging station: docks wired to chargers on the wall
  for (const y of [10.8, 12.6, 14.4]) {
    const [rx, ry] = project(17.6, y + 0.7, 0.13);
    add(17.6, y + 0.7, [
      ...box(16.9, y, 0, 1.4, 1.4, 0.12, '#9aa6b5'),
      ellipse(rx, ry, 24, 12, 'none', { stroke: '#fbbf24', op: 0.95 }),
      ellipse(rx, ry, 24, 12, '#fbbf24', { op: 0.25, filter: 'glow' }),
    ]);
    add(19.65, y + 0.7, [
      ...box(19.5, y + 0.4, 0, 0.3, 0.6, 1.25, '#475569'),
      ...box(19.48, y + 0.55, 0.8, 0.02, 0.3, 0.2, '#22c55e'),
    ]);
    add(18.9, y + 0.7, box(18.3, y + 0.66, 0, 1.2, 0.08, 0.04, '#334155'));
  }

  // Reception: the counter, a bench and plants
  add(22.1, 11.5, [
    shadow(22.1, 11.5, 60, 20),
    ...box(20.8, 11.1, 0, 2.6, 0.8, 1.1, '#d9c7a8'),
    ...box(20.7, 11.0, 1.1, 2.8, 1.0, 0.07, '#f3ede3'),
    ...box(21.7, 11.2, 1.17, 0.5, 0.3, 0.35, '#2b313a'),
  ]);
  add(23.5, 13.7, [shadow(23.5, 13.7, 18, 34), ...box(23.2, 12.6, 0, 0.6, 2.2, 0.45, '#5b61d6')]);
  plant(23.7, 10.5);

  // ---- The robots ----------------------------------------------------------------------
  const robot = (x: number, y: number, status: DeskStatus): ScenePrim[] => {
    const [X, Y] = project(x, y);
    const off = status === 'paused';
    const ghost = status === 'vacant';
    const op = ghost ? 0.28 : 1;
    const stroke = off ? '#5c636d' : '#8b95a3';
    const body = gradient(off ? 'bodyOff' : 'bodyOn');
    const light = STATUS_LIGHT[status];
    const prims: ScenePrim[] = [
      ellipse(X, Y, 20, 7, '#0b1220', { op: ghost ? 0.08 : night ? 0.4 : 0.25, filter: 'soft' }),
      path(roundedRect(X - 22, Y - 44, 8, 22, 4), body, { stroke, op }),
      path(roundedRect(X + 14, Y - 44, 8, 22, 4), body, { stroke, op }),
      path(roundedRect(X - 15, Y - 50, 30, 40, 14), body, { stroke, op }),
      ellipse(X, Y - 33, 3.6, 3.6, off ? '#6b7280' : '#22c55e', { op }),
      ellipse(X, Y - 64, 17, 16, gradient(off ? 'headOff' : 'headOn'), { stroke, op }),
      path(roundedRect(X - 12, Y - 71, 24, 12, 6), '#1f2937', { op }),
    ];
    if (!off && !ghost) {
      const eye = status === 'attention' ? '#fcd34d' : '#67e8f9';
      prims.push(
        ellipse(X - 5, Y - 65, 4, 4, eye, { op: 0.55, filter: 'glow' }),
        ellipse(X + 5, Y - 65, 4, 4, eye, { op: 0.55, filter: 'glow' }),
        ellipse(X - 5, Y - 65, 2.2, 2.2, eye),
        ellipse(X + 5, Y - 65, 2.2, 2.2, eye)
      );
    }
    prims.push(path(`M${X} ${Y - 80} L${X} ${Y - 88}`, 'none', { stroke, op }));
    if (!ghost) {
      const pulse = status === 'working' || status === 'attention';
      prims.push(
        ellipse(X, Y - 91, 7, 7, light, { op: 0.5, filter: 'glow', pulse }),
        ellipse(X, Y - 91, 3.8, 3.8, light, { pulse })
      );
    }
    if (status === 'training') {
      // A graduation cap
      prims.push(
        path(
          `M${X - 20} ${Y - 80} L${X} ${Y - 88} L${X + 20} ${Y - 80} L${X} ${Y - 72} Z`,
          '#111827'
        ),
        path(`M${X + 14} ${Y - 80} L${X + 15} ${Y - 70}`, 'none', { stroke: '#f59e0b' })
      );
    }
    if (status === 'attention') {
      prims.push(
        ellipse(X + 24, Y - 92, 11, 11, '#dc2626'),
        path(roundedRect(X + 22.5, Y - 99, 3, 9, 1.5), '#ffffff'),
        ellipse(X + 24, Y - 86, 1.8, 1.8, '#ffffff')
      );
    }
    if (status === 'working') {
      // A "busy" bubble
      prims.push(path(roundedRect(X + 14, Y - 104, 32, 18, 9), '#ffffff', { stroke: '#cbd5e1' }));
      for (const dx of [22, 30, 38])
        prims.push(ellipse(X + dx, Y - 95, 2.2, 2.2, '#64748b', { pulse: true }));
    }
    if (status === 'paused') {
      // Charging
      prims.push(path(`M${X + 26} ${Y - 102} l-8 13 h7 l-3 11 l10 -15 h-7 z`, '#fbbf24'));
    }
    if (status === 'idle') {
      // A cup of coffee with steam
      prims.push(
        path(roundedRect(X + 16, Y - 36, 10, 11, 2), '#ffffff', { stroke: '#94a3b8' }),
        path(`M${X + 19} ${Y - 40} q-3 -5 0 -9 M${X + 23} ${Y - 40} q-3 -5 0 -9`, 'none', {
          stroke: '#94a3b8',
          op: 0.8,
        })
      );
    }
    return prims;
  };

  for (const role of AI_EMPLOYEE_ROLES) {
    const status = statuses[role];
    const spot = spotOf(role, status);
    if (status === 'working' || status === 'attention' || status === 'vacant')
      chair(spot.x, spot.y);
    add(spot.x, spot.y + 0.01, robot(spot.x, spot.y, status));
  }

  items.sort((a, b) => a.key - b.key);

  const labels: SceneLabel[] = OFFICE_AREAS.filter((area) => area !== 'corridor').map((area) => {
    const r = AREA_RECTS[area];
    // The front corner of the room's floor: the label hangs below it, over the corridor or the
    // edge of the floor, clear of the furniture and the name tags
    const [x, y] = project(r.x + r.w - 0.35, r.y + r.h - 0.35);
    return { area, x, y };
  });

  return { prims: [...base, ...items.flatMap((item) => item.prims)], labels };
}
