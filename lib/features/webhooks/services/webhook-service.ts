/**
 * Webhook Service
 *
 * Phase 5.1: Webhook基盤
 * Handles webhook delivery, retry logic, and signature generation
 */

import crypto from 'node:crypto';
import { type Database, db } from '@/lib/db/client';
import {
  type Webhook,
  type WebhookDeliveryStatus,
  type WebhookEventType,
  type WebhookRetryConfig,
  type WebhookStatus,
  webhookDeliveries,
  webhooks,
} from '@/lib/db/schema';
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';

/**
 * Generate HMAC signature for webhook payload
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signaturePayload = `${timestamp}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

/**
 * Verify webhook signature (for incoming webhooks)
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  toleranceSeconds = 300
): boolean {
  try {
    const parts = signature.split(',');
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const signaturePart = parts.find((p) => p.startsWith('v1='));

    if (!timestampPart || !signaturePart) {
      return false;
    }

    const timestamp = Number.parseInt(timestampPart.slice(2), 10);
    const expectedSignature = signaturePart.slice(3);

    // Check timestamp tolerance
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) {
      return false;
    }

    // Verify signature
    const signaturePayload = `${timestamp}.${payload}`;
    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(signaturePayload)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(computedSignature));
  } catch {
    return false;
  }
}

/**
 * Generate a secure webhook secret
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Webhook payload structure
 */
interface WebhookPayload {
  id: string;
  event: WebhookEventType;
  timestamp: string;
  organizationId: string;
  data: Record<string, unknown>;
}

/**
 * One delivery attempt gives up after this long. Short enough that sending to several
 * endpoints in parallel after the response, or a retry batch, fits the 30s function limit.
 */
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 8000;

/**
 * A delivery whose attempt has started is not due for retry until this long after the start.
 * `next_retry_at` is set to this before sending, so an attempt cut off mid-way (the function
 * was stopped after the response) is still picked up by the retry processor afterwards.
 */
export const WEBHOOK_DELIVERY_LEASE_MS = 60_000;

/** Due retries claimed and sent (in parallel) per round */
export const WEBHOOK_RETRY_BATCH_SIZE = 10;

/** Total time the retry processor may spend; leaves room in the 30s function limit */
export const WEBHOOK_RETRY_TIME_BUDGET_MS = 20_000;

/**
 * Pending deliveries older than this are failed instead of retried. Earlier versions left
 * failed and cut-off deliveries pending (some without `next_retry_at`) and never retried them;
 * sending week-old events now would surprise the receiver, and with the daily cron 3 days
 * still allows the default 3 attempts.
 */
export const WEBHOOK_RETRY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** Retries go to these webhooks only: a webhook the user set inactive gets nothing */
const RETRYABLE_WEBHOOK_STATUSES: WebhookStatus[] = ['active', 'failed'];

/** A new round only starts if it can finish (one attempt timeout plus this) within the budget */
const ROUND_MARGIN_MS = 2000;

const DEFAULT_RETRY_CONFIG: WebhookRetryConfig = { maxRetries: 3, retryDelayMs: 5000 };

/**
 * `maxRetries` caps the total number of attempts, the first one included (a value of 0 still
 * allows the first attempt). Same expression in SQL for picking due retries.
 */
const maxAttemptsSql = sql`coalesce((${webhooks.retryConfig} ->> 'maxRetries')::int, ${DEFAULT_RETRY_CONFIG.maxRetries})`;

type DeliveryResult = { success: boolean; statusCode?: number; error?: string; response?: string };

/**
 * Deliver a webhook to a specific endpoint
 */
