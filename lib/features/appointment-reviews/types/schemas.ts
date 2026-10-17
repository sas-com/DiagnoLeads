import { z } from 'zod';

/** Whether an appointment from a sales agency met the agreed conditions (Refs #149) */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** No control or format characters (line breaks, bidi overrides) in labels shown to sales */
const PLAIN_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;

export const APPOINTMENT_CLAIMS = ['return', 'retake'] as const;
export type AppointmentClaim = (typeof APPOINTMENT_CLAIMS)[number];

/** One condition of a contract, as shown to sales */
export const criterionLabelSchema = z.string().trim().min(1).max(100).regex(PLAIN_TEXT);
export const MAX_CRITERIA = 10;

export const appointmentCriteriaSchema = z
  .array(criterionLabelSchema)
  .max(MAX_CRITERIA)
  .refine((labels) => new Set(labels).size === labels.length, 'Duplicate condition');

export const leadScopeSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const saveAppointmentReviewSchema = leadScopeSchema.extend({
  meetingOn: z
    .string()
    .regex(DAY)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'invalid date'),
  checks: z
    .array(z.object({ label: criterionLabelSchema, met: z.boolean() }))
    .min(1)
    .max(MAX_CRITERIA),
  defectReason: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => value || null)
    .nullable()
    .default(null),
  claim: z.enum(APPOINTMENT_CLAIMS).nullable().default(null),
});
export type SaveAppointmentReviewInput = z.infer<typeof saveAppointmentReviewSchema>;
