import { AX_CHECKPOINT_KEYS } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { z } from 'zod';

/** Delivery review of a won deal (Refs #159) */

/** How a diagnosis checkpoint turned out in the deal */
export const CHECKPOINT_OUTCOMES = ['hard', 'as_expected', 'not_relevant'] as const;
export const checkpointOutcomeEnum = z.enum(CHECKPOINT_OUTCOMES);
export type CheckpointOutcome = z.infer<typeof checkpointOutcomeEnum>;

/** Same levels as the AX diagnosis difficulty */
export const DIFFICULTY_LEVELS = ['low', 'medium', 'high'] as const;
export const difficultyLevelEnum = z.enum(DIFFICULTY_LEVELS);
export type DifficultyLevel = z.infer<typeof difficultyLevelEnum>;

export const REVIEW_LIMITS = { effort: 99_999.9, note: 4000 } as const;

const effort = z
  .number()
  .min(0)
  .max(REVIEW_LIMITS.effort)
  .transform((value) => Math.round(value * 10) / 10)
  .nullable()
  .default(null);

export const deliveryReviewFieldsSchema = z.object({
  /** Diagnosis checkpoints, flagged or not, and how each turned out */
  checkpointOutcomes: z.record(z.enum(AX_CHECKPOINT_KEYS), checkpointOutcomeEnum).default({}),
  actualDifficulty: difficultyLevelEnum.nullable().default(null),
  estimatedEffort: effort,
  actualEffort: effort,
  note: z
    .string()
    .trim()
    .max(REVIEW_LIMITS.note)
    .transform((value) => value || null)
    .nullable()
    .default(null),
});
export type DeliveryReviewFields = z.infer<typeof deliveryReviewFieldsSchema>;

export const leadScopeSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const saveDeliveryReviewSchema = leadScopeSchema.extend({
  review: deliveryReviewFieldsSchema,
});

export const deliveryReportSchema = z.object({ organizationId: z.string().uuid() });
