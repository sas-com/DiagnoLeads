import { isoDateSchema } from '@/lib/features/lead-hearings/types/schemas';
import { targetSystemEnum } from '@/lib/features/leads/types/pipeline';
import { z } from 'zod';
import { dealKindEnum, dealLostReasonEnum, dealStageEnum, forecastOverrideEnum } from './pipeline';

/** Input of the deals API (Refs #435) */

export const DEAL_LIMITS = {
  name: 200,
  nextStep: 300,
  lostNote: 2000,
  competitor: 200,
  /** One trillion yen: far above any deal, low enough to stay exact in JavaScript */
  amount: 1_000_000_000_000,
} as const;

/** Most open deals the board returns; more are counted but not listed */
export const BOARD_DEALS_LIMIT = 500;
/** Won and lost deals stay on the board for this many days after they closed */
export const BOARD_CLOSED_DAYS_DEFAULT = 30;
/** History rows returned with a deal */
export const DEAL_HISTORY_LIMIT = 100;

const organizationId = z.string().uuid();
const id = z.string().uuid();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish();

/**
 * A deal's dates: a real date from 2000 to 2100, like the target months. PostgreSQL has no year
 * 0, so '0000-01-01' would otherwise fail in the database instead of the input check.
 */
const dealDate = isoDateSchema.refine(
  (value) => /^(20\d{2}|2100)-/.test(value),
  'A date from 2000 to 2100'
);

const amount = z.number().int().min(0).max(DEAL_LIMITS.amount).nullish();
const probability = z.number().int().min(0).max(100);

const dealFields = {
  name: z.string().trim().min(1).max(DEAL_LIMITS.name),
  kind: dealKindEnum,
  stage: dealStageEnum,
  amount,
  probability,
  forecastOverride: forecastOverrideEnum.nullish(),
  expectedCloseOn: dealDate.nullish(),
  lostReason: dealLostReasonEnum.nullish(),
  lostNote: optionalText(DEAL_LIMITS.lostNote),
  competitor: optionalText(DEAL_LIMITS.competitor),
  targetSystem: targetSystemEnum.nullish(),
  nextStep: optionalText(DEAL_LIMITS.nextStep),
  ownerUserId: id.nullish(),
  previousDealId: id.nullish(),
};

export const createDealSchema = z.object({
  organizationId,
  leadId: id,
  ...dealFields,
  kind: dealFields.kind.default('survey'),
  stage: dealFields.stage.default('qualification'),
  probability: dealFields.probability.optional(),
});
export type CreateDealInput = z.infer<typeof createDealSchema>;

/** Only the fields sent are changed; null clears an optional field */
export const updateDealSchema = z.object({
  organizationId,
  dealId: id,
  name: dealFields.name.optional(),
  kind: dealFields.kind.optional(),
  stage: dealFields.stage.optional(),
  amount,
  probability: probability.optional(),
  forecastOverride: dealFields.forecastOverride,
  expectedCloseOn: dealFields.expectedCloseOn,
  closedOn: dealDate.optional(),
  lostReason: dealFields.lostReason,
  lostNote: dealFields.lostNote,
  competitor: dealFields.competitor,
  targetSystem: dealFields.targetSystem,
  nextStep: dealFields.nextStep,
  ownerUserId: dealFields.ownerUserId,
  previousDealId: dealFields.previousDealId,
});
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

export const dealScopeSchema = z.object({ organizationId, dealId: id });
export const leadDealsSchema = z.object({ organizationId, leadId: id });

/** Whose deals the board shows: the user's own, everyone's, or one member's */
export const boardOwnerSchema = z.union([z.enum(['mine', 'all']), id]);
export type BoardOwner = z.infer<typeof boardOwnerSchema>;

export const boardSchema = z
  .object({
    organizationId,
    owner: boardOwnerSchema.default('all'),
    kinds: z.array(dealKindEnum).max(10).optional(),
    /** Expected close date range of the open deals (inclusive) */
    closeFrom: dealDate.optional(),
    closeTo: dealDate.optional(),
    closedWithinDays: z.number().int().min(0).max(366).default(BOARD_CLOSED_DAYS_DEFAULT),
  })
  .refine((input) => !input.closeFrom || !input.closeTo || input.closeFrom <= input.closeTo, {
    message: 'closeFrom must not be after closeTo',
    path: ['closeTo'],
  });
export type BoardInput = z.infer<typeof boardSchema>;
