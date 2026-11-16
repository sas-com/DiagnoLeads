import { z } from 'zod';
import { refusedNoteContent } from '../agent/memory';
import { employeeScopeSchema, officeScopeSchema } from './schemas';

/**
 * The training room (Epic #1187): the onboarding, the reviews and the notes of the AI employees.
 * Shared by the service, the router and the screen.
 */

export const AI_EMPLOYEE_SESSION_KINDS = ['onboarding', 'review'] as const;
export type AiEmployeeSessionKind = (typeof AI_EMPLOYEE_SESSION_KINDS)[number];

export const AI_EMPLOYEE_SESSION_STATUSES = [
  'running',
  'waiting',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type AiEmployeeSessionStatus = (typeof AI_EMPLOYEE_SESSION_STATUSES)[number];

/** Open sessions: one per employee at a time */
export const OPEN_SESSION_STATUSES = [
  'running',
  'waiting',
] as const satisfies readonly AiEmployeeSessionStatus[];

export const AI_EMPLOYEE_POLICY_MAX_LENGTH = 400;
export const AI_EMPLOYEE_CORRECTION_MAX_LENGTH = 600;

/** One paragraph of plain text: line breaks allowed, no other control characters */
const PARAGRAPH = /^[^\p{Cc}\p{Cf}]*$/u;
/**
 * What the president writes for an employee reaches Claude: like the notes, never a person's
 * contact details or a secret (decision 2026-10-25-ai-no-personal-data)
 */
const paragraph = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => PARAGRAPH.test(value.replace(/\r?\n/g, ' ')), 'Invalid characters')
    .refine((value) => refusedNoteContent(value) === null, 'personal_data');

export const trainingScopeSchema = officeScopeSchema;

/** What the president expects of an employee; empty clears it */
export const setPolicySchema = employeeScopeSchema.extend({
  policy: paragraph(AI_EMPLOYEE_POLICY_MAX_LENGTH),
});

export const sessionScopeSchema = officeScopeSchema.extend({
  sessionId: z.string().uuid(),
});

/** Start the onboarding of an employee, written in the president's language */
export const startOnboardingSchema = employeeScopeSchema.extend({
  locale: z.enum(['ja', 'en']),
});

/** The president's answer to an onboarding report: approve, or tell what to correct */
export const answerOnboardingSchema = z.discriminatedUnion('answer', [
  sessionScopeSchema.extend({ answer: z.literal('approve') }),
  sessionScopeSchema.extend({
    answer: z.literal('correct'),
    correction: paragraph(AI_EMPLOYEE_CORRECTION_MAX_LENGTH).pipe(z.string().min(1)),
  }),
]);

export const startReviewSchema = startOnboardingSchema;

/**
 * The president's decision at a review. A promotion carries the level it raises from, so that a
 * double send, or an answer to a review that changed meanwhile, never raises twice.
 */
export const decideReviewSchema = z.discriminatedUnion('decision', [
  officeScopeSchema.extend({
    reviewId: z.string().uuid(),
    decision: z.literal('promote'),
    fromLevel: z.number().int().min(1).max(3),
  }),
  officeScopeSchema.extend({ reviewId: z.string().uuid(), decision: z.literal('keep') }),
]);

/** A manager fixes or deletes a note (content null deletes) */
export const editMemorySchema = employeeScopeSchema.extend({
  path: z.string().max(120),
  content: z.string().max(4_000).nullable(),
});
