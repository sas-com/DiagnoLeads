import { z } from 'zod';

/** Pre-meeting prep card of a lead (Refs #156) */

/** Same keys as the AX diagnosis challenges (ChallengeType) */
export const PREP_CHALLENGES = ['people', 'cost', 'agility', 'data'] as const;
export type PrepChallenge = (typeof PREP_CHALLENGES)[number];

export const PREP_LIMITS = {
  estimatedSystem: 200,
  basis: 1000,
  recentNews: 2000,
  hypothesis: 1000,
  question: 300,
  questions: 3,
} as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .default(null);

export const prepCardFieldsSchema = z.object({
  estimatedSystem: text(PREP_LIMITS.estimatedSystem),
  estimatedSystemBasis: text(PREP_LIMITS.basis),
  recentNews: text(PREP_LIMITS.recentNews),
  hypotheses: z
    .object(
      Object.fromEntries(
        PREP_CHALLENGES.map((key) => [key, text(PREP_LIMITS.hypothesis)])
      ) as Record<PrepChallenge, ReturnType<typeof text>>
    )
    .partial()
    .default({})
    // Empty hypotheses are not stored
    .transform(
      (value) =>
        Object.fromEntries(
          Object.entries(value).filter(([, hypothesis]) => typeof hypothesis === 'string')
        ) as Partial<Record<PrepChallenge, string>>
    ),
  firstQuestions: z
    .array(z.string().trim().max(PREP_LIMITS.question))
    .max(PREP_LIMITS.questions)
    .default([])
    .transform((list) => list.filter(Boolean)),
});
export type PrepCardFields = z.infer<typeof prepCardFieldsSchema>;

export const leadScopeSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const savePrepCardSchema = leadScopeSchema.extend({ card: prepCardFieldsSchema });
