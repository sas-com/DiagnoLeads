import { PLAIN_TEXT } from '@/lib/utils/plain-text';
import { z } from 'zod';
import { aiEmployeeProfilePatchSchema } from './profile';
import { AI_EMPLOYEE_ROLES } from './roles';

/** Inputs of the AI employee office (Refs #1101) */

export const AI_EMPLOYEE_STATUSES = ['active', 'paused'] as const;
export type AiEmployeeStatus = (typeof AI_EMPLOYEE_STATUSES)[number];

export const AI_EMPLOYEE_RUN_TRIGGERS = ['schedule', 'manual'] as const;
export type AiEmployeeRunTrigger = (typeof AI_EMPLOYEE_RUN_TRIGGERS)[number];

export const AI_EMPLOYEE_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;
export type AiEmployeeRunStatus = (typeof AI_EMPLOYEE_RUN_STATUSES)[number];

export const AI_EMPLOYEE_NAME_MAX_LENGTH = 40;
/** Runs listed for one employee */
export const AI_EMPLOYEE_RUNS_LIMIT = 20;

export const aiEmployeeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(AI_EMPLOYEE_NAME_MAX_LENGTH)
  .regex(PLAIN_TEXT);

export const officeScopeSchema = z.object({
  organizationId: z.string().uuid(),
});

export const employeeScopeSchema = officeScopeSchema.extend({
  employeeId: z.string().uuid(),
});

export const hireAiEmployeeSchema = officeScopeSchema.extend({
  role: z.enum(AI_EMPLOYEE_ROLES),
  name: aiEmployeeNameSchema,
});

/** At least one of name, status and profile (the router refuses an update with none) */
export const updateAiEmployeeSchema = employeeScopeSchema.extend({
  name: aiEmployeeNameSchema.optional(),
  status: z.enum(AI_EMPLOYEE_STATUSES).optional(),
  /** The parts of the profile to replace (#1134) */
  profile: aiEmployeeProfilePatchSchema.optional(),
});
