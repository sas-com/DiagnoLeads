import { DEAL_LIMITS } from '@/lib/features/deals/types/schemas';
import { z } from 'zod';
import { fiscalYearStartMonthSchema } from '../fiscal-year';

/** Input of the sales targets API (Refs #437) */

/** 'YYYY-MM-01': the first day of a month */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, 'A month is the first day of the month (YYYY-MM-01)');

/** Targets saved in one call: a month for the organization and every member is far below */
export const TARGET_ENTRIES_MAX = 200;

const organizationId = z.string().uuid();

export const targetsQuerySchema = z.object({
  organizationId,
  /** The fiscal year, named by the year it starts in; the current one when left out */
  fiscalYear: z.number().int().min(2000).max(2100).optional(),
});

export const saveTargetsSchema = z.object({
  organizationId,
  entries: z
    .array(
      z.object({
        /** null: the organization as a whole */
        userId: z.string().uuid().nullable(),
        month: monthSchema,
        /** null removes the target */
        amount: z.number().int().min(0).max(DEAL_LIMITS.amount).nullable(),
      })
    )
    .min(1)
    .max(TARGET_ENTRIES_MAX),
});
export type SaveTargetsInput = z.infer<typeof saveTargetsSchema>;

export const fiscalYearStartSchema = z.object({
  organizationId,
  month: fiscalYearStartMonthSchema,
});
