/**
 * Webhook delivery without a database (#29): the settings page's test send and its limits, a
 * batch of events sent within the time budget and queued past it, and the retry processor
 * (claiming due deliveries, backoff, giving up, bringing a failed webhook back). The database is
 * a fake that answers each query from what it is (table, lock, values) and records the calls;
 * the destination check, the transport and the rate limits are replaced. The same flows on a
 * real PostgreSQL (locks, SKIP LOCKED, the SQL conditions) are covered by
 * test/unit/integration/webhook-retries.db.test.ts and webhook-test-send.db.test.ts.
 */
import type { Webhook, WebhookEventType } from '@/lib/db/schema';
import { WEBHOOK_TEST_SEND_LIMITS } from '@/lib/features/webhooks/services/test-send-limits';
import { DESTINATION_NOT_ALLOWED_ERROR } from '@/lib/features/webhooks/services/url-guard';
import {
  WEBHOOK_BATCH_QUEUE_LIMIT,
  WEBHOOK_DELIVERY_LEASE_MS,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_TEST_MESSAGE,
  processWebhookRetries,
  sendTestDelivery,
  triggerWebhookBatch,
} from '@/lib/features/webhooks/services/webhook-service';
import { type SQL, getTableName, is } from 'drizzle-orm';
import { PgDialect, PgTable } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkDestination: vi.fn(),
  sendRequest: vi.fn(),
  consumeRateLimits: vi.fn(),
}));

vi.mock('@/lib/features/webhooks/services/url-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/webhooks/services/url-guard')>()),
  checkWebhookDestination: mocks.checkDestination,
}));
vi.mock('@/lib/features/webhooks/services/pinned-request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/webhooks/services/pinned-request')>()),
  sendPinnedRequest: mocks.sendRequest,
}));
vi.mock('@/lib/features/diagnostics/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnostics/rate-limit')>()),
  consumeRateLimits: mocks.consumeRateLimits,
}));

type Call = {
  op: 'select' | 'insert' | 'update' | 'execute';
  table?: string;
  where?: SQL;
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
  lock?: { strength: string; config?: unknown };
  limit?: number;
  statement?: SQL;
};

const dbState = {
  calls: [] as Call[],
  transactions: 0,
  answer: (_call: Call): unknown[] => [],
};

const nameOf = (table: unknown) => (is(table, PgTable) ? getTableName(table) : undefined);

/** A query builder: every method returns itself; awaiting it yields `dbState.answer(call)` */
function query(op: Call['op']) {
  return (target?: unknown) => {
    const call: Call = { op, table: op === 'select' ? undefined : nameOf(target) };
    dbState.calls.push(call);
    const promise = Promise.resolve().then(() => dbState.answer(call));
    const builder = Object.assign(promise, {
      from: (table: unknown) => {
        call.table = nameOf(table);
        return builder;
      },
      innerJoin: () => builder,
      where: (where: SQL) => {
        call.where = where;
        return builder;
      },
      values: (values: Record<string, unknown>) => {
        call.values = values;
        return builder;
      },
      set: (set: Record<string, unknown>) => {
        call.set = set;
        return builder;
      },
      for: (strength: string, config?: unknown) => {
        call.lock = { strength, config };
        return builder;
      },
      orderBy: () => builder,
      limit: (limit: number) => {
        call.limit = limit;
        return builder;
      },
      returning: () => builder,
    });
    return builder;
  };
}

const fakeDb = {
  select: query('select'),
  insert: query('insert'),
  update: query('update'),
  execute: (statement: SQL) => {
    dbState.calls.push({ op: 'execute', statement });
    return Promise.resolve([]);
  },
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    dbState.transactions += 1;
    return fn(fakeDb);
  },
};
const database = fakeDb as unknown as NonNullable<
  Parameters<typeof triggerWebhookBatch>[2]
>['database'];

const dialect = new PgDialect();
const render = (statement: SQL | undefined) => {
  if (!statement) throw new Error('No SQL');
  return dialect.sqlToQuery(statement);
};

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const NOW = new Date('2026-10-24T03:00:00Z');

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'wh-1',
    organizationId: ORG_ID,
    name: 'CRM',
    url: 'https://hooks.example.com/in',
    secret: 'whsec_test',
    events: ['lead.created'],
    status: 'active',
    headers: {},
    retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
    lastTriggeredAt: null,
    failureCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Stored deliveries get ids in the order they are inserted */
function insertedDelivery(call: Call, n: number) {
  return [{ id: `delivery-${n}`, ...call.values }];
}

