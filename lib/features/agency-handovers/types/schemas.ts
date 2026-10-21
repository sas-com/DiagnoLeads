import { z } from 'zod';

/** Handover from the sales agency when it set up the meeting (Refs #152) */

export const DECISION_MAKER_VALUES = ['yes', 'no', 'unknown'] as const;
export const INTEREST_LEVELS = ['high', 'medium', 'low'] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

export const HANDOVER_LIMITS = { rows: 500, text: 200, longText: 2000 } as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .default(null);

/** One row as sent to the server, after the browser read the file and mapped the columns */
export const handoverRowSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().nullable().default(null),
    company: text(HANDOVER_LIMITS.text),
    agencyName: text(HANDOVER_LIMITS.text),
    appointmentOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    contactName: text(HANDOVER_LIMITS.text),
    contactTitle: text(HANDOVER_LIMITS.text),
    contactPhone: text(50),
    machineModel: text(HANDOVER_LIMITS.text),
    machineModelConfirmed: z.boolean().nullable().default(null),
    hardwareSupportEnd: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .nullable()
      .default(null),
    retirementPlan: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .nullable()
      .default(null),
    decisionMakerPresent: z.enum(DECISION_MAKER_VALUES).nullable().default(null),
    interestLevel: z.enum(INTEREST_LEVELS).nullable().default(null),
    refusalReason: text(HANDOVER_LIMITS.longText),
    note: text(HANDOVER_LIMITS.longText),
  })
  .refine((row) => row.email !== null || row.company !== null, {
    message: 'An email address or a company name is needed to find the lead',
  });
export type HandoverRow = z.infer<typeof handoverRowSchema>;

export const importHandoversSchema = z.object({
  organizationId: z.string().uuid(),
  rows: z.array(z.unknown()).min(1).max(HANDOVER_LIMITS.rows),
});

export const leadScopeSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});
