/**
 * What the AI employees do (Refs #1115, Epic #1100): each piece of work belongs to a role and to
 * a work pack. The mechanism of the AI employees (hiring, the office, the records) is the same for
 * every company; the work comes in packs:
 * - sales_management: work any company's sales has, on the leads and deals of this app
 * - ax_migration: work of our own business (legacy system migration), kept out of the roles
 * The words of each work and pack are in locales/{ja,en}/aiOffice.json under aiOffice.works and
 * aiOffice.packs.
 */
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from './roles';

export const AI_WORK_PACKS = ['sales_management', 'ax_migration'] as const;
export type AiWorkPack = (typeof AI_WORK_PACKS)[number];

export const AI_EMPLOYEE_WORKS = [
  'score_new_leads',
  'check_due_actions',
  'draft_meeting_prep',
  'recompute_act_timing',
] as const;
export type AiEmployeeWork = (typeof AI_EMPLOYEE_WORKS)[number];

export interface AiEmployeeWorkDefinition {
  work: AiEmployeeWork;
  role: AiEmployeeRole;
  pack: AiWorkPack;
  /**
   * The issue that implements the work, or null once it runs. Until a role has a work that runs,
   * a hired employee of the role is shown "in training" and never runs.
   */
  issue: number | null;
}

export const AI_EMPLOYEE_WORK_DEFINITIONS: Readonly<
  Record<AiEmployeeWork, AiEmployeeWorkDefinition>
> = {
  // Scores new leads without a score with Claude
  score_new_leads: {
    work: 'score_new_leads',
    role: 'marketer',
    pack: 'sales_management',
    issue: 1103,
  },
  // Counts the next actions due soon or overdue (read only)
  check_due_actions: {
    work: 'check_due_actions',
    role: 'sales',
    pack: 'sales_management',
    issue: 1102,
  },
  // Drafts the preparation of the first meeting from the AX diagnosis answers
  draft_meeting_prep: {
    work: 'draft_meeting_prep',
    role: 'engineer',
    pack: 'ax_migration',
    issue: 1110,
  },
  // Recomputes "when to act" of the leads (from the hearings and the AX diagnosis answers)
  recompute_act_timing: {
    work: 'recompute_act_timing',
    role: 'back_office',
    pack: 'ax_migration',
    issue: 1102,
  },
};

/** The works of a role, in catalog order */
export function worksOfRole(role: AiEmployeeRole): AiEmployeeWorkDefinition[] {
  return AI_EMPLOYEE_WORKS.map((work) => AI_EMPLOYEE_WORK_DEFINITIONS[work]).filter(
    (definition) => definition.role === role
  );
}

/** Whether a work runs yet */
export function workIsReady(work: AiEmployeeWork): boolean {
  return AI_EMPLOYEE_WORK_DEFINITIONS[work].issue === null;
}

/** Whether employees of the role have work to do yet: one of the role's works runs */
export function roleHasWork(role: AiEmployeeRole): boolean {
  return worksOfRole(role).some((definition) => definition.issue === null);
}

/** The roles nobody has given any work in the catalog (none: every role has at least one) */
export function rolesWithoutWorks(): AiEmployeeRole[] {
  return AI_EMPLOYEE_ROLES.filter((role) => worksOfRole(role).length === 0);
}
