/**
 * Roles of the AI employees (Refs #1101, Epic #1100). An organization hires at most one AI
 * employee per role. The words of each role (title, description, default name) are in
 * locales/{ja,en}/aiOffice.json under aiOffice.roles.<role>.
 */

/** Rooms of the office floor, in the order they are drawn */
export const AI_OFFICE_ROOMS = ['sales', 'analysis', 'planning'] as const;
export type AiOfficeRoom = (typeof AI_OFFICE_ROOMS)[number];

export const AI_EMPLOYEE_ROLES = ['follow_up_keeper', 'lead_scorer', 'timing_watcher'] as const;
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
  // Counts the next actions due soon or overdue (read only)
  follow_up_keeper: { role: 'follow_up_keeper', room: 'sales', workIssue: 1102 },
  // Scores new leads without a score with Claude
  lead_scorer: { role: 'lead_scorer', room: 'analysis', workIssue: 1103 },
  // Recomputes "when to act" of the leads
  timing_watcher: { role: 'timing_watcher', room: 'planning', workIssue: 1102 },
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