const calls = (op: Call['op'], table?: string) =>
  dbState.calls.filter((c) => c.op === op && (table === undefined || c.table === table));

/** Updates of the delivery records made by recordAttempt (they always store `attempts`) */
const attemptUpdates = () =>
  calls('update', 'webhook_deliveries').filter(
    (c) => c.set && 'attempts' in c.set && 'status' in c.set
  );

const ok = { status: 200, statusText: 'OK', body: 'received' };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  dbState.calls = [];
  dbState.transactions = 0;
  let inserted = 0;
  dbState.answer = (call) =>
    call.op === 'insert' && call.table === 'webhook_deliveries'
      ? insertedDelivery(call, ++inserted)
      : [];
  mocks.checkDestination.mockReset();
  mocks.checkDestination.mockImplementation(async (url: string) => ({
    ok: true,
    url: new URL(url),
    addresses: [{ address: '93.184.215.14', family: 4 }],
  }));
  mocks.sendRequest.mockReset();
  mocks.sendRequest.mockResolvedValue(ok);
  mocks.consumeRateLimits.mockReset();
  mocks.consumeRateLimits.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sendTestDelivery', () => {
  /** Answers the per-webhook count with `count` test deliveries in the window */
  function withTestCount(count: number) {
    const base = dbState.answer;
    dbState.answer = (call) =>
      call.op === 'select' && call.table === 'webhook_deliveries'
        ? [{ webhook: count }]
        : base(call);
  }

  it('sends one delivery marked as a test, tried once, leaving the webhook as it is', async () => {
    withTestCount(2);
    const hook = webhook({ events: ['lead.status_changed', 'lead.created'] });

    expect(await sendTestDelivery(hook, { userId: USER_ID, database, now: NOW })).toEqual({
      allowed: true,
      success: true,
    });

    // One transaction holding the organization's lock while counting and reserving
    expect(dbState.transactions).toBe(1);
    const [lock] = calls('execute');
    expect(render(lock.statement).sql).toContain('pg_advisory_xact_lock');
    expect(render(lock.statement).params).toEqual([`webhook-test-send:${ORG_ID}`]);
    const [count] = calls('select', 'webhook_deliveries');
    expect(render(count.where).params).toEqual(
      expect.arrayContaining([
        'wh-1',
        new Date(NOW.getTime() - WEBHOOK_TEST_SEND_LIMITS.perWebhook.windowMs).toISOString(),
      ])
    );

    expect(mocks.consumeRateLimits).toHaveBeenCalledWith(
      fakeDb,
      [
        { rule: WEBHOOK_TEST_SEND_LIMITS.perUser, identifier: USER_ID },
        { rule: WEBHOOK_TEST_SEND_LIMITS.perOrganization, identifier: ORG_ID },
      ],
      NOW
    );

    const [insert] = calls('insert', 'webhook_deliveries');
    expect(insert.values).toMatchObject({
      webhookId: 'wh-1',
      eventType: 'lead.status_changed',
      status: 'pending',
      attempts: 1,
      payload: {
        event: 'lead.status_changed',
        organizationId: ORG_ID,
        test: true,
        data: { test: true, message: WEBHOOK_TEST_MESSAGE, timestamp: NOW.toISOString() },
      },
    });

    expect(mocks.sendRequest).toHaveBeenCalledTimes(1);
    expect(attemptUpdates().map((c) => c.set)).toEqual([
      expect.objectContaining({
        status: 'success',
        statusCode: 200,
        error: null,
        nextRetryAt: null,
      }),
    ]);
    // No failure count, status or "last triggered" change for a test
    expect(calls('update', 'webhooks')).toHaveLength(0);
  });

  it('records a failed test once, without a retry or a failure of the webhook', async () => {
    withTestCount(0);
    mocks.sendRequest.mockResolvedValue({
      status: 500,
      statusText: 'Internal Server Error',
      body: 'boom',
    });

    expect(await sendTestDelivery(webhook(), { userId: USER_ID, database, now: NOW })).toEqual({
      allowed: true,
      success: false,
    });
    expect(attemptUpdates().map((c) => c.set)).toEqual([
      expect.objectContaining({
        status: 'failed',
        statusCode: 500,
        error: 'HTTP 500: Internal Server Error',
        response: 'boom',
        nextRetryAt: null,
      }),
    ]);
    expect(calls('update', 'webhooks')).toHaveLength(0);
  });

  it('sends a lead.created test when the webhook has no events', async () => {
    withTestCount(0);

    await sendTestDelivery(webhook({ events: [] }), { userId: USER_ID, database, now: NOW });
    expect(calls('insert', 'webhook_deliveries')[0].values?.eventType).toBe('lead.created');
  });

  it('refuses a fourth test of the same webhook before using up the shared limits', async () => {
    withTestCount(WEBHOOK_TEST_SEND_LIMITS.perWebhook.limit);

    expect(await sendTestDelivery(webhook(), { userId: USER_ID, database, now: NOW })).toEqual({
      allowed: false,
      limit: 'perWebhook',
    });
    expect(mocks.consumeRateLimits).not.toHaveBeenCalled();
    expect(calls('insert')).toHaveLength(0);
    expect(mocks.sendRequest).not.toHaveBeenCalled();
  });

  it.each([
    [WEBHOOK_TEST_SEND_LIMITS.perUser.name, 'perUser'],
    [WEBHOOK_TEST_SEND_LIMITS.perOrganization.name, 'perOrganization'],
  ])('names the limit %s that refused and when to try again', async (rule, limit) => {
    withTestCount(0);
    mocks.consumeRateLimits.mockResolvedValue({ allowed: false, rule, retryAfterSeconds: 120 });

    expect(await sendTestDelivery(webhook(), { userId: USER_ID, database, now: NOW })).toEqual({
      allowed: false,
      limit,
      retryAfterSeconds: 120,
    });
    expect(calls('insert')).toHaveLength(0);
    expect(mocks.sendRequest).not.toHaveBeenCalled();
  });
});

