import crypto from 'node:crypto';
import { getAuthenticatedOrganization } from '@/lib/api/v2-auth';
/**
 * REST API v2 - Webhooks Endpoint
 *
 * GET /api/v2/webhooks - List webhooks
 * POST /api/v2/webhooks - Create a webhook
 */
import { db } from '@/lib/db';
import { type WebhookEventType, auditLogs, webhooks } from '@/lib/db/schema';
import {
  PERSONAL_DATA_CONFIRMATION_REQUIRED,
  personalDataConfirmationAudit,
  personalDataConfirmationRequired,
} from '@/lib/features/webhooks/types/personal-data';

import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// TODO(#314): this REST API has no role check yet and returns stored header values as-is (the
// tRPC router masks them with maskWebhookHeaders). Add both with the PR that enables API keys;
// v2 authentication always fails until then.

// ============================================================================
// Schemas
// ============================================================================

const webhookEventSchema = z.enum([
  'lead.created',
  'lead.updated',
  'lead.deleted',
  'lead.status_changed',
  'lead.scored',
  'diagnostic.submitted',
  'diagnostic.completed',
  'organization.member_added',
  'organization.member_removed',
  'blog.published',
  'blog.updated',
]);

const createWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(webhookEventSchema).min(1),
  secret: z.string().min(16).max(64).optional(),
  status: z.enum(['active', 'inactive', 'failed']).default('active'),
  headers: z.record(z.string()).optional(),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryDelayMs: z.number().int().min(1000).max(30000).default(5000),
  // The caller confirms that lead personal data is sent to this URL (#917)
  personalDataConfirmed: z.boolean().optional(),
});

// ============================================================================
// Handlers
// ============================================================================

/**
 * GET /api/v2/webhooks
 * List webhooks
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuthenticatedOrganization();
    if (!authResult) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const results = await db.query.webhooks.findMany({
      where: eq(webhooks.organizationId, authResult.organizationId),
      orderBy: [desc(webhooks.createdAt)],
      columns: {
        id: true,
        name: true,
        url: true,
        events: true,
        status: true,
        headers: true,
        retryConfig: true,
        lastTriggeredAt: true,
        failureCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      data: results.map((w) => ({
        ...w,
        hasSecret: true, // Don't expose the secret itself
      })),
    });
  } catch (error) {
    console.error('Error listing webhooks:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch webhooks' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v2/webhooks
 * Create a new webhook
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuthenticatedOrganization();
    if (!authResult) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsedBody = createWebhookSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          message: 'Invalid request body',
          details: parsedBody.error.format(),
        },
        { status: 400 }
      );
    }

    const {
      name,
      url,
      events,
      secret,
      status,
      headers: customHeaders,
      maxRetries,
      retryDelayMs,
      personalDataConfirmed,
    } = parsedBody.data;

    const confirmationRequired = personalDataConfirmationRequired({ events });
    if (confirmationRequired && personalDataConfirmed !== true) {
      return NextResponse.json(
        { error: 'Bad Request', message: PERSONAL_DATA_CONFIRMATION_REQUIRED },
        { status: 400 }
      );
    }

    // Generate secret if not provided
    const webhookSecret = secret ?? crypto.randomBytes(32).toString('hex');

    const webhook = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(webhooks)
        .values({
          organizationId: authResult.organizationId,
          name,
          url,
          events: events as WebhookEventType[],
          secret: webhookSecret,
          status,
          headers: customHeaders ?? {},
          retryConfig: {
            maxRetries,
            retryDelayMs,
          },
        })
        .returning();
      if (confirmationRequired) {
        await tx.insert(auditLogs).values(
          personalDataConfirmationAudit({
            organizationId: authResult.organizationId,
            userId: authResult.userId,
            action: 'create',
            webhookId: created.id,
            events,
          })
        );
      }
      return created;
    });

    return NextResponse.json(
      {
        data: {
          ...webhook,
          // Only return secret on creation
          secret: webhookSecret,
        },
        message: 'Webhook created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating webhook:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to create webhook' },
      { status: 500 }
    );
  }
}
