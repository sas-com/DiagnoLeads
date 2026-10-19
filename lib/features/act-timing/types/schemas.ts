import { z } from 'zod';

/**
 * "When to act" of a lead (Refs #151): the month to start talking again so the migration can
 * finish before the hardware support ends or the person who keeps the system retires, moved to
 * the budget planning before the fiscal year end when known.
 */

/** Organization settings (organizations.settings.actTiming) */
export const actTimingSettingsSchema = z.object({
  /** Months a migration takes: the start is this many months before the deadline */
  migrationMonths: z.number().int().min(1).max(60).default(12),
  /** Months before "when to act" the assignee is told (a next action due then) */
  noticeMonths: z.number().int().min(0).max(12).default(3),
});
export type ActTimingSettings = z.infer<typeof actTimingSettingsSchema>;

export const DEFAULT_ACT_TIMING_SETTINGS: ActTimingSettings = actTimingSettingsSchema.parse({});

/** Budgets for the next fiscal year are planned this many months before the fiscal year end */
export const BUDGET_PLANNING_MONTHS_BEFORE_FY_END = 3;

/** Read the settings stored in organizations.settings, falling back to the defaults */
export function readActTimingSettings(settings: unknown): ActTimingSettings {
  const value =
    typeof settings === 'object' && settings !== null
      ? (settings as Record<string, unknown>).actTiming
      : undefined;
  const parsed = actTimingSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_ACT_TIMING_SETTINGS;
}

export const leadScopeSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const updateActTimingSettingsSchema = z.object({
  organizationId: z.string().uuid(),
  settings: actTimingSettingsSchema,
});

/** List filter (#151): "when to act" within the next 6 months (or past), or set at all */
export const ACT_TIMING_FILTERS = ['soon', 'has'] as const;
export const actTimingFilterEnum = z.enum(ACT_TIMING_FILTERS);
export type ActTimingFilter = z.infer<typeof actTimingFilterEnum>;
export const ACT_TIMING_SOON_MONTHS = 6;
