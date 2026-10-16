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

export const createTaskSchema = z
  .object({
    organizationId,
    leadId,
    title: z.string().trim().min(1).max(TASK_TITLE_MAX),
    dueOn: isoDateSchema,
    note: optionalNote(TASK_NOTE_MAX),
  })
  .strict();
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
  })
  .strict();
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const deleteTaskSchema = z.object({ organizationId, id }).strict();

export const dueTasksSchema = z.object({ organizationId }).strict();

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
  assigneeId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DueTaskView extends LeadTaskView {
  lead: { name: string | null; company: string | null };
}
