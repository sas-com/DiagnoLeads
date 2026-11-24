/**
 * Roles of the AI employees (Refs #1101, Epic #1100): the departments of the company the user
 * runs as its president. An organization hires up to AI_EMPLOYEES_PER_ROLE AI employees per role,
 * each at a desk of its own (#1282). The roles are
 * listed in the order value passes from hand to hand: the marketer finds prospects, sales turns
 * them into deals, the engineer prepares the proposal, the back office keeps the dates. The roles
 * are written as the work of any company's sales; what each role actually does is in ./works.ts,
 * by work pack (Refs #1115). The words of each role (title, description, default name) are in
 * locales/{ja,en}/aiOffice.json under aiOffice.roles.<role>.
 */

/** Rooms with a role's desk, in the order they are drawn */
export const AI_OFFICE_ROOMS = ['sales', 'marketing', 'engineering', 'backoffice'] as const;
export type AiOfficeRoom = (typeof AI_OFFICE_ROOMS)[number];

export const AI_EMPLOYEE_ROLES = ['marketer', 'sales', 'engineer', 'back_office'] as const;
export type AiEmployeeRole = (typeof AI_EMPLOYEE_ROLES)[number];

/**
 * The desks of a role in the office (#1282, the owner's decision of 2026-11-24): the most AI
 * employees a role may ever have. The database refuses a desk number outside it
 */
export const AI_EMPLOYEE_SEATS_PER_ROLE = 3;

/**
 * How many AI employees a role may have now: one, until the office shows several employees of a
 * role (each at its desk, on its name tag) — then AI_EMPLOYEE_SEATS_PER_ROLE (#1282)
 */
export const AI_EMPLOYEES_PER_ROLE = 1;

export interface AiEmployeeRoleDefinition {
  role: AiEmployeeRole;
  room: AiOfficeRoom;
}

export const AI_EMPLOYEE_ROLE_DEFINITIONS: Readonly<
  Record<AiEmployeeRole, AiEmployeeRoleDefinition>
> = {
  // Finds prospects and tells which ones are worth following
  marketer: { role: 'marketer', room: 'marketing' },
  // Turns prospects into deals and keeps the follow-ups from being dropped
  sales: { role: 'sales', room: 'sales' },
  // Prepares the proposal
  engineer: { role: 'engineer', room: 'engineering' },
  // Keeps the dates and the promises
  back_office: { role: 'back_office', room: 'backoffice' },
};

export function isAiEmployeeRole(value: string): value is AiEmployeeRole {
  return (AI_EMPLOYEE_ROLES as readonly string[]).includes(value);
}

/** The roles of a room, in catalog order */
export function rolesInRoom(room: AiOfficeRoom): AiEmployeeRole[] {
  return AI_EMPLOYEE_ROLES.filter((role) => AI_EMPLOYEE_ROLE_DEFINITIONS[role].room === room);
}
