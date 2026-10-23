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
import { and, asc, eq, gte, inArray, lt, lte, not, sql } from 'drizzle-orm';
import { consumeRateLimits } from '../../diagnostics/rate-limit';
import { WEBHOOK_TEST_SEND_LIMITS, type WebhookTestSendLimit } from './test-send-limits';
import { checkWebhookDestination, destinationErrorFor } from './url-guard';
import { isReservedWebhookHeaderName } from './webhook-headers';

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
  /** Set on a test send from the settings page only (#321) */
  test?: true;
}

/** The message of a test send; also how test deliveries stored before #321 are recognised */
export const WEBHOOK_TEST_MESSAGE = 'This is a test webhook from DiagnoLeads';

export { WEBHOOK_TEST_SEND_LIMITS };

/**
 * A test delivery: marked with `test: true` on the payload, or (stored before #321) with the
 * test data. Never null, so it can be negated.
 * Never spread user-provided keys into event `data` (or the payload): they could fake this mark.
 */
const isTestDeliverySql = sql`coalesce(
  (${webhookDeliveries.payload} ->> 'test') = 'true'
  or (
    (${webhookDeliveries.payload} -> 'data' ->> 'test') = 'true'
    and (${webhookDeliveries.payload} -> 'data' ->> 'message') = ${WEBHOOK_TEST_MESSAGE}
  ),
  false
)`;

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

/** A transaction of `Database`, which can store a delivery as the database itself can */
type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type DeliveryResult = {
  success: boolean;
  statusCode?: number;
  error?: string;
  response?: string;
  /** false when sending again cannot help (the destination is refused): no retry is scheduled */
  retryable?: boolean;
};

/** Stored instead of the error text when the custom headers cannot be sent */
export const INVALID_HEADERS_ERROR = 'Invalid request headers';

/**
 * A fixed description of a failed request. The raw message is never stored: it is shown to
 * those who manage webhooks and could quote a header value (#314). A system error code
 * (e.g. ECONNREFUSED) is kept when there is one, as it tells nothing about the headers.
 */
export function describeRequestError(error: unknown): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'Request timed out';
  }
  const codeOf = (value: unknown) => {
    const code = (value as { code?: unknown } | null)?.code;
    return typeof code === 'string' && /^[A-Za-z_]{1,40}$/.test(code) ? code : undefined;
  };
  const code =
    codeOf(error) ??
    (error instanceof Error ? codeOf((error as { cause?: unknown }).cause) : undefined);
  return code ? `Network error (${code})` : 'Network error';
}

/**
 * The request headers: the custom ones, then those the delivery sets. A stored custom header
 * with a reserved name (saved before names were checked) is skipped, so the delivery's own
 * headers cannot be replaced (`__proto__` is reserved too). Built through a Map and
 * Object.fromEntries, which define keys rather than assign them.
 * Throws if a custom header cannot be sent (e.g. a value with a line break saved before values
 * were checked).
 */
