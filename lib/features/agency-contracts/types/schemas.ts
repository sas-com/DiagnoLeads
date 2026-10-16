import { z } from 'zod';

/** Contracts with sales agencies (Refs #148). Amounts are yen excluding tax. */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** No control or format characters (line breaks, bidi overrides) in names shown to sales */
const PLAIN_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;

const yen = z.number().int().min(0).max(1_000_000_000);
const day = z
  .string()
  .regex(DAY)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'invalid date');

export const agencyContractFieldsSchema = z
  .object({
    agencyName: z.string().trim().min(1).max(200).regex(PLAIN_TEXT),
    startsOn: day,
    endsOn: day.nullable(),
    initialFee: yen.default(0),
    monthlyFee: yen.default(0),
    prepayment: yen.default(0),
    feePerAppointment: yen.default(0),
    planAppointments: z.number().int().min(1).max(100_000).nullable().default(null),
    planCostPerAppointment: yen.nullable().default(null),
    note: z
      .string()
      .trim()
      .max(1000)
      .transform((value) => value || null)
      .nullable()
      .default(null),
  })
  .refine((value) => value.endsOn === null || value.endsOn >= value.startsOn, {
    message: 'The contract ends before it starts',
    path: ['endsOn'],
  });
export type AgencyContractFields = z.infer<typeof agencyContractFieldsSchema>;

const organization = { organizationId: z.string().uuid() };

export const listAgencyContractsSchema = z.object(organization);
export const agencyContractReportSchema = z.object(organization);
export const createAgencyContractSchema = z.object({
  ...organization,
  contract: agencyContractFieldsSchema,
});
export const updateAgencyContractSchema = z.object({
  ...organization,
  id: z.string().uuid(),
  contract: agencyContractFieldsSchema,
});
export const deleteAgencyContractSchema = z.object({ ...organization, id: z.string().uuid() });
