/**
 * The floor plan of the virtual office (Refs #1101) in floor units, and where each AI employee is
 * on it. Pure: the scene (office-scene.ts) draws it, the map, the sheet and the tests read it.
 *
 * Like in a virtual office, a robot goes where its status takes it: to its desk while working (or
 * when its work needs a look), to the lounge while waiting, to the training room while its role
 * has no work yet, and to the charging station while paused. A vacant desk keeps a faint outline
 * of a robot on its empty chair.
 *
 * Floor units: the floor is 24 x 16; x runs to the lower right of the screen, y to the lower left.
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import {
  AI_EMPLOYEE_ROLES,
  AI_EMPLOYEE_ROLE_DEFINITIONS,
  type AiEmployeeRole,
} from '@/lib/features/ai-employees/types/roles';

export const FLOOR_WIDTH = 24;
export const FLOOR_DEPTH = 16;

/** The rooms of the role's desks, and the shared places */
export const OFFICE_AREAS = [
  'sales',
  'analysis',
  'planning',
  'corridor',
  'training',
  'lounge',
  'charging',
  'entrance',
] as const;
export type OfficeArea = (typeof OFFICE_AREAS)[number];

export interface FloorRect {
  x: number;
  y: number;
  /** Along x */
  w: number;
  /** Along y */
  h: number;
}

export const AREA_RECTS: Readonly<Record<OfficeArea, FloorRect>> = {
  sales: { x: 0, y: 0, w: 10, h: 8 },
  analysis: { x: 10, y: 0, w: 7, h: 8 },
  planning: { x: 17, y: 0, w: 7, h: 8 },
  corridor: { x: 0, y: 8, w: 24, h: 2 },
  training: { x: 0, y: 10, w: 8, h: 6 },
  lounge: { x: 8, y: 10, w: 8, h: 6 },
  charging: { x: 16, y: 10, w: 4, h: 6 },
  entrance: { x: 20, y: 10, w: 4, h: 6 },
};

export interface FloorPoint {
  x: number;
  y: number;
}

/** Where the robot of each role sits at its own desk (behind it, facing the viewer) */
export const DESK_SEATS: Readonly<Record<AiEmployeeRole, FloorPoint>> = {
  follow_up_keeper: { x: 2.1, y: 1.75 },
  lead_scorer: { x: 13.6, y: 1.45 },
  timing_watcher: { x: 18.4, y: 1.45 },
};

/** One place per role in each shared area, in the order of AI_EMPLOYEE_ROLES */
const SHARED_SEATS: Readonly<Record<'training' | 'lounge' | 'charging', readonly FloorPoint[]>> = {
  lounge: [
    { x: 10.1, y: 11.9 },
    { x: 10.1, y: 13.9 },
    { x: 14.4, y: 14.2 },
  ],
  training: [
    { x: 4.4, y: 11.4 },
    { x: 4.4, y: 13.2 },
    { x: 4.4, y: 15.0 },
  ],
  charging: [
    { x: 17.6, y: 11.5 },
    { x: 17.6, y: 13.3 },
    { x: 17.6, y: 15.1 },
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
export function spotOf(role: AiEmployeeRole, status: DeskStatus): FloorPoint {
  const area = areaOf(role, status);
  if (area === 'training' || area === 'lounge' || area === 'charging') {
    return SHARED_SEATS[area][AI_EMPLOYEE_ROLES.indexOf(role)];
  }
  return DESK_SEATS[role];
}
