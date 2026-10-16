/**
 * Input schemas of the diagnoses router (Refs #114)
 */
import { z } from 'zod';
import { diagnosisDefinitionSchema } from '../definition';

const organizationId = z.string().uuid();
const id = z.string().uuid();

/** Lower-case letters, digits and single hyphens; used in the public URL */
export const DIAGNOSIS_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const diagnosisSlugSchema = z.string().min(3).max(60).regex(DIAGNOSIS_SLUG_PATTERN);
export const diagnosisNameSchema = z.string().trim().min(1).max(200);

export const listDiagnosesSchema = z.object({ organizationId }).strict();

export const diagnosisByIdSchema = z.object({ organizationId, id }).strict();

export const createDiagnosisSchema = z
  .object({ organizationId, name: diagnosisNameSchema, slug: diagnosisSlugSchema })
  .strict();

export const saveDiagnosisDraftSchema = z
  .object({
    organizationId,
    id,
    name: diagnosisNameSchema.optional(),
    /** Replaces the whole draft; may still have errors (shown by validate) */
    definition: diagnosisDefinitionSchema,
    /** updatedAt the client last read; a newer row means someone else saved meanwhile */
    expectedUpdatedAt: z.date(),
  })
  .strict();

export const publishDiagnosisSchema = z
  .object({
    organizationId,
    id,
    /** The draft the person reviewed; publishing fails with CONFLICT when it changed since */
    expectedUpdatedAt: z.date(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateDiagnosisInput = z.infer<typeof createDiagnosisSchema>;
export type SaveDiagnosisDraftInput = z.infer<typeof saveDiagnosisDraftSchema>;
export type PublishDiagnosisInput = z.infer<typeof publishDiagnosisSchema>;
