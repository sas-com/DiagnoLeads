/**
 * Sales follow-up of a lead: contact records (Refs #136) and next actions (Refs #85)
 */

import { isoDateSchema } from '@/lib/features/lead-hearings/types/schemas';
import { z } from 'zod';

/** What a contact record says happened: called and talked, emailed, called and nobody answered */
export const CONTACT_KINDS = ['call', 'email', 'no_answer'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
/**
 * Kinds that reached the person. Only these end the wait for the first contact; "no answer"
 * stays on the dashboard's waiting list (owner decision, #136). The first contact TIME (speed
 * to lead) still counts every kind, see firstContactTimes in ../service.ts.
 */
export const REACHED_CONTACT_KINDS = ['call', 'email'] as const satisfies readonly ContactKind[];

export const CONTACT_NOTE_MAX = 1000;
export const TASK_TITLE_MAX = 200;
export const TASK_NOTE_MAX = 2000;
/** Next actions a lead can have (open and done together) */
export const LEAD_TASKS_MAX_PER_LEAD = 200;
/** Contact records shown on the lead page */
export const RECENT_CONTACTS_LIMIT = 5;
/** Due next actions listed on the dashboard */
export const DUE_TASKS_SHOWN = 20;

export const TASK_SOURCES = ['manual', 'hearing'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/**
 * next_action: something to do by a date. takeaway (持ち帰り事項): something the rep promised to
 * check and bring back (a question to answer, a document to send), optionally with whom to
 * check with.
 */
export const TASK_KINDS = ['next_action', 'takeaway'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const CHECK_WITH_MAX = 200;

/** Whose tasks the dashboard lists: the user's own (default) or everyone's */
export const DUE_TASK_SCOPES = ['mine', 'all'] as const;
export type DueTaskScope = (typeof DUE_TASK_SCOPES)[number];

const organizationId = z.string().uuid();
const leadId = z.string().uuid();
const id = z.string().uuid();
const optionalNote = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish();

export const recordContactSchema = z
  .object({
    organizationId,
    leadId,
    kind: z.enum(CONTACT_KINDS),
    note: optionalNote(CONTACT_NOTE_MAX),
  })
  .strict();
export type RecordContactInput = z.infer<typeof recordContactSchema>;

export const leadScopeSchema = z.object({ organizationId, leadId }).strict();

export const deleteContactSchema = z.object({ organizationId, id }).strict();

/** Whom to check with is given as free text or as a member, never both */
const checkWithFields = {
  checkWith: optionalNote(CHECK_WITH_MAX),
  checkWithUserId: z.string().uuid().nullish(),
};

function refineCheckWith(
  value: { kind?: TaskKind; checkWith?: string | null; checkWithUserId?: string | null },
  ctx: z.RefinementCtx
) {
  if (value.checkWith && value.checkWithUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['checkWith'],
      message: 'Give whom to check with as text or as a member, not both',
    });
  }
  if (value.kind === 'next_action' && (value.checkWith || value.checkWithUserId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['checkWith'],
      message: 'Only a takeaway has whom to check with',
    });
  }
}

export const createTaskSchema = z
  .object({
    organizationId,
    leadId,
    title: z.string().trim().min(1).max(TASK_TITLE_MAX),
    dueOn: isoDateSchema,
    note: optionalNote(TASK_NOTE_MAX),
    kind: z.enum(TASK_KINDS).default('next_action'),
    ...checkWithFields,
  })
  .strict()
  .superRefine(refineCheckWith);
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Only the given fields change; done = true completes the task, false reopens it */
export const updateTaskSchema = z
  .object({
    organizationId,
    id,
    title: z.string().trim().min(1).max(TASK_TITLE_MAX).optional(),
    dueOn: isoDateSchema.optional(),
    note: optionalNote(TASK_NOTE_MAX),
    done: z.boolean().optional(),
    /** Turning a takeaway into a next action clears whom to check with */
    kind: z.enum(TASK_KINDS).optional(),
    ...checkWithFields,
  })
  .strict()
  .superRefine(refineCheckWith);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const deleteTaskSchema = z.object({ organizationId, id }).strict();

export const dueTasksSchema = z
  .object({ organizationId, scope: z.enum(DUE_TASK_SCOPES).default('mine') })
  .strict();

export interface ContactActor {
  id: string;
  /** users.name, or the email address when there is no name */
  name: string;
}

export interface ContactLogView {
  id: string;
  leadId: string;
  kind: ContactKind;
  note: string | null;
  contactedAt: Date;
  createdBy: ContactActor | null;
}

export interface LeadContactSummary {
  /** Earliest contact record of the lead, any kind; null when nobody has recorded one */
  firstContactAt: Date | null;
  total: number;
  /** "No answer" records (shown as "unreachable N times") */
  noAnswerCount: number;
  recent: ContactLogView[];
}

export interface LeadTaskView {
  id: string;
  leadId: string;
  /** Null for a task from a hearing that kept the default title (the screen names it) */
  title: string | null;
  note: string | null;
  dueOn: string;
  done: boolean;
  completedAt: Date | null;
  source: TaskSource;
  sourceHearingId: string | null;
  kind: TaskKind;
  /** Whom to check with (takeaways): free text, or a member (checkWithUser) */
  checkWith: string | null;
  checkWithUser: ContactActor | null;
  assigneeId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DueTaskView extends LeadTaskView {
  lead: { name: string | null; company: string | null };
  /** The user is the one responsible for it (see responsibleUserSql in ../service.ts) */
  mine: boolean;
}
