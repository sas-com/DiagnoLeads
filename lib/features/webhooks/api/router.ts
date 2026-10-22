/**
 * Webhooks tRPC Router
 *
 * Phase 5.1: Webhook基盤
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { type Webhook, webhookDeliveries, webhooks } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  type MergeWebhookHeadersResult,
  type WebhookHeadersError,
  buildWebhookHeaders,
  isUrlChanged,
  maskWebhookHeaders,
  mergeWebhookHeaders,
} from '../services/webhook-headers';
import { generateWebhookSecret, sendWebhookDelivery } from '../services/webhook-service';
import {
  createWebhookSchema,
  listDeliveriesSchema,
  listWebhooksSchema,
  testWebhookSchema,
  updateWebhookSchema,
  webhookEventTypes,
} from '../types/schemas';

/**
 * A webhook as returned to a browser: header values are never returned, to anyone (#314);
 * the secret is masked except right after it is created or regenerated
 */
function toClientWebhook(webhook: Webhook, { fullSecret = false }: { fullSecret?: boolean } = {}) {
  return {
    ...webhook,
    secret: fullSecret ? webhook.secret : maskSecret(webhook.secret),
    headers: maskWebhookHeaders(webhook.headers),
  };
}

const HEADER_ERROR_MESSAGES: Record<WebhookHeadersError, (name: string) => string> = {
  duplicate_name: (name) => `duplicate_name: header "${name}" is given more than once`,
  missing_value: (name) => `missing_value: header "${name}" needs a value`,
  headers_reentry_required: () =>
    'headers_reentry_required: the URL changes, so enter every header value again or remove the headers',
};

/**
 * The header map to store, or BAD_REQUEST. The message starts with a fixed code
 * (e.g. `headers_reentry_required`) the client can match.
 */
function headersOrThrow(result: MergeWebhookHeadersResult): Record<string, string> {
  if (!result.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: HEADER_ERROR_MESSAGES[result.reason](result.name),
    });
  }
  return result.headers;
}

/** What the current user may do, so the settings page shows only the buttons they can use */
const permissionsOf = (ability: AppAbility) => ({
  canCreate: ability.can('create', 'Webhook'),
  canUpdate: ability.can('update', 'Webhook'),
  canDelete: ability.can('delete', 'Webhook'),
});

