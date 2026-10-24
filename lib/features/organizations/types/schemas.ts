import { z } from 'zod';

/**
 * Get organization by ID schema
 */
export const getOrganizationSchema = z.object({
  id: z.string().uuid(),
});
export type GetOrganizationInput = z.infer<typeof getOrganizationSchema>;

/**
 * List user's organizations schema
 */
export const listOrganizationsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
});
export type ListOrganizationsInput = z.infer<typeof listOrganizationsSchema>;

/**
 * Update organization schema: the name and the slug only.
 *
 * `settings` is not accepted (#483). Features keep their own keys in organizations.settings
 * (leadIntakeUserIds, leadHandoffUserIds, actTiming, hearingCatalog, axInfoOffers) and each
 * merges only its key in SQL; replacing the whole object here would erase them all. A settings
 * field sent anyway is stripped by zod. When a caller needs one, add it key by key with a merge.
 */
export const updateOrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/**
 * Create organization schema
 */
export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/),
  settings: z.record(z.unknown()).default({}).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