async function deliverWebhook(
  webhook: Webhook,
  payload: WebhookPayload,
  deliveryId: string
): Promise<DeliveryResult> {
  const payloadString = JSON.stringify(payload);
  const signature = generateWebhookSignature(payloadString, webhook.secret);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-ID': deliveryId,
    'X-Webhook-Event': payload.event,
    'User-Agent': 'DiagnoLeads-Webhook/1.0',
    ...(webhook.headers || {}),
  };

  const controller = new AbortController();
  // Covers reading the response body too, so a slow body cannot outlast the timeout
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: controller.signal,
    });

    const responseText = await response.text().catch(() => '');

    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
        response: responseText.slice(0, 1000), // Limit response size
      };
    }

    return {
      success: false,
      statusCode: response.status,
      error: `HTTP ${response.status}: ${response.statusText}`,
      response: responseText.slice(0, 1000),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Store the outcome of an attempt. `attempts` already counts this attempt (it is counted when
 * the attempt starts). On failure the next retry follows the exponential backoff
 * (retryDelayMs * 2^(attempts - 1)); once `attempts` reaches maxRetries the delivery is failed.
 */
async function recordAttempt(
  database: Database,
  webhook: Webhook,
  deliveryId: string,
  attempts: number,
  result: DeliveryResult,
  { isRetry }: { isRetry: boolean }
): Promise<void> {
  if (result.success) {
    await database
      .update(webhookDeliveries)
      .set({
        status: 'success',
        statusCode: result.statusCode,
        response: result.response,
        attempts,
        completedAt: new Date(),
        error: null,
        nextRetryAt: null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    await database
      .update(webhooks)
      .set({ lastTriggeredAt: new Date(), failureCount: 0, updatedAt: new Date() })
      .where(eq(webhooks.id, webhook.id));
    if (isRetry) {
      // A successful retry brings back a webhook marked failed; one the user set inactive
      // stays inactive
      await database
        .update(webhooks)
        .set({ status: 'active' })
        .where(and(eq(webhooks.id, webhook.id), eq(webhooks.status, 'failed')));
    }
    return;
  }

  const retryConfig = webhook.retryConfig || DEFAULT_RETRY_CONFIG;
  const exhausted = attempts >= retryConfig.maxRetries;
  await database
    .update(webhookDeliveries)
    .set({
      status: exhausted ? 'failed' : 'pending',
      statusCode: result.statusCode,
      error: result.error,
      response: result.response,
      attempts,
      nextRetryAt: exhausted
        ? null
        : new Date(Date.now() + retryConfig.retryDelayMs * 2 ** Math.max(attempts - 1, 0)),
      completedAt: exhausted ? new Date() : null,
    })
    .where(eq(webhookDeliveries.id, deliveryId));

  // The first attempt of each event counts towards the webhook's failure count
  const failureCount = isRetry ? webhook.failureCount : webhook.failureCount + 1;
  if (!isRetry || (exhausted && failureCount >= 10)) {
    await database
      .update(webhooks)
      .set({
        ...(isRetry ? {} : { failureCount: sql`${webhooks.failureCount} + 1` }),
        // Mark webhook as failed if too many failures
        ...(exhausted && failureCount >= 10 ? { status: 'failed' as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(webhooks.id, webhook.id));
  }
}

/**
 * Create the delivery record and make the first attempt. The record is due for retry
 * (`next_retry_at`) from the start, so an attempt that never finishes is retried later.
 */
async function sendNewDelivery(
  database: Database,
  webhook: Webhook,
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<boolean> {
  const payload: WebhookPayload = {
    id: crypto.randomUUID(),
    event: eventType,
    timestamp: new Date().toISOString(),
    organizationId,
    data,
  };

  const [delivery] = await database
    .insert(webhookDeliveries)
    .values({
      webhookId: webhook.id,
      eventType,
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
      attempts: 1,
      nextRetryAt: new Date(Date.now() + WEBHOOK_DELIVERY_LEASE_MS),
    })
    .returning();

  const result = await deliverWebhook(webhook, payload, delivery.id);
  await recordAttempt(database, webhook, delivery.id, 1, result, { isRetry: false });
  return result.success;
}

/**
 * Send one delivery to the given webhook only, whatever the other webhooks subscribed to the
 * event (the settings page's test send, #314). Same delivery record, timeout and retry lease
 * as an event delivery.
 */
export async function sendWebhookDelivery(
  webhook: Webhook,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  { database = db }: { database?: Database } = {}
): Promise<{ success: boolean }> {
  const success = await sendNewDelivery(database, webhook, webhook.organizationId, eventType, data);
  return { success };
}

/**
 * Trigger webhooks for a specific event. Endpoints are sent to in parallel, so one slow
 * endpoint does not delay the others.
 */
export async function triggerWebhooks(
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  { database = db }: { database?: Database } = {}
): Promise<{ triggered: number; failed: number }> {
  // Find all active webhooks for this organization that are subscribed to this event
  const activeWebhooks = await database
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.status, 'active')));

  // Filter webhooks that are subscribed to this event
  const subscribedWebhooks = activeWebhooks.filter((w) => w.events.includes(eventType));

  if (subscribedWebhooks.length === 0) {
    return { triggered: 0, failed: 0 };
  }

  const results = await Promise.allSettled(
    subscribedWebhooks.map((webhook) =>
      sendNewDelivery(database, webhook, organizationId, eventType, data)
    )
  );

  let triggered = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      triggered++;
    } else {
      if (result.status === 'rejected') {
        console.error('Failed to record webhook delivery:', result.reason);
      }
      failed++;
    }
  }

  return { triggered, failed };
}

/**
 * Pending deliveries created more than WEBHOOK_RETRY_MAX_AGE_MS ago (with or without
 * `next_retry_at`) are failed, whatever their webhook's status
 */
async function failExpiredDeliveries(database: Database, now: Date): Promise<number> {
  const rows = await database
    .update(webhookDeliveries)
    .set({ status: 'failed', nextRetryAt: null, completedAt: now })
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        lt(webhookDeliveries.createdAt, new Date(now.getTime() - WEBHOOK_RETRY_MAX_AGE_MS))
      )
    )
    .returning({ id: webhookDeliveries.id });
  return rows.length;
}

