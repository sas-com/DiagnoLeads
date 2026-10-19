/**
 * AX sales playbook schemas
 *
 * The playbook (talk script) used by sales and partners in AX migration meetings. Its text is
 * confidential and this repository is public, so only the shape lives in code; each
 * organization enters the content from the settings screen (Refs #74).
 */

import {
  AX_COMPANY_SIZE_OPTIONS,
  type AxTargetCompany,
  emptyAxTargetCompany,
} from '@/lib/features/diagnostics/ax-migration/company-size';
import { z } from 'zod';

/** Same keys as ChallengeType in lib/features/diagnostics/ax-migration/evaluate.ts */
export const AX_PLAYBOOK_CHALLENGES = ['people', 'cost', 'agility', 'data'] as const;
export type AxPlaybookChallenge = (typeof AX_PLAYBOOK_CHALLENGES)[number];

export const AX_PLAYBOOK_LIMITS = {
  /** Characters per text field */
  textMax: 1000,
  /** Items per list */
  itemsMax: 30,
} as const;

const text = z.string().trim().max(AX_PLAYBOOK_LIMITS.textMax);
const requiredText = text.min(1);
const textList = z.array(requiredText).max(AX_PLAYBOOK_LIMITS.itemsMax);

export const axPlaybookChallengeGuideSchema = z.object({
  /** How to explain the effect for this challenge */
  effect: text,
  /** Questions to dig deeper */
  questions: textList,
  /** Answers that signal an opportunity */
  signals: textList,
});

/**
 * Why a past attempt stopped (#157): the same values as the hearing's 進まなかった理由
 * (pastBlocker). Objections and NG phrases are tagged with the reasons they answer, so the lead
 * page can pick the ones that fit the lead.
 */
export const OBJECTION_REASONS = [
  'budget',
  'staffing',
  'risk',
  'priority',
  'vendor',
  'other',
] as const;
export type ObjectionReason = (typeof OBJECTION_REASONS)[number];

/** Tags in the fixed order, once each; rows saved before #157 have none */
const reasonTags = z
  .array(z.enum(OBJECTION_REASONS))
  .max(OBJECTION_REASONS.length)
  .default([])
  .transform((list) => OBJECTION_REASONS.filter((reason) => list.includes(reason)));

export const axPlaybookObjectionSchema = z.object({
  customer: requiredText,
  response: requiredText,
  note: text,
  reasons: reasonTags,
});

export const axPlaybookNgPhraseSchema = z.object({
  ng: requiredText,
  alternative: requiredText,
  /** Empty: shown for every lead */
  reasons: reasonTags,
});

export const axPlaybookEscalationSchema = z.object({
  topic: requiredText,
  contact: requiredText,
});

const sizeRanges = (values: readonly [string, ...string[]]) =>
  z
    .array(z.enum(values))
    .transform((list) => values.filter((value) => list.includes(value)))
    .default([]);

/**
 * Company sizes the sales team targets (#150): the ranges of each diagnosis question that fit.
 * Empty means no condition. Kept here, not in code, because the ranges are confidential.
 */
export const axTargetCompanySchema = z
  .object({
    annual_revenue: sizeRanges(AX_COMPANY_SIZE_OPTIONS.annual_revenue),
    employees: sizeRanges(AX_COMPANY_SIZE_OPTIONS.employees),
    sites: sizeRanges(AX_COMPANY_SIZE_OPTIONS.sites),
  })
  .default(emptyAxTargetCompany()) satisfies z.ZodType<AxTargetCompany, z.ZodTypeDef, unknown>;

export const axPlaybookContentSchema = z.object({
  challenges: z.object({
    people: axPlaybookChallengeGuideSchema,
    cost: axPlaybookChallengeGuideSchema,
    agility: axPlaybookChallengeGuideSchema,
    data: axPlaybookChallengeGuideSchema,
  }),
  /** Basic facts to confirm first (system, years in use, scope, upkeep) */
  basicChecks: textList,
  objections: z.array(axPlaybookObjectionSchema).max(AX_PLAYBOOK_LIMITS.itemsMax),
  ngPhrases: z.array(axPlaybookNgPhraseSchema).max(AX_PLAYBOOK_LIMITS.itemsMax),
  /** Topics not to answer on the spot, and who to pass them to */
  escalations: z.array(axPlaybookEscalationSchema).max(AX_PLAYBOOK_LIMITS.itemsMax),
  /** Rows saved before #150 have no target and read as "no condition" */
  targetCompany: axTargetCompanySchema,
  /**
   * What to say when no date was agreed (#157): "we will contact you by {date}". {date} is
   * replaced on the lead page; empty uses the default wording.
   */
  scheduleFollowUp: text.default(''),
});

export type AxPlaybookChallengeGuide = z.infer<typeof axPlaybookChallengeGuideSchema>;
export type AxPlaybookContent = z.infer<typeof axPlaybookContentSchema>;

export const getAxPlaybookSchema = z.object({
  organizationId: z.string().uuid(),
});

export const updateAxPlaybookSchema = z.object({
  organizationId: z.string().uuid(),
  content: axPlaybookContentSchema,
});

export const updateAxTargetCompanySchema = z.object({
  organizationId: z.string().uuid(),
  targetCompany: axTargetCompanySchema,
});

export function emptyAxPlaybookContent(): AxPlaybookContent {
  const guide = (): AxPlaybookChallengeGuide => ({ effect: '', questions: [], signals: [] });
  return {
    challenges: { people: guide(), cost: guide(), agility: guide(), data: guide() },
    basicChecks: [],
    objections: [],
    ngPhrases: [],
    escalations: [],
    targetCompany: emptyAxTargetCompany(),
    scheduleFollowUp: '',
  };
}
