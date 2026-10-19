/**
 * Webhook delivery and retries (#69) on a real PostgreSQL: a delivery is due for retry from the
 * moment it is stored (so an attempt cut off mid-way is retried), and the retry processor sends
 * only due deliveries, within the batch size and the webhook's attempt limit. The HTTP side is
 * a stubbed fetch. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/webhook-retries.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { organizations, webhookDeliveries, webhooks } from '@/lib/db/schema';
import {
  WEBHOOK_DELIVERY_LEASE_MS,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_RETRY_MAX_AGE_MS,
  processWebhookRetries,
  triggerWebhooks,
} from '@/lib/features/webhooks/services/webhook-service';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

/** A first round fits (it starts within 1s), a second one after slow endpoints does not */
const ONE_ROUND_BUDGET_MS = WEBHOOK_DELIVERY_TIMEOUT_MS + 2000 + 1000;

describe.skipIf(!url)('webhook retries (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  let webhookId: string;
  const fetchMock = vi.fn();

  /** IDs of the deliveries sent, from the X-Webhook-ID header */
  const sentIds = () =>
    fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit & { headers: Record<string, string> }).headers['X-Webhook-ID']
    );

  const answer = (status: number) => ({
    ok: status < 300,
    status,
    statusText: status < 300 ? 'OK' : 'Error',
    text: async () => '',
  });

  async function createWebhook(
    retryConfig = { maxRetries: 3, retryDelayMs: 5000 },
    status: 'active' | 'inactive' | 'failed' = 'active'
  ) {
    const [row] = await pg
      .insert(webhooks)
      .values({
        organizationId: org,
        name: 'CRM連携',
        url: `https://hooks.example.com/${unique()}`,
        secret: 'whsec_test',
        events: ['diagnostic.submitted'],
        retryConfig,
        status,
      })
      .returning();
    return row.id;
  }

  async function createDelivery(values: {
    webhookId?: string;
    attempts?: number;
    nextRetryAt?: Date | null;
    status?: 'pending' | 'success' | 'failed';
    createdAt?: Date;
  }) {
    const [row] = await pg
      .insert(webhookDeliveries)
      .values({
        webhookId: values.webhookId ?? webhookId,
        eventType: 'diagnostic.submitted',
        payload: { id: unique(), event: 'diagnostic.submitted', data: {} },
        status: values.status ?? 'pending',
        attempts: values.attempts ?? 1,
        nextRetryAt: values.nextRetryAt === undefined ? new Date(Date.now() - 1000) : values.nextRetryAt,
        ...(values.createdAt ? { createdAt: values.createdAt } : {}),
      })
      .returning();
    return row.id;
  }

  const load = async (id: string) => {
    const [row] = await pg.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
    return row;
  };

  beforeAll(async () => {
    const [o] = await pg
      .insert(organizations)
      .values({ name: '架空商事', slug: `webhook-retries-${unique()}` })
      .returning();
    org = o.id;
  });

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(200));
    // Each test starts without due deliveries (the processor looks at all of them)
    await pg.delete(webhooks).where(eq(webhooks.organizationId, org));
    webhookId = await createWebhook();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (org) await pg.delete(organizations).where(eq(organizations.id, org));
    await client?.end();
  });

  it('stores a delivery as due for retry before the first attempt finishes', async () => {
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const before = Date.now();
    const run = triggerWebhooks(org, 'diagnostic.submitted', { leadId: 'x' }, { database: pg });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // What remains if the function is stopped now: a pending delivery that becomes due
    const [inFlight] = await pg
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId));
    expect(inFlight).toMatchObject({ status: 'pending', attempts: 1 });
    expect(inFlight.nextRetryAt?.getTime()).toBeGreaterThanOrEqual(
      before + WEBHOOK_DELIVERY_LEASE_MS - 1000
    );

    finish(answer(200));
    await expect(run).resolves.toEqual({ triggered: 1, failed: 0 });
    expect(await load(inFlight.id)).toMatchObject({
      status: 'success',
      attempts: 1,
      nextRetryAt: null,
    });
  });

  it('sends to several endpoints and records each outcome', async () => {
    const second = await createWebhook();
    const [secondRow] = await pg.select().from(webhooks).where(eq(webhooks.id, second));
    fetchMock.mockImplementation(async (target: string) =>
      answer(target === secondRow.url ? 500 : 200)
    );

    await expect(
      triggerWebhooks(org, 'diagnostic.submitted', {}, { database: pg })
    ).resolves.toEqual({ triggered: 1, failed: 1 });

    const [failed] = await pg
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, second));
    expect(failed).toMatchObject({ status: 'pending', attempts: 1, statusCode: 500 });
    const [hook] = await pg.select().from(webhooks).where(eq(webhooks.id, second));
    expect(hook.failureCount).toBe(1);
  });

  it('sends only due deliveries below the attempt limit', async () => {
    const due = await createDelivery({ attempts: 1 });
    const cutOff = await createDelivery({ attempts: 1, nextRetryAt: new Date(Date.now() - 5) });
    const notYet = await createDelivery({ nextRetryAt: new Date(Date.now() + 60_000) });
    const noRetryTime = await createDelivery({ nextRetryAt: null });
    const done = await createDelivery({ status: 'success' });
    const failed = await createDelivery({ status: 'failed' });
    const usedUp = await createDelivery({ attempts: 3 });

    const result = await processWebhookRetries({ database: pg });

    expect(sentIds().sort()).toEqual([due, cutOff].sort());
    expect(result).toEqual({ processed: 2, succeeded: 2, failed: 0, exhausted: 1, expired: 0 });
    expect(await load(due)).toMatchObject({ status: 'success', attempts: 2, nextRetryAt: null });
    expect(await load(usedUp)).toMatchObject({ status: 'failed', attempts: 3, nextRetryAt: null });
    for (const id of [notYet, noRetryTime]) {
      expect((await load(id)).status).toBe('pending');
    }
    expect((await load(done)).status).toBe('success');
    expect((await load(failed)).status).toBe('failed');
  });

  it('uses the webhook own attempt limit', async () => {
    const strict = await createWebhook({ maxRetries: 2, retryDelayMs: 1000 });
    const atLimit = await createDelivery({ webhookId: strict, attempts: 2 });
    const belowLimit = await createDelivery({ webhookId: strict, attempts: 1 });

    await processWebhookRetries({ database: pg });

    expect(sentIds()).toEqual([belowLimit]);
    expect((await load(atLimit)).status).toBe('failed');
  });

  it('backs off after a failed retry and fails the delivery at the last attempt', async () => {
    fetchMock.mockResolvedValue(answer(503));
    const second = await createDelivery({ attempts: 1 });
    const last = await createDelivery({ attempts: 2 });
    const before = Date.now();

    const result = await processWebhookRetries({ database: pg });

    expect(result).toMatchObject({ processed: 2, succeeded: 0, failed: 2 });
    const retried = await load(second);
    expect(retried).toMatchObject({ status: 'pending', attempts: 2, statusCode: 503 });
    // retryDelayMs * 2^(attempts - 1) = 5000 * 2
    expect(retried.nextRetryAt?.getTime()).toBeGreaterThanOrEqual(before + 10_000 - 1000);
    expect(retried.nextRetryAt?.getTime()).toBeLessThanOrEqual(Date.now() + 10_000 + 1000);
    expect(await load(last)).toMatchObject({ status: 'failed', attempts: 3, nextRetryAt: null });
  });

  it('claims at most one batch per round and stops when the time budget is used', async () => {
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => createDelivery({})));
    // Each endpoint takes 2s to answer (as seen by the processor's clock)
    const realNow = Date.now.bind(Date);
    let elapsed = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + elapsed);
    fetchMock.mockImplementation(async () => {
      elapsed += 2000;
      return answer(200);
    });

    const result = await processWebhookRetries({
      database: pg,
      batchSize: 2,
      timeBudgetMs: ONE_ROUND_BUDGET_MS,
    });

    expect(result.processed).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rows = await pg.select().from(webhookDeliveries).where(inArray(webhookDeliveries.id, ids));
    expect(rows.filter((r) => r.status === 'success')).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(3);

    // With the full budget the rest goes out in further rounds
    clock.mockRestore();
    fetchMock.mockResolvedValue(answer(200));
    const rest = await processWebhookRetries({ database: pg, batchSize: 2 });
    expect(rest.processed).toBe(3);
  });

  it('an attempt cut off during a retry is due again only after the lease', async () => {
    // Does not answer until the end of the test: the first run stands for one that was cut off
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const id = await createDelivery({ attempts: 1 });

    const first = processWebhookRetries({ database: pg, batchSize: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const claimed = await load(id);
    expect(claimed).toMatchObject({ status: 'pending', attempts: 2 });
    expect(claimed.nextRetryAt?.getTime()).toBeGreaterThan(Date.now() + WEBHOOK_DELIVERY_LEASE_MS - 5000);

    // A concurrent run does not pick it up again
    fetchMock.mockResolvedValue(answer(200));
    const other = await processWebhookRetries({ database: pg, timeBudgetMs: ONE_ROUND_BUDGET_MS });
    expect(other.processed).toBe(0);

    finish(answer(200));
    await expect(first).resolves.toMatchObject({ processed: 1, succeeded: 1 });
    expect(await load(id)).toMatchObject({ status: 'success', attempts: 2 });
  });

  it('two runs at the same time send each due delivery once', async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => createDelivery({})));

    const runs = await Promise.all([
      processWebhookRetries({ database: pg, batchSize: 3 }),
      processWebhookRetries({ database: pg, batchSize: 3 }),
    ]);

    expect(runs[0].processed + runs[1].processed).toBe(ids.length);
    expect(fetchMock).toHaveBeenCalledTimes(ids.length);
    expect(new Set(sentIds()).size).toBe(ids.length);
    const rows = await pg.select().from(webhookDeliveries).where(inArray(webhookDeliveries.id, ids));
    expect(rows.every((r) => r.status === 'success' && r.attempts === 2)).toBe(true);
  });

  it('sends nothing to an inactive webhook and leaves it inactive', async () => {
    const inactive = await createWebhook(undefined, 'inactive');
    const id = await createDelivery({ webhookId: inactive });

    const result = await processWebhookRetries({ database: pg });

    expect(result.processed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await load(id)).toMatchObject({ status: 'pending', attempts: 1 });
    const [hook] = await pg.select().from(webhooks).where(eq(webhooks.id, inactive));
    expect(hook.status).toBe('inactive');
  });

  it('a successful retry brings a failed webhook back to active', async () => {
    const failedHook = await createWebhook(undefined, 'failed');
    const id = await createDelivery({ webhookId: failedHook });

    await processWebhookRetries({ database: pg });

    expect(sentIds()).toEqual([id]);
    expect((await load(id)).status).toBe('success');
    const [hook] = await pg.select().from(webhooks).where(eq(webhooks.id, failedHook));
    expect(hook.status).toBe('active');
  });

  it('fails pending deliveries older than 3 days without sending them', async () => {
    const old = new Date(Date.now() - WEBHOOK_RETRY_MAX_AGE_MS - 60_000);
    const stale = await createDelivery({ createdAt: old });
    const staleWithoutRetryTime = await createDelivery({ createdAt: old, nextRetryAt: null });
    const recent = await createDelivery({
      createdAt: new Date(Date.now() - WEBHOOK_RETRY_MAX_AGE_MS + 60 * 60 * 1000),
    });

    const result = await processWebhookRetries({ database: pg });

    expect(result).toMatchObject({ expired: 2, processed: 1 });
    expect(sentIds()).toEqual([recent]);
    for (const id of [stale, staleWithoutRetryTime]) {
      expect(await load(id)).toMatchObject({ status: 'failed', nextRetryAt: null, attempts: 1 });
    }
  });
});