/**
 * Pending deliveries whose attempts are used up (e.g. left by an earlier version, or an
 * attempt cut off at the last try) are failed instead of sent again
 */
async function failExhaustedDeliveries(database: Database, now: Date): Promise<number> {
  const exhausted = database
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.nextRetryAt, now),
        gte(webhookDeliveries.attempts, maxAttemptsSql)
      )
    );

  const rows = await database
    .update(webhookDeliveries)
    .set({ status: 'failed', nextRetryAt: null, completedAt: now })
    .where(and(inArray(webhookDeliveries.id, exhausted), eq(webhookDeliveries.status, 'pending')))
    .returning({ id: webhookDeliveries.id });
  return rows.length;
}

/**
 * Claim up to `limit` due retries: pending, `next_retry_at` reached, attempts below the
 * webhook's maximum, created within WEBHOOK_RETRY_MAX_AGE_MS, webhook active or failed (those of
 * an inactive webhook are left alone and age out). Claiming counts the attempt and moves `next_retry_at` by the lease, so a
 * concurrent run skips these rows and an attempt cut off mid-way is retried after the lease.
 */
async function claimDueRetries(database: Database, now: Date, limit: number) {
  const due = and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextRetryAt, now));
  // Two statements in one transaction: as an `IN (subquery)` the subquery can be re-run per
  // row, and its LIMIT would then not bound the claim
  return database.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
      .where(
        and(
          due,
          lt(webhookDeliveries.attempts, maxAttemptsSql),
          gte(webhookDeliveries.createdAt, new Date(now.getTime() - WEBHOOK_RETRY_MAX_AGE_MS)),
          inArray(webhooks.status, RETRYABLE_WEBHOOK_STATUSES)
        )
      )
      .orderBy(asc(webhookDeliveries.nextRetryAt))
      .limit(limit)
      .for('update', { of: webhookDeliveries, skipLocked: true });
    if (candidates.length === 0) return [];

    return tx
      .update(webhookDeliveries)
      .set({
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        nextRetryAt: new Date(now.getTime() + WEBHOOK_DELIVERY_LEASE_MS),
      })
      .where(
        inArray(
          webhookDeliveries.id,
          candidates.map((c) => c.id)
        )
      )
      .returning();
  });
}

/**
 * Process due webhook retries in rounds of `batchSize` parallel attempts, until none are due or
 * the time budget would be exceeded. Called by the daily webhook cron.
 */
export async function processWebhookRetries({
  database = db,
  batchSize = WEBHOOK_RETRY_BATCH_SIZE,
  timeBudgetMs = WEBHOOK_RETRY_TIME_BUDGET_MS,
}: { database?: Database; batchSize?: number; timeBudgetMs?: number } = {}): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  exhausted: number;
  expired: number;
}> {
  const startedAt = Date.now();
  // Expired first, so old rows are never sent (nor counted as exhausted)
  const expired = await failExpiredDeliveries(database, new Date());
  const exhausted = await failExhaustedDeliveries(database, new Date());

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  while (Date.now() - startedAt + WEBHOOK_DELIVERY_TIMEOUT_MS + ROUND_MARGIN_MS <= timeBudgetMs) {
    const claimed = await claimDueRetries(database, new Date(), batchSize);
    if (claimed.length === 0) break;

    const webhookIds = [...new Set(claimed.map((d) => d.webhookId))];
    const webhookRows = await database
      .select()
      .from(webhooks)
      .where(inArray(webhooks.id, webhookIds));
    const webhookById = new Map(webhookRows.map((w) => [w.id, w]));

    const results = await Promise.allSettled(
      claimed.map(async (delivery) => {
        const webhook = webhookById.get(delivery.webhookId);
        if (!webhook) return false; // deleted meanwhile (its deliveries go with it)
        const payload = delivery.payload as unknown as WebhookPayload;
        const result = await deliverWebhook(webhook, payload, delivery.id);
        await recordAttempt(database, webhook, delivery.id, delivery.attempts, result, {
          isRetry: true,
        });
        return result.success;
      })
    );

    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled' && result.value) {
        succeeded++;
      } else {
        if (result.status === 'rejected') {
          console.error('Failed to record webhook retry:', result.reason);
        }
        failed++;
      }
    }
  }

  return { processed, succeeded, failed, exhausted, expired };
}

/**
 * Clean up old webhook deliveries
 * Keeps deliveries for the last 30 days
 */
export async function cleanupOldDeliveries(daysToKeep = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const deletedRows = await db
    .delete(webhookDeliveries)
    .where(
      and(
        lte(webhookDeliveries.createdAt, cutoffDate),
        inArray(webhookDeliveries.status, ['success', 'failed'])
      )
    )
    .returning({ id: webhookDeliveries.id });

  return deletedRows.length;
}
