import { z } from 'zod';

/**
 * Embed Config Schemas
 */
export const createEmbedConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  allowedOrigins: z
    .array(
      z
        .string()
        .url()
        .or(z.string().regex(/^https?:\/\/\*\.[a-zA-Z0-9.-]+$/))
    )
    .min(1, 'At least one allowed origin is required'),
  rateLimitPerMinute: z.number().int().min(1).max(1000).default(60),
  rateLimitPerDay: z.number().int().min(1).max(100000).default(10000),
  diagnosticTemplateId: z.string().uuid().optional(),
  themeOverrides: z
    .object({
      primaryColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      backgroundColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      textColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      borderRadius: z.enum(['none', 'sm', 'md', 'lg', 'xl', 'full']).optional(),
    })
    .optional(),
  customCss: z.string().max(10000).optional(),
  leadSource: z.string().min(1).max(50).default('embed'),
  expiresAt: z.string().datetime().optional(),
});

export const updateEmbedConfigSchema = createEmbedConfigSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateEmbedConfigInput = z.infer<typeof createEmbedConfigSchema>;
export type UpdateEmbedConfigInput = z.infer<typeof updateEmbedConfigSchema>;
