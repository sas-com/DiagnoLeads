/**
 * The president's side of the AI office (Refs #1109): in the full-screen office the user is the
 * president of the company and the AI employees are its staff. Pure rules of that world, all
 * read from the real state of the office: what the president has to do today, what can be said
 * to an AI employee, and whether it is day or night.
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiTone, RobotLook } from '@/lib/features/ai-employees/types/profile';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';

/** The hour (0 to 23) of an instant in a time zone: the one the clock on the screen shows */
export function hourIn(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone })
    .formatToParts(now)
    .find((part) => part.type === 'hour');
  return Number(hour?.value ?? 0);
}

/** Night falls at 18:00 and ends at 6:00 */
export function isNightHour(hour: number): boolean {
  return hour < 6 || hour >= 18;
}

/** The status of each role's desk: vacant when nobody was hired for it */
export function statusByRole(
  employees: readonly { role: AiEmployeeRole; deskStatus: DeskStatus }[]
): Record<AiEmployeeRole, DeskStatus> {
  const byRole = new Map(employees.map((employee) => [employee.role, employee.deskStatus]));
  return Object.fromEntries(
    AI_EMPLOYEE_ROLES.map((role) => [role, byRole.get(role) ?? 'vacant'])
  ) as Record<AiEmployeeRole, DeskStatus>;
}

/**
 * What the president has to do:
 * - consult: an AI employee's work stopped and needs a look
 * - resume: an AI employee is paused and only the president's side can put it back to work
 * - hire: a department has nobody
 */
export interface PresidentTask {
  kind: 'consult' | 'resume' | 'hire';
  role: AiEmployeeRole;
}

/** How many tasks the list shows */
export const PRESIDENT_TASKS_MAX = 3;

/**
 * The president's tasks, the most pressing first: stopped work, then paused staff, then vacant
 * departments. Hiring and resuming are offered only to those who may manage the AI employees.
 */
export function presidentTasks(
  statuses: Readonly<Record<AiEmployeeRole, DeskStatus>>,
  canManage: boolean
): PresidentTask[] {
  const tasks: PresidentTask[] = [];
  for (const role of AI_EMPLOYEE_ROLES) {
    if (statuses[role] === 'attention') tasks.push({ kind: 'consult', role });
  }
  if (canManage) {
    for (const role of AI_EMPLOYEE_ROLES) {
      if (statuses[role] === 'paused') tasks.push({ kind: 'resume', role });
    }
    for (const role of AI_EMPLOYEE_ROLES) {
      if (statuses[role] === 'vacant') tasks.push({ kind: 'hire', role });
    }
  }
  return tasks.slice(0, PRESIDENT_TASKS_MAX);
}

/** The role the president is most likely to talk to first: the first task's, else the first hired */
export function firstRoleToVisit(
  statuses: Readonly<Record<AiEmployeeRole, DeskStatus>>,
  canManage: boolean
): AiEmployeeRole {
  const [task] = presidentTasks(statuses, canManage);
  if (task) return task.role;
  return AI_EMPLOYEE_ROLES.find((role) => statuses[role] !== 'vacant') ?? AI_EMPLOYEE_ROLES[0];
}

/**
 * What the president can answer in a conversation; 'leave' is always last. With an employee
 * that was hired, the staff matters are there too (#1170): its work log for everyone, a new name
 * and the dismissal for who manages the AI employees. The dismissal comes last of them, next
 * to leaving: it only opens the question, and is carried out once the name was typed.
 */
export type TalkChoice = 'hire' | 'pause' | 'resume' | 'rename' | 'log' | 'dismiss' | 'leave';

export function talkChoices(status: DeskStatus, canManage: boolean): TalkChoice[] {
  if (status === 'vacant') return canManage ? ['hire', 'leave'] : ['leave'];
  if (!canManage) return ['log', 'leave'];
  return [status === 'paused' ? 'resume' : 'pause', 'rename', 'log', 'dismiss', 'leave'];
}

/**
 * Where the stage (a box of `width` x `height`, scaled by `scale` from its top left corner) has
 * to move so that the point at (`px`, `py`) of the stage (0 to 1) lands on (`targetX`, `targetY`)
 * of the screen
 */
export function cameraOffset(input: {
  width: number;
  height: number;
  scale: number;
  px: number;
  py: number;
  targetX: number;
  targetY: number;
}): { x: number; y: number } {
  return {
    x: input.targetX - input.scale * input.px * input.width,
    y: input.targetY - input.scale * input.py * input.height,
  };
}

