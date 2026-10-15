/**
 * AX sales playbook schemas
 *
 * The playbook (talk script) used by sales and partners in AX migration meetings. Its text is
 * confidential and this repository is public, so only the shape lives in code; each
 * organization enters the content from the settings screen (Refs #74).
 */

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

export const axPlaybookObjectionSchema = z.object({
  customer: requiredText,
  response: requiredText,
  note: text,
});

export const axPlaybookNgPhraseSchema = z.object({
  ng: requiredText,
  alternative: requiredText,
});

export const axPlaybookEscalationSchema = z.object({
  topic: requiredText,
  contact: requiredText,
});

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

export function emptyAxPlaybookContent(): AxPlaybookContent {
  const guide = (): AxPlaybookChallengeGuide => ({ effect: '', questions: [], signals: [] });
  return {
    challenges: { people: guide(), cost: guide(), agility: guide(), data: guide() },
    basicChecks: [],
    objections: [],
    ngPhrases: [],
    escalations: [],
  };
}
