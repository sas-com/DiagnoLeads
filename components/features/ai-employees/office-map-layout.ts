/**
 * The floor plan of the virtual office (Refs #1101), in the units of the map's viewBox, and where
 * each AI employee is on it. Pure: the map draws it, the screen and the tests read it.
 *
 * Like in a virtual office, a robot goes where its status takes it: to its desk while working (or
 * when its work needs a look), to the lounge while waiting, to the training room while its role
 * has no work yet, and to the charging station while paused. A vacant desk keeps its empty chair.
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import {
  AI_EMPLOYEE_ROLES,
  AI_EMPLOYEE_ROLE_DEFINITIONS,
  type AiEmployeeRole,
  type AiOfficeRoom,
} from '@/lib/features/ai-employees/types/roles';

export const MAP_WIDTH = 1200;
export const MAP_HEIGHT = 760;

/** The rooms of the role's desks, and the shared places */
export const OFFICE_AREAS = [
  'sales',
  'analysis',
  'planning',
  'training',
  'lounge',
  'charging',
  'entrance',
  'corridor',
] as const;
export type OfficeArea = (typeof OFFICE_AREAS)[number];

export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Inside the outer wall (20 to 1180, 20 to 740); the 10 units between rooms are their walls */
export const AREA_RECTS: Readonly<Record<OfficeArea, MapRect>> = {
  sales: { x: 30, y: 30, w: 500, h: 300 },
  analysis: { x: 540, y: 30, w: 310, h: 300 },
  planning: { x: 860, y: 30, w: 310, h: 300 },
  corridor: { x: 30, y: 340, w: 1140, h: 70 },
  training: { x: 30, y: 420, w: 350, h: 310 },
  lounge: { x: 390, y: 420, w: 410, h: 310 },
  charging: { x: 810, y: 420, w: 180, h: 310 },
  entrance: { x: 1000, y: 420, w: 170, h: 310 },
};

export interface MapPoint {
  x: number;
  y: number;
  /** Which way the robot faces, in degrees (0: up, towards the top of the map) */
  facing: number;
}

/** Where the robot of each role sits at its own desk (the chair) */
export const DESK_SEATS: Readonly<Record<AiEmployeeRole, MapPoint>> = {
  follow_up_keeper: { x: 130, y: 232, facing: 0 },
  lead_scorer: { x: 710, y: 132, facing: 0 },
  timing_watcher: { x: 925, y: 132, facing: 0 },
};

/** One place per role in each shared area, in the order of AI_EMPLOYEE_ROLES */
const SHARED_SEATS: Readonly<Record<'training' | 'lounge' | 'charging', readonly MapPoint[]>> = {
  training: [
    { x: 110, y: 590, facing: 0 },
    { x: 205, y: 590, facing: 0 },
    { x: 300, y: 590, facing: 0 },
  ],
  lounge: [
    { x: 455, y: 560, facing: 90 },
    { x: 455, y: 630, facing: 90 },
    { x: 700, y: 520, facing: 180 },
  ],
  charging: [
    { x: 900, y: 500, facing: 270 },
    { x: 900, y: 590, facing: 270 },
    { x: 900, y: 680, facing: 270 },
  ],
};

/** The area a desk status sends the robot to */
export function areaOf(role: AiEmployeeRole, status: DeskStatus): OfficeArea {
  switch (status) {
    case 'idle':
      return 'lounge';
    case 'training':
      return 'training';
    case 'paused':
      return 'charging';
    default:
      return AI_EMPLOYEE_ROLE_DEFINITIONS[role].room;
  }
}

/** Where the robot of the role is (or, when vacant, its empty chair) */
export function spotOf(role: AiEmployeeRole, status: DeskStatus): MapPoint {
  const area = areaOf(role, status);
  if (area === 'training' || area === 'lounge' || area === 'charging') {
    return SHARED_SEATS[area][AI_EMPLOYEE_ROLES.indexOf(role)];
  }
  return DESK_SEATS[role];
}

/** The room of a role's desk, as an area */
export function deskArea(role: AiEmployeeRole): AiOfficeRoom {
  return AI_EMPLOYEE_ROLE_DEFINITIONS[role].room;
}

/** A point of the map as percentages of its box, to place HTML over the drawing */
export function toPercent(point: { x: number; y: number }) {
  return { left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` };
}