function buildRequestHeaders(
  webhook: Webhook,
  ownHeaders: Record<string, string>
): Record<string, string> {
  const map = new Map<string, string>();
  for (const [name, value] of Object.entries(webhook.headers ?? {})) {
    if (!isReservedWebhookHeaderName(name)) map.set(name, value);
  }
  for (const [name, value] of Object.entries(ownHeaders)) {
    map.set(name, value);
  }
  const headers = Object.fromEntries(map);
  // Same checks as fetch makes, before any network activity
  new Headers(headers);
  return headers;
}

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

  let headers: Record<string, string>;
  try {
    headers = buildRequestHeaders(webhook, {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-ID': deliveryId,
      'X-Webhook-Event': payload.event,
      'User-Agent': 'DiagnoLeads-Webhook/1.0',
    });
  } catch {
    // The error text can quote the header value
    return { success: false, error: INVALID_HEADERS_ERROR };
  }

  const controller = new AbortController();
  // Covers resolving the host name and reading the response body too, so neither a slow DNS
  // answer nor a slow body can outlast the timeout
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_DELIVERY_TIMEOUT_MS);
  try {
    // Before every attempt (first, retry, test): the URL rules, then every address the host
    // name resolves to (#321). Only a fixed text and a reason code are stored, never the address.
    const destination = await abortable(checkWebhookDestination(webhook.url), controller.signal);
    if (!destination.ok) {
      return { success: false, error: destinationErrorFor(destination.reason), retryable: false };
    }

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: controller.signal,
      // A redirect is not followed: a public URL could send the request on to an internal one
      redirect: 'manual',
    });

    const responseText = await response.text().catch(() => '');

    if (response.status >= 300 && response.status < 400) {
      return {
        success: false,
        statusCode: response.status,
        error: `HTTP ${response.status}: Redirect not followed`,
        response: responseText.slice(0, 1000),
      };
    }

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
    return {
      success: false,
      error: describeRequestError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** The promise, or a rejection with the signal's reason once it is aborted */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
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
  { isRetry, isTest = false }: { isRetry: boolean; isTest?: boolean }
): Promise<void> {
  // A test send is tried once and leaves the webhook as it is: no retry, no failure count, no
  // automatic deactivation, no "last triggered" time (#321)
  if (isTest) {
    await database
      .update(webhookDeliveries)
      .set({
        status: result.success ? 'success' : 'failed',
        statusCode: result.statusCode,
        response: result.response,
        error: result.success ? null : result.error,
        attempts,
        completedAt: new Date(),
        nextRetryAt: null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

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
        .set({ status: 'active', updatedAt: new Date() })
        .where(and(eq(webhooks.id, webhook.id), eq(webhooks.status, 'failed')));
    }
    return;
  }

  const retryConfig = webhook.retryConfig || DEFAULT_RETRY_CONFIG;
  const exhausted = attempts >= retryConfig.maxRetries || result.retryable === false;
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
 * Store the delivery record of a first attempt. It is due (`next_retry_at`) from the start, so
 * an attempt that never finishes is retried later (a test send's is failed instead).
 */
async function insertDelivery(
  database: Database | DatabaseTransaction,
  webhook: Webhook,
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  { test = false, queued = false }: { test?: boolean; queued?: boolean } = {}
) {
  const payload: WebhookPayload = {
    id: crypto.randomUUID(),
    event: eventType,
    timestamp: new Date().toISOString(),
    organizationId,
    data,
    ...(test ? { test: true as const } : {}),
  };

  const [delivery] = await database
    .insert(webhookDeliveries)
    .values({
      webhookId: webhook.id,
      eventType,
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
      // A queued delivery is sent by the retry processor as its first attempt
      attempts: queued ? 0 : 1,
      nextRetryAt: queued ? new Date() : new Date(Date.now() + WEBHOOK_DELIVERY_LEASE_MS),
    })
    .returning();
  return { delivery, payload };
}

/** Make the first attempt of a stored delivery and record it */
async function sendStoredDelivery(
  database: Database,
  webhook: Webhook,
  { delivery, payload }: Awaited<ReturnType<typeof insertDelivery>>
): Promise<boolean> {
  const result = await deliverWebhook(webhook, payload, delivery.id);
  await recordAttempt(database, webhook, delivery.id, 1, result, {
    isRetry: false,
    isTest: payload.test === true,
  });
  return result.success;
}

/** Create the delivery record and make the first attempt */
async function sendNewDelivery(
  database: Database,
  webhook: Webhook,
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<boolean> {
  const stored = await insertDelivery(database, webhook, organizationId, eventType, data);
  return sendStoredDelivery(database, webhook, stored);
}

/**
 * Send one delivery to the given webhook only, whatever the other webhooks subscribed to the
 * event (#314). Same delivery record, timeout and retry lease as an event delivery.
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

export type TestDeliveryResult =
  | { allowed: true; success: boolean }
  | { allowed: false; limit: WebhookTestSendLimit; retryAfterSeconds?: number };

/**
 * The settings page's test send (#314, #321): one delivery to this webhook only, marked as a
 * test, tried once (never retried, not counted as a failure of the webhook).
 *
 * Limited by WEBHOOK_TEST_SEND_LIMITS, checked in this order:
 * 1. per webhook, counted from its stored test deliveries;
 * 2. per user (across organizations), then per organization, counted in `public_rate_limits`,
 *    which deleting a webhook does not reset. These are consumed only once the per-webhook
 *    check has passed. A request the per-user limit refuses does not use up the organization's
 *    allowance; one the organization limit refuses has used one of the user's.
 * Everything runs in one transaction holding a lock per organization, so concurrent requests
 * (from any server instance) cannot both take the last place. A refused request stores no
 * delivery.
 */
export async function sendTestDelivery(
  webhook: Webhook,
  { userId, database = db, now = new Date() }: { userId: string; database?: Database; now?: Date }
): Promise<TestDeliveryResult> {
  const { perWebhook, perOrganization, perUser } = WEBHOOK_TEST_SEND_LIMITS;
  const webhookSince = new Date(now.getTime() - perWebhook.windowMs);
  const eventType = webhook.events[0] || 'lead.created';
  const data = { test: true, message: WEBHOOK_TEST_MESSAGE, timestamp: now.toISOString() };

  const reserved = await database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`webhook-test-send:${webhook.organizationId}`}))`
    );
    const [counts] = await tx
      .select({ webhook: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.webhookId, webhook.id),
          gte(webhookDeliveries.createdAt, webhookSince),
          isTestDeliverySql
        )
      );
    if ((counts?.webhook ?? 0) >= perWebhook.limit) {
      return { allowed: false, limit: 'perWebhook' } as const;
    }

    const quota = await consumeRateLimits(
      tx,
      [
        { rule: perUser, identifier: userId },
        { rule: perOrganization, identifier: webhook.organizationId },
      ],
      now
    );
    if (!quota.allowed) {
      return {
        allowed: false,
        limit: quota.rule === perUser.name ? 'perUser' : 'perOrganization',
        retryAfterSeconds: quota.retryAfterSeconds,
      } as const;
    }

    const stored = await insertDelivery(tx, webhook, webhook.organizationId, eventType, data, {
      test: true,
    });
    return { allowed: true, stored } as const;
  });

  if (!reserved.allowed) return reserved;
  const success = await sendStoredDelivery(database, webhook, reserved.stored);
  return { allowed: true, success };
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

/** How long one call of triggerWebhookBatch sends before it only queues the rest */
export const WEBHOOK_BATCH_TIME_BUDGET_MS = 15_000;

/**
 * Most deliveries one call of triggerWebhookBatch queues. The retry queue is shared by every
 * organization and worked once a day, so one bulk change must not fill it; past this the
 * deliveries are dropped and counted (the caller reports them).
 */
export const WEBHOOK_BATCH_QUEUE_LIMIT = 100;

/**
 * Trigger several events of one organization (#308), reading its webhooks once. Events are sent
 * one after another while a whole attempt still fits in the time budget; the rest are stored as
 * due deliveries for the retry processor (the daily webhook cron), up to
 * WEBHOOK_BATCH_QUEUE_LIMIT; deliveries past that are dropped and returned as a count.
 */
export async function triggerWebhookBatch(
  organizationId: string,
  events: { eventType: WebhookEventType; data: Record<string, unknown> }[],
  {
    database = db,
    timeBudgetMs = WEBHOOK_BATCH_TIME_BUDGET_MS,
  }: { database?: Database; timeBudgetMs?: number } = {}
): Promise<{ sent: number; failed: number; queued: number; dropped: number }> {
  const counts = { sent: 0, failed: 0, queued: 0, dropped: 0 };
  if (events.length === 0) return counts;

  const activeWebhooks = await database
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.status, 'active')));
  if (activeWebhooks.length === 0) return counts;

  const startedAt = Date.now();
  for (const { eventType, data } of events) {
    const subscribed = activeWebhooks.filter((w) => w.events.includes(eventType));
    if (subscribed.length === 0) continue;

    const fits =
      Date.now() - startedAt + WEBHOOK_DELIVERY_TIMEOUT_MS + ROUND_MARGIN_MS <= timeBudgetMs;
    if (!fits && counts.queued + subscribed.length > WEBHOOK_BATCH_QUEUE_LIMIT) {
      counts.dropped += subscribed.length;
      continue;
    }
    const results = await Promise.allSettled(
      subscribed.map(async (webhook) => {
        if (!fits) {
          await insertDelivery(database, webhook, organizationId, eventType, data, {
            queued: true,
          });
          return 'queued' as const;
        }
        return (await sendNewDelivery(database, webhook, organizationId, eventType, data))
          ? ('sent' as const)
          : ('failed' as const);
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        counts[result.value]++;
      } else {
        console.error('Failed to record webhook delivery:', result.reason);
        counts.failed++;
      }
    }
  }
  return counts;
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
 * Test deliveries are never retried (#321). One still pending once its lease has passed was
 * cut off mid-way (or stored before #321 as retryable): it is failed, not sent again.
 */
async function failDueTestDeliveries(database: Database, now: Date): Promise<number> {
  const rows = await database
    .update(webhookDeliveries)
    .set({ status: 'failed', nextRetryAt: null, completedAt: now })
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.nextRetryAt, now),
        isTestDeliverySql
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
        gte(webhookDeliveries.attempts, maxAttemptsSql),
        not(isTestDeliverySql)
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
          inArray(webhooks.status, RETRYABLE_WEBHOOK_STATUSES),
          // Test sends are tried once only (#321)
          not(isTestDeliverySql)
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
  testsFailed: number;
}> {
  const startedAt = Date.now();
  // Expired first, so old rows are never sent (nor counted as exhausted)
  const expired = await failExpiredDeliveries(database, new Date());
  const testsFailed = await failDueTestDeliveries(database, new Date());
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
          // A queued delivery (#308) reaches here for its first attempt
          isRetry: delivery.attempts > 1,
          isTest: payload.test === true,
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

  return { processed, succeeded, failed, exhausted, expired, testsFailed };
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
