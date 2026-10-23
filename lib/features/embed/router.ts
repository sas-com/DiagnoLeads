import { db } from '@/lib/db';
import { embedAccessLogs, embedConfigs } from '@/lib/db/schema';
import { assertInOrganization } from '@/lib/multi-tenant/helpers/scope';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { generateApiKey, hashApiKey } from './security';
import { createEmbedConfigSchema, updateEmbedConfigSchema } from './types';

/**
 * Who may use this router (#356): anyone who can read leads may see the embed configs; creating,
 * changing and deleting them is for those who can update settings
 */
const embedViewingProcedure = organizationProcedure.use(({ ctx, next }) => {
  if (!ctx.ability.can('read', 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view embed configs',
    });
  }
  return next();
});
const embedManagerProcedure = organizationProcedure.use(({ ctx, next }) => {
  if (!ctx.ability.can('update', 'Settings')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to manage embed configs',
    });
  }
  return next();
});

export const embedRouter = router({
  /**
   * List all embed configs for the organization
   */
  list: embedViewingProcedure.query(async ({ ctx }) => {
    const configs = await db.query.embedConfigs.findMany({
      where: eq(embedConfigs.organizationId, ctx.organization.id),
      orderBy: [desc(embedConfigs.createdAt)],
      with: {
        diagnosticTemplate: {
          columns: {
            id: true,
            name: true,
            title: true,
          },
        },
      },
    });

    // Remove sensitive data (apiKey, apiKeyHash)
    return configs.map((config) => ({
      ...config,
      apiKey: undefined,
      apiKeyHash: undefined,
      maskedApiKey: `dl_embed_****${config.apiKey.slice(-8)}`,
    }));
  }),

  /**
   * Get a single embed config by ID
   */
  get: embedViewingProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const config = await db.query.embedConfigs.findFirst({
        where: and(
          eq(embedConfigs.id, input.id),
          eq(embedConfigs.organizationId, ctx.organization.id)
        ),
        with: {
          diagnosticTemplate: true,
        },
      });

      if (!config) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Embed config not found' });
      }

      return {
        ...config,
        apiKey: undefined,
        apiKeyHash: undefined,
        maskedApiKey: `dl_embed_****${config.apiKey.slice(-8)}`,
      };
    }),

  /**
   * Create a new embed config
   * Returns the API key only once - it cannot be retrieved later
   */
  create: embedManagerProcedure.input(createEmbedConfigSchema).mutation(async ({ ctx, input }) => {
    if (input.diagnosticTemplateId) {
      await assertInOrganization(db, 'template', ctx.organization.id, input.diagnosticTemplateId);
    }
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    const [config] = await db
      .insert(embedConfigs)
      .values({
        organizationId: ctx.organization.id,
        name: input.name,
        description: input.description,
        apiKey: apiKey,
        apiKeyHash: apiKeyHash,
        allowedOrigins: input.allowedOrigins,
        rateLimitPerMinute: input.rateLimitPerMinute,
        rateLimitPerDay: input.rateLimitPerDay,
        diagnosticTemplateId: input.diagnosticTemplateId,
        themeOverrides: input.themeOverrides,
        customCss: input.customCss,
        leadSource: input.leadSource,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning();

    // Return API key only on creation - IMPORTANT: cannot be retrieved later
    return {
      ...config,
      apiKey: apiKey, // Only returned on creation
      apiKeyHash: undefined,
      warning: 'This is the only time the API key will be displayed. Please save it securely.',
    };
  }),

  /**
   * Update an existing embed config
   */
  update: embedManagerProcedure
    .input(z.object({ id: z.string().uuid(), data: updateEmbedConfigSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.embedConfigs.findFirst({
        where: and(
          eq(embedConfigs.id, input.id),
          eq(embedConfigs.organizationId, ctx.organization.id)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Embed config not found' });
      }
      if (input.data.diagnosticTemplateId) {
        await assertInOrganization(
          db,
          'template',
          ctx.organization.id,
          input.data.diagnosticTemplateId
        );
      }

      const [updated] = await db
        .update(embedConfigs)
        .set({
          ...input.data,
          expiresAt: input.data.expiresAt ? new Date(input.data.expiresAt) : undefined,
          updatedAt: new Date(),
        })
        .where(
          and(eq(embedConfigs.id, input.id), eq(embedConfigs.organizationId, ctx.organization.id))
        )
        .returning();

      return {
        ...updated,
        apiKey: undefined,
        apiKeyHash: undefined,
        maskedApiKey: `dl_embed_****${updated.apiKey.slice(-8)}`,
      };
    }),

  /**
   * Regenerate API key for an embed config
   * Returns the new API key only once
   */
  regenerateApiKey: embedManagerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.embedConfigs.findFirst({
        where: and(
          eq(embedConfigs.id, input.id),
          eq(embedConfigs.organizationId, ctx.organization.id)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Embed config not found' });
      }

      const newApiKey = generateApiKey();
      const newApiKeyHash = hashApiKey(newApiKey);

      const [updated] = await db
        .update(embedConfigs)
        .set({
          apiKey: newApiKey,
          apiKeyHash: newApiKeyHash,
          updatedAt: new Date(),
        })
        .where(
          and(eq(embedConfigs.id, input.id), eq(embedConfigs.organizationId, ctx.organization.id))
        )
        .returning();

      return {
        ...updated,
        apiKey: newApiKey, // Only returned on regeneration
        apiKeyHash: undefined,
        warning:
          'This is the only time the new API key will be displayed. Please save it securely.',
      };
    }),

  /**
   * Delete an embed config
   */
  delete: embedManagerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.embedConfigs.findFirst({
        where: and(
          eq(embedConfigs.id, input.id),
          eq(embedConfigs.organizationId, ctx.organization.id)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Embed config not found' });
      }

      await db
        .delete(embedConfigs)
        .where(
          and(eq(embedConfigs.id, input.id), eq(embedConfigs.organizationId, ctx.organization.id))
        );

      return { success: true };
    }),

  /**
   * Get access logs for an embed config
   */
  getAccessLogs: embedViewingProcedure
    .input(
      z.object({
        embedConfigId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const config = await db.query.embedConfigs.findFirst({
        where: and(
          eq(embedConfigs.id, input.embedConfigId),
          eq(embedConfigs.organizationId, ctx.organization.id)
        ),
      });

      if (!config) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Embed config not found' });
      }

      const logs = await db.query.embedAccessLogs.findMany({
        where: eq(embedAccessLogs.embedConfigId, input.embedConfigId),
        orderBy: [desc(embedAccessLogs.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      return logs;
    }),

  /**
   * Get usage statistics for an embed config
   */
  getStats: embedViewingProcedure
    .input(z.object({ embedConfigId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const config = await db.query.embedConfigs.findFirst({
        where: and(
          eq(embedConfigs.id, input.embedConfigId),
          eq(embedConfigs.organizationId, ctx.organization.id)
        ),
      });

      if (!config) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Embed config not found' });
      }

      const logs = await db.query.embedAccessLogs.findMany({
        where: eq(embedAccessLogs.embedConfigId, input.embedConfigId),
      });

      const totalRequests = logs.length;
      const successfulRequests = logs.filter(
        (l) => l.statusCode >= 200 && l.statusCode < 300
      ).length;
      const failedRequests = logs.filter((l) => l.statusCode >= 400).length;
      const leadsCreated = logs.filter((l) => l.leadId !== null).length;
      const uniqueOrigins = new Set(logs.map((l) => l.origin).filter(Boolean)).size;

      return {
        totalRequests,
        successfulRequests,
        failedRequests,
        leadsCreated,
        uniqueOrigins,
        usageCount: config.usageCount,
        lastUsedAt: config.lastUsedAt,
        isActive: config.isActive,
        expiresAt: config.expiresAt,
      };
    }),
});