export const webhooksRouter = router({
  /**
   * List webhooks for the organization
   */
  list: organizationProcedure.input(listWebhooksSchema).query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Webhook')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to view webhooks',
      });
    }

    const { status, limit, offset } = input;

    const conditions = [eq(webhooks.organizationId, ctx.organization.id)];
    if (status) {
      conditions.push(eq(webhooks.status, status));
    }

    const results = await ctx.db
      .select()
      .from(webhooks)
      .where(and(...conditions))
      .orderBy(desc(webhooks.createdAt))
      .limit(limit)
      .offset(offset);

    // Count total
    const countResult = await ctx.db
      .select()
      .from(webhooks)
      .where(and(...conditions));

    return {
      webhooks: results.map((w) => toClientWebhook(w)),
      total: countResult.length,
      limit,
      offset,
      permissions: permissionsOf(ctx.ability),
    };
  }),

  /**
   * Get a single webhook by ID
   */
  get: organizationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.ability.can('read', 'Webhook')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to view webhooks',
        });
      }

      const webhook = await ctx.db
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.organizationId, ctx.organization.id)))
        .limit(1);

      if (!webhook[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Webhook not found',
        });
      }

      return toClientWebhook(webhook[0]);
    }),

  /**
   * Create a new webhook
   */
  create: organizationProcedure.input(createWebhookSchema).mutation(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('create', 'Webhook')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to create webhooks',
      });
    }

    const headers = headersOrThrow(buildWebhookHeaders(input.headers ?? []));
    const secret = generateWebhookSecret();

    const [webhook] = await ctx.db
      .insert(webhooks)
      .values({
        organizationId: ctx.organization.id,
        name: input.name,
        url: input.url,
        secret,
        events: input.events,
        headers,
        retryConfig: input.retryConfig || { maxRetries: 3, retryDelayMs: 5000 },
      })
      .returning();

    // Return the full secret only on creation
    return toClientWebhook(webhook, { fullSecret: true });
  }),

  /**
   * Update a webhook
   */
  update: organizationProcedure.input(updateWebhookSchema).mutation(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('update', 'Webhook')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to update webhooks',
      });
    }

    // Verify ownership
    const existing = await ctx.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, input.id), eq(webhooks.organizationId, ctx.organization.id)))
      .limit(1);

    if (!existing[0]) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Webhook not found',
      });
    }

    const updateData: Partial<typeof webhooks.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.name) updateData.name = input.name;
    if (input.url) updateData.url = input.url;
    if (input.events) updateData.events = input.events;
    if (input.status) updateData.status = input.status;
    // Stored header values (often the receiver's credentials) must not follow the webhook to
    // another receiver, nor to another path of a shared one: when the URL changes at all, every
    // value must be entered again. Sending the same URL again (or none) keeps them.
    const urlChanged = input.url !== undefined && isUrlChanged(existing[0].url, input.url);
    if (input.headers) {
      updateData.headers = headersOrThrow(
        mergeWebhookHeaders(existing[0].headers, input.headers, {
          requireNewValues: urlChanged,
        })
      );
    } else if (urlChanged && Object.keys(existing[0].headers ?? {}).length > 0) {
      headersOrThrow({ ok: false, reason: 'headers_reentry_required', name: '' });
    }
    if (input.retryConfig) updateData.retryConfig = input.retryConfig;

    // Written only if the URL and headers are still those read above: the checks and the merge
    // were made against them, so a change in between (e.g. another tab moving the URL) must not
    // be overwritten with values kept for the old URL. Compared on these columns rather than
    // updated_at, which deliveries also move and which is stored with more precision than a
    // JavaScript Date holds.
    const [updated] = await ctx.db
      .update(webhooks)
      .set(updateData)
      .where(
        and(
          eq(webhooks.id, input.id),
          eq(webhooks.organizationId, ctx.organization.id),
          eq(webhooks.url, existing[0].url),
          existing[0].headers === null
            ? isNull(webhooks.headers)
            : eq(webhooks.headers, existing[0].headers)
        )
      )
      .returning();

    if (!updated) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'conflict: the webhook was changed meanwhile; reload it and save again',
      });
    }

    return toClientWebhook(updated);
  }),

  /**
   * Delete a webhook
   */
  delete: organizationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('delete', 'Webhook')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to delete webhooks',
        });
      }

      // Verify ownership
      const existing = await ctx.db
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.organizationId, ctx.organization.id)))
        .limit(1);

      if (!existing[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Webhook not found',
        });
      }

      await ctx.db
        .delete(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.organizationId, ctx.organization.id)));

      return { success: true };
    }),

  /**
   * Regenerate webhook secret
   */
  regenerateSecret: organizationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('update', 'Webhook')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to update webhooks',
        });
      }

      // Verify ownership
      const existing = await ctx.db
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.organizationId, ctx.organization.id)))
        .limit(1);

      if (!existing[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Webhook not found',
        });
      }

      const newSecret = generateWebhookSecret();

      const [updated] = await ctx.db
        .update(webhooks)
        .set({
          secret: newSecret,
          updatedAt: new Date(),
        })
        .where(and(eq(webhooks.id, input.id), eq(webhooks.organizationId, ctx.organization.id)))
        .returning();

      // Return full secret on regeneration
      return toClientWebhook(updated, { fullSecret: true });
    }),

  /**
   * Test a webhook by sending a test event
   */
  test: organizationProcedure.input(testWebhookSchema).mutation(async ({ ctx, input }) => {
    // Sending is a change on the receiving side, so it takes the right to update
    if (!ctx.ability.can('update', 'Webhook')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to test webhooks',
      });
    }

    // Verify ownership
    const existing = await ctx.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, input.id), eq(webhooks.organizationId, ctx.organization.id)))
      .limit(1);

    if (!existing[0]) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Webhook not found',
      });
    }

    // Trigger a test event
    const testData = {
      test: true,
      message: 'This is a test webhook from DiagnoLeads',
      timestamp: new Date().toISOString(),
    };

    // Use the first subscribed event type for testing
    const eventType = existing[0].events[0] || 'lead.created';

    // To this webhook only: other webhooks subscribed to the event must not get test data (#314)
    const { success } = await sendWebhookDelivery(existing[0], eventType, testData, {
      database: ctx.db,
    });

    return {
      success,
      triggered: success ? 1 : 0,
      failed: success ? 0 : 1,
    };
  }),

  /**
   * List webhook deliveries
   */
  deliveries: organizationProcedure.input(listDeliveriesSchema).query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Webhook')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to view webhook deliveries',
      });
    }

    const { webhookId, status, limit, offset } = input;

    // One where() with every condition: a second where() call replaces the first, which would
    // drop the organization scope
    const conditions = [eq(webhooks.organizationId, ctx.organization.id)];
    if (webhookId) {
      conditions.push(eq(webhookDeliveries.webhookId, webhookId));
    }
    if (status) {
      conditions.push(eq(webhookDeliveries.status, status));
    }

    const results = await ctx.db
      .select({
        delivery: webhookDeliveries,
        webhookName: webhooks.name,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit)
      .offset(offset);

    // The receiver's response body and the error text (which can tell about the receiver's
    // internals) only go to those who manage webhooks; members see the outcome (status,
    // status code, attempts, times) only (#314)
    const canViewDetails = ctx.ability.can('update', 'Webhook');

    return {
      deliveries: results.map((r) => ({
        ...r.delivery,
        response: canViewDetails ? r.delivery.response : null,
        error: canViewDetails ? r.delivery.error : null,
        webhookName: r.webhookName,
      })),
      canViewDetails,
      limit,
      offset,
    };
  }),

  /**
   * Get available webhook event types
   */
  eventTypes: organizationProcedure.query(() => {
    return webhookEventTypes.map((type) => ({
      type,
      category: type.split('.')[0],
      action: type.split('.')[1],
    }));
  }),
});

/**
 * Mask webhook secret for display
 */
function maskSecret(secret: string): string {
  if (secret.length <= 12) {
    return '••••••••••••';
  }
  return `${secret.slice(0, 8)}••••••••${secret.slice(-4)}`;
}
