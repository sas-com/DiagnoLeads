/**
 * What an AI employee hands in at the end of a piece of work (#1189, #1190), and the tools it
 * uses for it. A forced tool call is refused by the model (tool_choice any/tool), so the tool is
 * offered with `strict: true` and asked for in the prompt; what comes back is checked here again.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AiEmployeeSessionKind } from '../types/training';
import { refusedNoteContent } from './memory';

export const ONBOARDING_REPORT_TOOL = 'submit_onboarding_report';
export const REVIEW_REPORT_TOOL = 'submit_self_review';

/** A line of a report: like the notes, never a person's contact details or a secret */
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => refusedNoteContent(value) === null, 'contact details or a secret');

/** The onboarding report: who the employee is, what it understood, its goals and its questions */
export const onboardingReportSchema = z.object({
  introduction: line(400),
  role_summary: line(800),
  goals: z.array(line(200)).min(1).max(5),
  questions: z.array(line(200)).max(5),
});
export type OnboardingReport = z.infer<typeof onboardingReportSchema>;

/** The self-review of a monthly review, and the goals for the next 30 days */
export const selfReviewSchema = z.object({
  self_review: line(800),
  next_goals: z.array(line(200)).min(1).max(5),
});
export type SelfReview = z.infer<typeof selfReviewSchema>;

const stringArray = (maxItems: number, maxLength: number) => ({
  type: 'array',
  items: { type: 'string', maxLength },
  maxItems,
});

export const REPORT_TOOLS: Readonly<Record<AiEmployeeSessionKind, Anthropic.Tool>> = {
  onboarding: {
    name: ONBOARDING_REPORT_TOOL,
    description:
      'Hand in your onboarding report to the president once your notes are written. Call it exactly once, at the end. The president reads it and approves it or tells you what to correct.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        introduction: {
          type: 'string',
          maxLength: 400,
          description: 'A short self-introduction, in your own words, addressed to the president.',
        },
        role_summary: {
          type: 'string',
          maxLength: 800,
          description:
            'What you understood of your role: your purpose, what you do and do not do, from whom you receive work and to whom you hand it on.',
        },
        goals: {
          ...stringArray(5, 200),
          description: 'One to five goals for your first 30 days, each one measurable.',
        },
        questions: {
          ...stringArray(5, 200),
          description: 'Up to five questions you want the president to answer. May be empty.',
        },
      },
      required: ['introduction', 'role_summary', 'goals', 'questions'],
      additionalProperties: false,
    },
  },
  review: {
    name: REVIEW_REPORT_TOOL,
    description:
      'Hand in your self-review to the president once your goals note is updated. Call it exactly once, at the end.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        self_review: {
          type: 'string',
          maxLength: 800,
          description:
            'Your honest review of the period, from the facts you were given: what went well, what did not, what you will change. Do not claim work the facts do not show.',
        },
        next_goals: {
          ...stringArray(5, 200),
          description: 'One to five measurable goals for the next 30 days.',
        },
      },
      required: ['self_review', 'next_goals'],
      additionalProperties: false,
    },
  },
};

/** The report tool of each kind of work, and the schema that checks what it was given */
export const REPORT_SCHEMAS = {
  onboarding: onboardingReportSchema,
  review: selfReviewSchema,
} as const satisfies Record<AiEmployeeSessionKind, z.ZodTypeAny>;

export function reportToolOf(kind: AiEmployeeSessionKind): string {
  return REPORT_TOOLS[kind].name;
}