describe('triggerWebhookBatch', () => {
  /** Answers the organization's active webhooks */
  function withWebhooks(...hooks: Webhook[]) {
    const base = dbState.answer;
    dbState.answer = (call) =>
      call.op === 'select' && call.table === 'webhooks' ? hooks : base(call);
  }

  it('does nothing for no events', async () => {
    expect(await triggerWebhookBatch(ORG_ID, [], { database })).toEqual({
      sent: 0,
      failed: 0,
      queued: 0,
      dropped: 0,
    });
    expect(dbState.calls).toHaveLength(0);
  });

  it('reads the active webhooks of the organization once, and stops when there are none', async () => {
    withWebhooks();

    const events = [
      { eventType: 'lead.created' as const, data: { leadId: 'l1' } },
      { eventType: 'lead.updated' as const, data: { leadId: 'l1' } },
    ];
    expect(await triggerWebhookBatch(ORG_ID, events, { database })).toEqual({
      sent: 0,
      failed: 0,
      queued: 0,
      dropped: 0,
    });
    const [read] = calls('select', 'webhooks');
    expect(render(read.where).sql).toContain('"webhooks"."organization_id" = $1');
    expect(render(read.where).params).toEqual([ORG_ID, 'active']);
    expect(calls('select')).toHaveLength(1);
  });

  it('sends each event to the webhooks subscribed to it and counts the outcomes', async () => {
    const crm = webhook({
      id: 'wh-crm',
      url: 'https://crm.example.com/in',
      events: ['lead.created'],
    });
    const chat = webhook({
      id: 'wh-chat',
      url: 'https://chat.example.com/in',
      events: ['lead.created', 'lead.updated'],
    });
    withWebhooks(crm, chat);
    mocks.sendRequest.mockImplementation(async ({ url }: { url: URL }) =>
      url.hostname === 'chat.example.com'
        ? { status: 503, statusText: 'Unavailable', body: '' }
        : ok
    );

    const result = await triggerWebhookBatch(
      ORG_ID,
      [
        { eventType: 'lead.created', data: { leadId: 'l1' } },
        { eventType: 'lead.updated', data: { leadId: 'l1' } },
        // Nobody subscribes to this one
        { eventType: 'lead.deleted', data: { leadId: 'l2' } },
      ],
      { database }
    );

    expect(result).toEqual({ sent: 1, failed: 2, queued: 0, dropped: 0 });
    expect(
      calls('insert', 'webhook_deliveries').map((c) => [c.values?.webhookId, c.values?.eventType])
    ).toEqual([
      ['wh-crm', 'lead.created'],
      ['wh-chat', 'lead.created'],
      ['wh-chat', 'lead.updated'],
    ]);
    // A first attempt is stored as due after the lease, so a cut-off attempt is retried
    expect(calls('insert', 'webhook_deliveries')[0].values).toMatchObject({
      attempts: 1,
      nextRetryAt: new Date(NOW.getTime() + WEBHOOK_DELIVERY_LEASE_MS),
    });
  });

  it('counts a failed first attempt against the webhook and schedules the retry', async () => {
    withWebhooks(webhook());
    mocks.sendRequest.mockResolvedValue({ status: 502, statusText: 'Bad Gateway', body: '' });

    await triggerWebhookBatch(ORG_ID, [{ eventType: 'lead.created', data: {} }], { database });

    expect(attemptUpdates().map((c) => c.set)).toEqual([
      expect.objectContaining({
        status: 'pending',
        error: 'HTTP 502: Bad Gateway',
        attempts: 1,
        // retryDelayMs * 2^0 after the first attempt
        nextRetryAt: new Date(NOW.getTime() + 5000),
        completedAt: null,
      }),
    ]);
    const [counted] = calls('update', 'webhooks');
    expect(render(counted.set?.failureCount as SQL).sql).toBe('"webhooks"."failure_count" + 1');
    expect(counted.set).not.toHaveProperty('status');
  });

  it('marks the webhook failed when its tenth failure uses up the attempts', async () => {
    withWebhooks(webhook({ failureCount: 9, retryConfig: { maxRetries: 1, retryDelayMs: 1000 } }));
    mocks.sendRequest.mockResolvedValue({ status: 500, statusText: 'Error', body: '' });

    await triggerWebhookBatch(ORG_ID, [{ eventType: 'lead.created', data: {} }], { database });

    expect(attemptUpdates()[0].set).toMatchObject({ status: 'failed', nextRetryAt: null });
    expect(calls('update', 'webhooks')[0].set).toMatchObject({ status: 'failed' });
  });

  it('records a success on the webhook: last triggered, failure count reset', async () => {
    withWebhooks(webhook({ failureCount: 4 }));

    await triggerWebhookBatch(ORG_ID, [{ eventType: 'lead.created', data: {} }], { database });

    expect(attemptUpdates()[0].set).toMatchObject({ status: 'success', statusCode: 200 });
    // A first attempt never touches the status (only a successful retry brings a webhook back)
    expect(calls('update', 'webhooks').map((c) => c.set)).toEqual([
      { lastTriggeredAt: NOW, failureCount: 0, updatedAt: NOW },
    ]);
  });

  it('queues the deliveries for the retry processor once the time budget is used', async () => {
    withWebhooks(webhook());

    const result = await triggerWebhookBatch(
      ORG_ID,
      [
        { eventType: 'lead.created', data: { leadId: 'l1' } },
        { eventType: 'lead.created', data: { leadId: 'l2' } },
      ],
      { database, timeBudgetMs: 0 }
    );

    expect(result).toEqual({ sent: 0, failed: 0, queued: 2, dropped: 0 });
    expect(mocks.sendRequest).not.toHaveBeenCalled();
    expect(calls('insert', 'webhook_deliveries')[0].values).toMatchObject({
      attempts: 0,
      nextRetryAt: NOW,
    });
  });

  it('drops and counts the deliveries past the queue limit', async () => {
    withWebhooks(webhook());
    const events = Array.from({ length: WEBHOOK_BATCH_QUEUE_LIMIT + 3 }, (_, i) => ({
      eventType: 'lead.created' as WebhookEventType,
      data: { leadId: `l${i}` },
    }));

    expect(await triggerWebhookBatch(ORG_ID, events, { database, timeBudgetMs: 0 })).toEqual({
      sent: 0,
      failed: 0,
      queued: WEBHOOK_BATCH_QUEUE_LIMIT,
      dropped: 3,
    });
  });

  it('gives up an attempt whose destination check outlasts the timeout, and retries it later', async () => {
    vi.useFakeTimers({ now: NOW });
    withWebhooks(webhook());
    mocks.checkDestination.mockReturnValue(new Promise(() => undefined));

    const result = triggerWebhookBatch(ORG_ID, [{ eventType: 'lead.created', data: {} }], {
      database,
    });
    await vi.advanceTimersByTimeAsync(WEBHOOK_DELIVERY_TIMEOUT_MS);

    expect(await result).toEqual({ sent: 0, failed: 1, queued: 0, dropped: 0 });
    expect(mocks.sendRequest).not.toHaveBeenCalled();
    expect(attemptUpdates()[0].set).toMatchObject({
      status: 'pending',
      error: 'Request timed out',
    });
  });

  it('counts a delivery it could not store as failed and goes on', async () => {
    withWebhooks(webhook({ id: 'wh-a' }), webhook({ id: 'wh-b' }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const base = dbState.answer;
    dbState.answer = (call) => {
      if (call.op === 'insert' && call.values?.webhookId === 'wh-a') {
        throw new Error('connection reset');
      }
      return base(call);
    };

    expect(
      await triggerWebhookBatch(ORG_ID, [{ eventType: 'lead.created', data: {} }], { database })
    ).toEqual({ sent: 1, failed: 1, queued: 0, dropped: 0 });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to record webhook delivery:',
      expect.objectContaining({ message: 'connection reset' })
    );
  });
});

describe('processWebhookRetries', () => {
  type Delivery = {
    id: string;
    webhookId: string;
    attempts: number;
    payload: Record<string, unknown>;
  };

  const delivery = (id: string, webhookId: string, attempts: number): Delivery => ({
    id,
    webhookId,
    attempts,
    payload: {
      id: `event-${id}`,
      event: 'lead.created',
      timestamp: NOW.toISOString(),
      organizationId: ORG_ID,
      data: { leadId: 'l1' },
    },
  });

  /**
   * The processor's queries: the three clean-ups (expired, test, exhausted) answer `failed`
   * rows, each round's candidates come from `rounds`, claiming returns the claimed deliveries,
   * and the webhooks are read by id
   */
  function withRetryState({
    failed = [[], [], []] as { id: string }[][],
    rounds = [] as Delivery[][],
    hooks = [] as Webhook[],
  }) {
    const cleanups = [...failed];
    const pending = [...rounds];
    let claimed: Delivery[] = [];
    dbState.answer = (call) => {
      if (call.op === 'update' && call.table === 'webhook_deliveries' && call.set) {
        if (!('status' in call.set)) return claimed;
        if (!('attempts' in call.set)) return cleanups.shift() ?? [];
        return [];
      }
      if (call.op === 'select' && call.table === 'webhook_deliveries' && call.lock) {
        claimed = pending.shift() ?? [];
        return claimed.map(({ id }) => ({ id }));
      }
      if (call.op === 'select' && call.table === 'webhooks') return hooks;
      return [];
    };
  }

  it('fails expired, test and exhausted deliveries first and reports them', async () => {
    withRetryState({
      failed: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], [{ id: 'd' }, { id: 'e' }, { id: 'f' }]],
    });

    expect(await processWebhookRetries({ database })).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      exhausted: 3,
      expired: 2,
      testsFailed: 1,
    });

    const cleanups = calls('update', 'webhook_deliveries');
    expect(cleanups).toHaveLength(3);
    for (const cleanup of cleanups) {
      expect(cleanup.set).toEqual({ status: 'failed', nextRetryAt: null, completedAt: NOW });
    }
    // Only pending deliveries created before the cut-off age out
    expect(render(cleanups[0].where).params).toEqual([
      'pending',
      new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    ]);
    expect(mocks.sendRequest).not.toHaveBeenCalled();
  });

  it('claims due deliveries, counting the attempt and moving the lease, and sends them', async () => {
    const hook = webhook({ status: 'failed' });
    withRetryState({
      rounds: [
        [delivery('d1', 'wh-1', 2), delivery('d2', 'wh-gone', 2), delivery('d3', 'wh-1', 1)],
      ],
      hooks: [hook],
    });

    expect(await processWebhookRetries({ database, batchSize: 5 })).toEqual({
      processed: 3,
      succeeded: 2,
      // d2's webhook was deleted meanwhile
      failed: 1,
      exhausted: 0,
      expired: 0,
      testsFailed: 0,
    });

    const [candidates] = calls('select', 'webhook_deliveries').filter((c) => c.lock);
    expect(candidates.limit).toBe(5);
    expect(candidates.lock?.strength).toBe('update');
    expect(candidates.lock?.config).toMatchObject({ skipLocked: true });

    const [claim] = calls('update', 'webhook_deliveries').filter(
      (c) => c.set && !('status' in c.set)
    );
    expect(render(claim.set?.attempts as SQL).sql).toBe('"webhook_deliveries"."attempts" + 1');
    expect(claim.set?.nextRetryAt).toEqual(new Date(NOW.getTime() + WEBHOOK_DELIVERY_LEASE_MS));
    expect(render(claim.where).params).toEqual(['d1', 'd2', 'd3']);

    // The webhooks of the claimed deliveries are read once
    expect(render(calls('select', 'webhooks')[0].where).params).toEqual(['wh-1', 'wh-gone']);
    expect(mocks.sendRequest).toHaveBeenCalledTimes(2);
    expect(attemptUpdates().map((c) => [c.set?.status, c.set?.attempts])).toEqual([
      ['success', 2],
      ['success', 1],
    ]);
  });

  it('brings a failed webhook back after a successful retry, but not after a first attempt', async () => {
    withRetryState({
      rounds: [[delivery('d1', 'wh-1', 2)]],
      hooks: [webhook({ status: 'failed' })],
    });

    await processWebhookRetries({ database });

    const reactivate = calls('update', 'webhooks').filter((c) => c.set?.status === 'active');
    expect(reactivate).toHaveLength(1);
    // Only a webhook marked failed; one set inactive by the user stays inactive
    expect(render(reactivate[0].where).params).toEqual(['wh-1', 'failed']);

    dbState.calls = [];
    withRetryState({ rounds: [[delivery('d2', 'wh-1', 1)]], hooks: [webhook()] });
    await processWebhookRetries({ database });
    expect(calls('update', 'webhooks').filter((c) => c.set?.status === 'active')).toHaveLength(0);
  });

  it('backs off exponentially after a failed retry, without counting it against the webhook', async () => {
    withRetryState({ rounds: [[delivery('d1', 'wh-1', 2)]], hooks: [webhook()] });
    mocks.sendRequest.mockResolvedValue({ status: 500, statusText: 'Error', body: '' });

    expect(await processWebhookRetries({ database })).toMatchObject({ processed: 1, failed: 1 });

    expect(attemptUpdates()[0].set).toMatchObject({
      status: 'pending',
      attempts: 2,
      // retryDelayMs * 2^(2 - 1)
      nextRetryAt: new Date(NOW.getTime() + 10_000),
    });
    expect(calls('update', 'webhooks')).toHaveLength(0);
  });

  it('gives up after the last attempt and marks a webhook failing for the tenth time', async () => {
    withRetryState({
      rounds: [[delivery('d1', 'wh-1', 3)]],
      hooks: [webhook({ failureCount: 10 })],
    });
    mocks.sendRequest.mockResolvedValue({ status: 500, statusText: 'Error', body: '' });

    await processWebhookRetries({ database });

    expect(attemptUpdates()[0].set).toMatchObject({
      status: 'failed',
      attempts: 3,
      nextRetryAt: null,
      completedAt: NOW,
    });
    const [marked] = calls('update', 'webhooks');
    // A retry is not counted again; the webhook only gets the failed status
    expect(marked.set).toEqual({ status: 'failed', updatedAt: NOW });
  });

  it('gives up at once when the destination is refused', async () => {
    withRetryState({ rounds: [[delivery('d1', 'wh-1', 2)]], hooks: [webhook()] });
    mocks.checkDestination.mockResolvedValue({ ok: false, reason: 'host' });

    await processWebhookRetries({ database });

    expect(mocks.sendRequest).not.toHaveBeenCalled();
    expect(attemptUpdates()[0].set).toMatchObject({
      status: 'failed',
      error: `${DESTINATION_NOT_ALLOWED_ERROR} (host)`,
      nextRetryAt: null,
    });
  });

  it('works in rounds until nothing is due', async () => {
    withRetryState({
      rounds: [[delivery('d1', 'wh-1', 2)], [delivery('d2', 'wh-1', 2)]],
      hooks: [webhook()],
    });

    expect(await processWebhookRetries({ database, batchSize: 1 })).toMatchObject({
      processed: 2,
      succeeded: 2,
    });
    // Two rounds with deliveries and a third that found none
    expect(calls('select', 'webhook_deliveries').filter((c) => c.lock)).toHaveLength(3);
  });

  it('starts no round that could not finish within the time budget', async () => {
    withRetryState({ rounds: [[delivery('d1', 'wh-1', 2)]], hooks: [webhook()] });

    expect(await processWebhookRetries({ database, timeBudgetMs: 5000 })).toMatchObject({
      processed: 0,
    });
    expect(calls('select', 'webhook_deliveries').filter((c) => c.lock)).toHaveLength(0);
  });

  it('counts a retry it could not record as failed', async () => {
    withRetryState({ rounds: [[delivery('d1', 'wh-1', 2)]], hooks: [webhook()] });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const base = dbState.answer;
    dbState.answer = (call) => {
      if (call.op === 'update' && call.set && 'attempts' in call.set && 'status' in call.set) {
        throw new Error('connection reset');
      }
      return base(call);
    };

    expect(await processWebhookRetries({ database })).toMatchObject({
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to record webhook retry:',
      expect.objectContaining({ message: 'connection reset' })
    );
  });
});
