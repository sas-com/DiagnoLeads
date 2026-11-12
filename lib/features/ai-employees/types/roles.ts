/**
 * Roles of the AI employees (Refs #1101, Epic #1100): the departments of the company the user
 * runs as its president. An organization hires at most one AI employee per role. The roles are
 * listed in the order value passes from hand to hand: the marketer finds prospects, sales turns
 * them into deals, the engineer prepares the proposal, the back office keeps the dates. The words
 * of each role (title, description, default name) are in locales/{ja,en}/aiOffice.json under
 * aiOffice.roles.<role>.
 */

/** Rooms with a role's desk, in the order they are drawn */
export const AI_OFFICE_ROOMS = ['sales', 'marketing', 'engineering', 'backoffice'] as const;
export type AiOfficeRoom = (typeof AI_OFFICE_ROOMS)[number];

export const AI_EMPLOYEE_ROLES = ['marketer', 'sales', 'engineer', 'back_office'] as const;
export type AiEmployeeRole = (typeof AI_EMPLOYEE_ROLES)[number];

export interface AiEmployeeRoleDefinition {
  role: AiEmployeeRole;
  room: AiOfficeRoom;
  /**
   * The issue that gives the role its work, or null once it works. Until then a hired employee
   * of the role is shown "in training" and never runs.
   */
  workIssue: number | null;
}

export const AI_EMPLOYEE_ROLE_DEFINITIONS: Readonly<
  Record<AiEmployeeRole, AiEmployeeRoleDefinition>
> = {
  // Scores new leads without a score with Claude
  marketer: { role: 'marketer', room: 'marketing', workIssue: 1103 },
  // Counts the next actions due soon or overdue (read only)
  sales: { role: 'sales', room: 'sales', workIssue: 1102 },
  // Drafts the preparation of the first meeting from the diagnosis answers
  engineer: { role: 'engineer', room: 'engineering', workIssue: 1110 },
  // Recomputes "when to act" of the leads
  back_office: { role: 'back_office', room: 'backoffice', workIssue: 1102 },
};

export function isAiEmployeeRole(value: string): value is AiEmployeeRole {
  return (AI_EMPLOYEE_ROLES as readonly string[]).includes(value);
}

/** The roles of a room, in catalog order */
export function rolesInRoom(room: AiOfficeRoom): AiEmployeeRole[] {
  return AI_EMPLOYEE_ROLES.filter((role) => AI_EMPLOYEE_ROLE_DEFINITIONS[role].room === room);
}

/** Whether employees of the role have work to do yet */
export function roleHasWork(role: AiEmployeeRole): boolean {
  return AI_EMPLOYEE_ROLE_DEFINITIONS[role].workIssue === null;
}