/** The screen width from which the panels sit in the corners around the floor */
export const WIDE_SCREEN = 1280;

/** How much closer than "the whole floor in view" the camera starts at most, on a wide screen */
export const HOME_CLOSE_UP = 1.2;

/**
 * The width the panels take on each side of the floor, margin included (the president and the
 * staff on the left: `left-6 w-72`; the tasks and the one in front on the right: `right-6 w-80`)
 */
export const HUD_SIDES = { left: 312, right: 344 };

/** The share of the drawing's width that the floor itself spans, corner to corner */
const FLOOR_SHARE = 0.9;

/**
 * How far past the room between the side panels the floor may reach when the camera starts:
 * its corners pass under the panels, but whoever sits near a corner must not
 */
const CORNER_REACH = 1.3;

/**
 * How much closer than "the whole floor in view" the camera starts (#1183). On a screen with
 * room between the side panels the floor starts larger than the screen holds, so the office
 * reads as a place; where the panels leave less room it starts with the whole floor in view,
 * so that nobody stands under a panel when the office opens.
 */
export function homeCloseUp(size: { w: number; h: number }, aspect = 10 / 7): number {
  if (size.w < WIDE_SCREEN) return 1;
  const floor = Math.min(size.w, size.h * aspect) * FLOOR_SHARE;
  const between = size.w - HUD_SIDES.left - HUD_SIDES.right;
  return Math.max(1, Math.min(HOME_CLOSE_UP, (between / floor) * CORNER_REACH));
}

/** How far the floor starts to the side, so that it is centred between the side panels */
export function homeShift(size: { w: number; h: number }): number {
  return size.w < WIDE_SCREEN ? 0 : (HUD_SIDES.left - HUD_SIDES.right) / 2;
}

/**
 * Where the camera starts in the office, as a zoom of the floor that covers the screen and a
 * shift in pixels, and how far the camera can step back from there (`out`, a factor of the
 * starting zoom): to the whole floor in view. On a narrow screen the floor covers the screen
 * and is dragged around.
 */
export function homeView(
  size: { w: number; h: number },
  aspect: number
): { zoom: number; x: number; y: number; out: number } {
  if (size.w < WIDE_SCREEN) return { zoom: 1, x: 0, y: 0, out: 1 };
  const cover = Math.max(size.w, size.h * aspect);
  const fit = Math.min(size.w, size.h * aspect);
  const closeUp = homeCloseUp(size, aspect);
  return {
    zoom: (fit / cover) * closeUp,
    x: homeShift(size),
    y: -Math.round(size.h * 0.03),
    out: 1 / closeUp,
  };
}

/** How the robot of each hired role was customized (#1134); a role left out wears its own build */
export type RobotLooks = Partial<Record<AiEmployeeRole, RobotLook>>;

export function looksByRole(
  employees: readonly { role: AiEmployeeRole; profile: { look: RobotLook } }[]
): RobotLooks {
  const looks: RobotLooks = {};
  for (const employee of employees) looks[employee.role] = employee.profile.look;
  return looks;
}

/** What an AI employee says about itself in a conversation, by what happened */
export const TALK_LINES = [
  'training',
  'paused',
  'idle',
  'working',
  'attention',
  'pausedDone',
  'resumed',
  'resumedTraining',
  'failed',
] as const;
export type TalkLine = (typeof TALK_LINES)[number];

/** Where the polite lines have always been in the messages (aiOffice.immersive) */
const POLITE_LINE_KEYS: Readonly<Record<TalkLine, string>> = {
  training: 'talk.lines.training',
  paused: 'talk.lines.paused',
  idle: 'talk.lines.idle',
  working: 'talk.lines.working',
  attention: 'talk.lines.attention',
  pausedDone: 'talk.paused',
  resumed: 'talk.resumed',
  resumedTraining: 'talk.resumedTraining',
  failed: 'talk.failed',
};

/**
 * The message (under aiOffice.immersive) of a line in the employee's tone (#1134). The polite
 * tone is how the employees have always talked; the others have their own set of the same lines.
 */
export function talkLineKey(line: TalkLine, tone: AiTone): string {
  return tone === 'polite' ? POLITE_LINE_KEYS[line] : `tones.${tone}.${line}`;
}
