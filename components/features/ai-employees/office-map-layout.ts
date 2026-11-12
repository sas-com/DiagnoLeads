/**
 * The floor plan of the virtual office (Refs #1101) in floor units, and where each AI employee is
 * on it. Pure: the scene (office-scene.ts) draws it, the map, the sheet and the tests read it.
 *
 * Like in a virtual office, a robot goes where its status takes it: to its desk while working (or
 * when its work needs a look), to the lounge while waiting, to the training room while its role
 * has no work yet, and to the charging station while paused. A vacant desk keeps a faint outline
 * of a robot on its empty chair. Wherever it is, a robot is turned towards its desk or table.
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

/**
 * Which way a robot is turned: 'left' towards the floor's +y (the viewer's lower left), 'right'
 * towards the floor's +x (the viewer's lower right). Either way its face is visible.
 */
export type RobotFacing = 'left' | 'right';

export interface FloorSpot extends FloorPoint {
  facing: RobotFacing;
}

/**
 * The desk of each role. Whoever works at a desk sits behind it (on its -y side) and faces +y:
 * the keyboard is on their side, the monitors stand on the far edge with their backs to the
 * viewer. The seat follows from the desk, so the robot and its desk always face each other.
 */
export const ROLE_DESKS: Readonly<
  Record<AiEmployeeRole, { x: number; y: number; w: number; d: number; monitors: 1 | 2 }>
> = {
  follow_up_keeper: { x: 1.2, y: 2.3, w: 1.8, d: 0.9, monitors: 1 },
  lead_scorer: { x: 12.8, y: 2.0, w: 1.6, d: 0.9, monitors: 2 },
  timing_watcher: { x: 17.6, y: 2.0, w: 1.6, d: 0.9, monitors: 1 },
};

/** How far behind its desk a seat is */
export const SEAT_BEHIND_DESK = 0.55;

/** The seat of a desk: centred behind it, turned towards it */
export function seatOfDesk(desk: { x: number; y: number; w: number }): FloorSpot {
  return { x: desk.x + desk.w / 2, y: desk.y - SEAT_BEHIND_DESK, facing: 'left' };
}

/** Where the robot of each role sits at its own desk */
export const DESK_SEATS: Readonly<Record<AiEmployeeRole, FloorSpot>> = {
  follow_up_keeper: seatOfDesk(ROLE_DESKS.follow_up_keeper),
  lead_scorer: seatOfDesk(ROLE_DESKS.lead_scorer),
  timing_watcher: seatOfDesk(ROLE_DESKS.timing_watcher),
};

/** The study desks of the training room (front row): same orientation as the work desks */
export const TRAINING_DESKS: readonly { x: number; y: number; w: number; d: number }[] = [
  { x: 0.9, y: 12.6, w: 1.6, d: 0.8 },
  { x: 3.2, y: 12.6, w: 1.6, d: 0.8 },
  { x: 5.5, y: 12.6, w: 1.6, d: 0.8 },
];

/** One place per role in each shared area, in the order of AI_EMPLOYEE_ROLES */
const SHARED_SEATS: Readonly<Record<'training' | 'lounge' | 'charging', readonly FloorSpot[]>> = {
  // In front of the sofa, turned to the coffee table; and behind the round table, turned to it
  lounge: [
    { x: 10.15, y: 12.0, facing: 'right' },
    { x: 10.15, y: 14.0, facing: 'right' },
    { x: 14.4, y: 11.8, facing: 'left' },
  ],
  training: TRAINING_DESKS.map(seatOfDesk),
  // On the docks
  charging: [
    { x: 17.6, y: 11.5, facing: 'left' },
    { x: 17.6, y: 13.3, facing: 'left' },
    { x: 17.6, y: 15.1, facing: 'left' },
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
export function spotOf(role: AiEmployeeRole, status: DeskStatus): FloorSpot {
  const area = areaOf(role, status);
  if (area === 'training' || area === 'lounge' || area === 'charging') {
    return SHARED_SEATS[area][AI_EMPLOYEE_ROLES.indexOf(role)];
  }
  return DESK_SEATS[role];
}
