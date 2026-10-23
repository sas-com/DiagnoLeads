/**
 * Webhook test sends (#321) on a real PostgreSQL:
 * - a test send is tried once: a failure is not retried, does not count towards failureCount
 *   and does not deactivate the webhook
 * - a test delivery left pending (cut off mid-way, or stored before #321) is failed by the retry
 *   processor instead of being sent again
 * - test sends are limited per webhook (from the delivery records), per organization and per
 *   user (in public_rate_limits); over a limit the procedure answers TOO_MANY_REQUESTS and
 *   stores nothing
 * - deleting and recreating webhooks does not reset the organization limit; the user limit
 *   counts across organizations; concurrent requests cannot pass the limit
 * - a webhook whose URL is refused gets no request, the delivery stores a fixed message, and the
 *   retry processor ends such a delivery instead of retrying it
 * The HTTP side is a stubbed fetch and DNS is mocked. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/webhook-test-send.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  organizationMembers,
  organizations,
  publicRateLimits,
  users,
  webhookDeliveries,
  webhooks,
} from '@/lib/db/schema';
import { rateLimitKey } from '@/lib/features/diagnostics/rate-limit';
import {
  WEBHOOK_TEST_MESSAGE,
  WEBHOOK_TEST_SEND_LIMITS,
  processWebhookRetries,
} from '@/lib/features/webhooks/services/webhook-service';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// Host names resolve to a public address: no real DNS lookup
vi.mock('node:dns/promises', () => {
  const lookup = async () => [{ address: '93.184.215.14', family: 4 }];
  return { lookup, default: { lookup } };
});

// Deliveries go through the pinned transport (#330); it is replaced by one that calls the
// fetch stub below
vi.mock('@/lib/features/webhooks/services/pinned-request', async () =>
  (await import('@/test/mocks/webhook-transport')).transportThroughFetchStub()
);

const url = process.env.TEST_DATABASE_URL;

type Caller = ReturnType<typeof appRouter.createCaller>;

describe.skipIf(!url)('webhook test sends (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 8 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  let org: string;
  let otherOrg: string;
  let thirdOrg: string;
  let userId: string;
  let first: string;
  let second: string;
  let foreign: string;
  let admin: Caller;
  const fetchMock = vi.fn();

  const answer = (status: number) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status < 300 ? 'OK' : 'Error',
    text: async () => '',
  });

  async function createWebhook(organizationId: string, name: string, webhookUrl?: string) {
    const [row] = await pg
      .insert(webhooks)
      .values({
        organizationId,
        name,
        url: webhookUrl ?? `https://hooks.example.com/${unique()}`,
        secret: 'whsec_test',
        events: ['diagnostic.submitted'],
      })
      .returning();
    return row.id;
  }

  /** A stored delivery: a test send (as now, or as stored before #321) or an event */
  async function storeDelivery(
    webhookId: string,
    kind: 'test' | 'legacy-test' | 'event',
    values: { createdAt?: Date; status?: 'pending' | 'success' | 'failed'; nextRetryAt?: Date | null } = {}
  ) {
    const payload =
      kind === 'test'
        ? { id: unique(), event: 'diagnostic.submitted', test: true, data: { test: true } }
        : kind === 'legacy-test'
          ? {
              id: unique(),
              event: 'diagnostic.submitted',
              data: { test: true, message: WEBHOOK_TEST_MESSAGE },
            }
          : { id: unique(), event: 'diagnostic.submitted', data: { leadId: 'made-up' } };
    const [row] = await pg
      .insert(webhookDeliveries)
      .values({
        webhookId,
        eventType: 'diagnostic.submitted',
        payload,
        status: values.status ?? 'success',
        attempts: 1,
        nextRetryAt: values.nextRetryAt ?? null,
        ...(values.createdAt ? { createdAt: values.createdAt } : {}),
      })
      .returning();
    return row.id;
  }

  const deliveriesOf = (...ids: string[]) =>
    pg.select().from(webhookDeliveries).where(inArray(webhookDeliveries.webhookId, ids));

  const webhookRow = async (id: string) =>
    (await pg.select().from(webhooks).where(eq(webhooks.id, id)))[0];

  /** IDs of the deliveries sent, from the X-Webhook-ID header */
  const sentIds = () =>
    fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit & { headers: Record<string, string> }).headers['X-Webhook-ID']
    );

  beforeAll(async () => {
    const [a] = await pg
      .insert(organizations)
      .values({ name: 'テスト送信株式会社', slug: `test-send-${unique()}` })
      .returning();
    const [b] = await pg
      .insert(organizations)
      .values({ name: '別組織株式会社', slug: `test-send-other-${unique()}` })
      .returning();
    const [c] = await pg
      .insert(organizations)
      .values({ name: '三番目株式会社', slug: `test-send-third-${unique()}` })
      .returning();
    org = a.id;
    otherOrg = b.id;
    thirdOrg = c.id;

    const [user] = await pg
      .insert(users)
      .values({ email: `test-send-${unique()}@example.com`, name: 'テスト送信 管理者' })
      .returning();
    userIds.push(user.id);
    userId = user.id;
    // An admin of all three organizations: the per-user limit counts across them
    await pg.insert(organizationMembers).values(
      [org, otherOrg, thirdOrg].map((organizationId) => ({
        organizationId,
        userId: user.id,
        role: 'admin' as const,
      }))
    );
    admin = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  });

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(200));
    await pg.delete(webhooks).where(inArray(webhooks.organizationId, [org, otherOrg, thirdOrg]));
    // Each test starts with fresh organization and user windows
    const { perOrganization, perUser } = WEBHOOK_TEST_SEND_LIMITS;
    await pg
      .delete(publicRateLimits)
      .where(
        inArray(publicRateLimits.key, [
          ...[org, otherOrg, thirdOrg].map((id) => rateLimitKey(perOrganization, id)),
          rateLimitKey(perUser, userId),
        ])
      );
    first = await createWebhook(org, '最初の連携');
    second = await createWebhook(org, '二番目の連携');
    foreign = await createWebhook(otherOrg, '別組織の連携');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, [org, otherOrg, thirdOrg]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  describe('not retried', () => {
    it('a failed test send is failed at once and leaves the webhook as it was', async () => {
      await pg.update(webhooks).set({ failureCount: 9 }).where(eq(webhooks.id, first));
      fetchMock.mockResolvedValue(answer(503));

      const result = await admin.webhooks.test({ organizationId: org, id: first });
      expect(result).toEqual({ success: false, triggered: 0, failed: 1 });

      const [delivery] = await deliveriesOf(first);
      expect(delivery).toMatchObject({
        status: 'failed',
        attempts: 1,
        nextRetryAt: null,
        statusCode: 503,
      });
      expect(delivery.completedAt).not.toBeNull();
      expect(delivery.payload).toMatchObject({ test: true });

      // One more failure would have deactivated an event delivery's webhook; a test send does not
      const webhook = await webhookRow(first);
      expect(webhook.failureCount).toBe(9);
      expect(webhook.status).toBe('active');
      expect(webhook.lastTriggeredAt).toBeNull();

      await processWebhookRetries({ database: pg });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await deliveriesOf(first))[0].attempts).toBe(1);
    });

    it('a successful test send does not reset the failure count either', async () => {
      await pg.update(webhooks).set({ failureCount: 4 }).where(eq(webhooks.id, first));

      const result = await admin.webhooks.test({ organizationId: org, id: first });
      expect(result.success).toBe(true);
      expect((await webhookRow(first)).failureCount).toBe(4);
    });

    it('fails a test delivery left pending (cut off, or stored before #321) instead of sending it', async () => {
      const due = new Date(Date.now() - 1000);
      const cutOff = await storeDelivery(first, 'test', { status: 'pending', nextRetryAt: due });
      const legacy = await storeDelivery(first, 'legacy-test', {
        status: 'pending',
        nextRetryAt: due,
      });
      const event = await storeDelivery(second, 'event', { status: 'pending', nextRetryAt: due });

      await processWebhookRetries({ database: pg });

      expect(sentIds()).toContain(event);
      expect(sentIds()).not.toContain(cutOff);
      expect(sentIds()).not.toContain(legacy);
      const rows = await deliveriesOf(first);
      for (const row of rows) {
        expect(row).toMatchObject({ status: 'failed', nextRetryAt: null, attempts: 1 });
      }
    });

    it('an event delivery with test-like data is still retried', async () => {
      // Only the payload marker (or the exact pre-#321 test data) makes a test delivery
      const [row] = await pg
        .insert(webhookDeliveries)
        .values({
          webhookId: first,
          eventType: 'diagnostic.submitted',
          payload: { id: unique(), event: 'diagnostic.submitted', data: { test: true } },
          status: 'pending',
          attempts: 1,
          nextRetryAt: new Date(Date.now() - 1000),
        })
        .returning();

      await processWebhookRetries({ database: pg });

      expect(sentIds()).toContain(row.id);
    });
  });

  describe('rate limit', () => {
    const { perWebhook, perOrganization, perUser } = WEBHOOK_TEST_SEND_LIMITS;

    it(`allows ${perWebhook.limit} test sends per webhook in ${perWebhook.windowMs / 60_000} minutes, then answers TOO_MANY_REQUESTS`, async () => {
      for (let i = 0; i < perWebhook.limit; i++) {
        await expect(admin.webhooks.test({ organizationId: org, id: first })).resolves.toMatchObject({
          success: true,
        });
      }
      await expect(admin.webhooks.test({ organizationId: org, id: first })).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringMatching(/^test_rate_limited:.*per webhook/),
      });

      // Nothing stored or sent for the refused request
      expect(await deliveriesOf(first)).toHaveLength(perWebhook.limit);
      expect(fetchMock).toHaveBeenCalledTimes(perWebhook.limit);
      // Another webhook of the organization still has its own allowance
      await expect(admin.webhooks.test({ organizationId: org, id: second })).resolves.toMatchObject({
        success: true,
      });
    });

    it('counts older test sends only within the window', async () => {
      const outside = new Date(Date.now() - perWebhook.windowMs - 60_000);
      for (let i = 0; i < perWebhook.limit; i++) {
        await storeDelivery(first, 'test', { createdAt: outside });
      }
      await expect(admin.webhooks.test({ organizationId: org, id: first })).resolves.toMatchObject({
        success: true,
      });
    });

    /** Send `count` tests in the organization, spread over new webhooks below the per-webhook limit */
    async function sendTests(organizationId: string, count: number) {
      for (let i = 0; i < count; i++) {
        if (i % perWebhook.limit === 0) spreadWebhook = await createWebhook(organizationId, `連携 ${i}`);
        await expect(
          admin.webhooks.test({ organizationId, id: spreadWebhook })
        ).resolves.toMatchObject({ success: true });
      }
    }
    let spreadWebhook = '';

    it(`allows ${perOrganization.limit} test sends per organization in an hour`, async () => {
      await sendTests(org, perOrganization.limit);

      await expect(admin.webhooks.test({ organizationId: org, id: first })).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringMatching(/^test_rate_limited:.*per organization/),
      });
      expect(await deliveriesOf(first)).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(perOrganization.limit);
    });

    it('does not reset the organization limit when webhooks are deleted and created again', async () => {
      await sendTests(org, perOrganization.limit);
      // Deleting the webhooks deletes their deliveries too
      await pg.delete(webhooks).where(eq(webhooks.organizationId, org));
      const recreated = await createWebhook(org, '作り直した連携');

      await expect(
        admin.webhooks.test({ organizationId: org, id: recreated })
      ).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringMatching(/^test_rate_limited:.*per organization/),
      });
      expect(await deliveriesOf(recreated)).toHaveLength(0);
    });

    it(`allows ${perUser.limit} test sends per user in an hour, across organizations`, async () => {
      // Two organizations at their own limit make up the user's limit
      await sendTests(org, perOrganization.limit);
      await sendTests(otherOrg, perUser.limit - perOrganization.limit);
      const fresh = await createWebhook(thirdOrg, '三番目の連携');

      await expect(
        admin.webhooks.test({ organizationId: thirdOrg, id: fresh })
      ).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringMatching(/^test_rate_limited:.*per user/),
      });
      expect(await deliveriesOf(fresh)).toHaveLength(0);
      // Refused by the user limit: the third organization's allowance is not used up
      const thirdWindow = await pg
        .select()
        .from(publicRateLimits)
        .where(eq(publicRateLimits.key, rateLimitKey(perOrganization, thirdOrg)));
      expect(thirdWindow).toHaveLength(0);
    });

    it("does not count another organization's sends, nor event deliveries", async () => {
      await sendTests(otherOrg, perOrganization.limit);
      for (let i = 0; i < perWebhook.limit; i++) {
        await storeDelivery(first, 'event');
      }

      await expect(admin.webhooks.test({ organizationId: org, id: first })).resolves.toMatchObject({
        success: true,
      });
    });

    it('a request refused per webhook uses up neither the organization nor the user limit', async () => {
      for (let i = 0; i < perWebhook.limit; i++) {
        await storeDelivery(first, i % 2 === 0 ? 'test' : 'legacy-test');
      }
      await expect(admin.webhooks.test({ organizationId: org, id: first })).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringMatching(/per webhook/),
      });
      const windows = await pg
        .select()
        .from(publicRateLimits)
        .where(
          inArray(publicRateLimits.key, [
            rateLimitKey(perOrganization, org),
            rateLimitKey(perUser, userId),
          ])
        );
      expect(windows).toHaveLength(0);
    });

    it('does not let concurrent requests pass the limit', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: perWebhook.limit + 3 }, () =>
          admin.webhooks.test({ organizationId: org, id: first })
        )
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter(
        (r) =>
          r.status === 'rejected' && (r.reason as { code?: string }).code === 'TOO_MANY_REQUESTS'
      );
      expect(fulfilled).toHaveLength(perWebhook.limit);
      expect(refused).toHaveLength(3);
      expect(await deliveriesOf(first)).toHaveLength(perWebhook.limit);
    });

    it("cannot test another organization's webhook", async () => {
      await expect(admin.webhooks.test({ organizationId: org, id: foreign })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await deliveriesOf(foreign)).toHaveLength(0);
    });
  });

  describe('refused destinations', () => {
    it('stores a webhook saved before #321 with an internal URL, but never sends to it', async () => {
      const internal = await createWebhook(org, '社内宛ての連携', 'https://169.254.169.254/latest');

      const result = await admin.webhooks.test({ organizationId: org, id: internal });
      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      const [delivery] = await deliveriesOf(internal);
      expect(delivery).toMatchObject({
        status: 'failed',
        error: 'Destination not allowed (address)',
      });

      // The manager sees why on the settings page; the webhook itself is kept
      const list = await admin.webhooks.list({ organizationId: org, limit: 100 });
      expect(list.webhooks.find((w) => w.id === internal)?.urlRefusal).toBe('address');
      expect(list.webhooks.find((w) => w.id === first)?.urlRefusal).toBeNull();
    });

    it('the retry processor ends a delivery to a refused destination instead of retrying it', async () => {
      const internal = await createWebhook(org, '社内宛ての連携', 'https://10.0.0.8/hook');
      const [pending] = await pg
        .insert(webhookDeliveries)
        .values({
          webhookId: internal,
          eventType: 'diagnostic.submitted',
          payload: { id: unique(), event: 'diagnostic.submitted', data: { leadId: 'made-up' } },
          status: 'pending',
          attempts: 1,
          nextRetryAt: new Date(Date.now() - 1000),
        })
        .returning();

      await processWebhookRetries({ database: pg });
      expect(sentIds()).not.toContain(pending.id);
      const [row] = await deliveriesOf(internal);
      expect(row).toMatchObject({
        status: 'failed',
        attempts: 2,
        nextRetryAt: null,
        error: 'Destination not allowed (address)',
      });
      expect(row.completedAt).not.toBeNull();

      // Not picked up again by a later run
      await processWebhookRetries({ database: pg });
      expect((await deliveriesOf(internal))[0].attempts).toBe(2);
      expect(sentIds()).not.toContain(pending.id);
    });

    it('refuses to create a webhook for an internal URL', async () => {
      await expect(
        admin.webhooks.create({
          organizationId: org,
          name: '社内宛て',
          url: 'https://[::ffff:127.0.0.1]/hook',
          events: ['diagnostic.submitted'],
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const rows = await pg.select().from(webhooks).where(eq(webhooks.organizationId, org));
      expect(rows.map((w) => w.name)).not.toContain('社内宛て');
    });
  });
});
