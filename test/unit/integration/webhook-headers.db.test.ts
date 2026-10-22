/**
 * Webhook custom headers, delivery responses and the test send (#314) on a real PostgreSQL:
 * - list / get never return a header value, whatever the role
 * - an update keeps a stored value unless a new one is given, and drops a removed name
 * - a delivery still sends the stored values
 * - the receiver's response body and the error text are shown to those who manage webhooks;
 *   members see the outcome only
 * - the test send reaches the chosen webhook only, even when another one subscribes to the event
 * - any change of the URL requires every header value again (S1)
 * - an update that met another change between its read and its write answers CONFLICT
 * - another organization's webhook is not found, and its deliveries are not listed
 * The HTTP side is a stubbed fetch. All names and values are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/webhook-headers.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  type OrganizationRole,
  organizationMembers,
  organizations,
  users,
  webhookDeliveries,
  webhooks,
} from '@/lib/db/schema';
import { WEBHOOK_HEADER_MASK } from '@/lib/features/webhooks/services/webhook-headers';
import { appRouter } from '@/server/routers/_app';
import { type SQL, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// Host names resolve to a public address: no real DNS lookup (#321)
vi.mock('node:dns/promises', () => {
  const lookup = async () => [{ address: '93.184.215.14', family: 4 }];
  return { lookup, default: { lookup } };
});

const url = process.env.TEST_DATABASE_URL;

const TOKEN = 'Bearer made-up-token-314';
const TENANT = 'tenant-made-up-314';

type Caller = ReturnType<typeof appRouter.createCaller>;

describe.skipIf(!url)('webhook headers and test send (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  let org: string;
  let chosen: string;
  let other: string;
  const callers = {} as Record<'owner' | 'admin' | 'member' | 'group_owner', Caller>;
  const fetchMock = vi.fn();

  async function createWebhook(
    name: string,
    headers: Record<string, string>,
    organizationId: string = org
  ) {
    const [row] = await pg
      .insert(webhooks)
      .values({
        organizationId,
        name,
        url: `https://hooks.example.com/${unique()}`,
        secret: 'whsec_test',
        events: ['diagnostic.submitted'],
        headers,
      })
      .returning();
    return row.id;
  }

  async function callerAs(role: OrganizationRole, database: typeof pg = pg): Promise<Caller> {
    const [user] = await pg
      .insert(users)
      .values({ email: `headers-${role}-${unique()}@example.com`, name: `ヘッダー ${role}` })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role });
    return appRouter.createCaller({
      db: database,
      session: { session: { id: 's', userId: user.id }, user },
      user,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }

  const storedHeaders = async (id: string) =>
    (await pg.select({ headers: webhooks.headers }).from(webhooks).where(eq(webhooks.id, id)))[0]
      ?.headers;

  beforeAll(async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: 'ヘッダーテスト株式会社', slug: `headers-${unique()}` })
      .returning();
    org = row.id;
    chosen = await createWebhook('選んだ連携', { Authorization: TOKEN, 'X-Tenant': TENANT });
    other = await createWebhook('別の連携', { Authorization: 'Bearer made-up-other' });
    for (const role of ['owner', 'admin', 'member', 'group_owner'] as const) {
      callers[role] = await callerAs(role);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const otherOrganizations: string[] = [];

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, [org, ...otherOrganizations]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  for (const role of ['owner', 'admin', 'member', 'group_owner'] as const) {
    it(`list and get return header names only to ${role}`, async () => {
      const list = await callers[role].webhooks.list({ organizationId: org, limit: 100 });
      const one = await callers[role].webhooks.get({ organizationId: org, id: chosen });

      for (const result of [list, one]) {
        expect(JSON.stringify(result)).not.toContain('made-up');
      }
      expect(one.headers).toEqual([
        { name: 'Authorization', masked: true },
        { name: 'X-Tenant', masked: true },
      ]);
    });
  }

  it('an update keeps masked values, replaces new ones and removes dropped names', async () => {
    const id = await createWebhook('更新する連携', {
      Authorization: 'Bearer made-up-old',
      'X-Keep': 'keep-made-up',
      'X-Drop': 'drop-made-up',
    });

    const result = await callers.admin.webhooks.update({
      organizationId: org,
      id,
      headers: [
        { name: 'Authorization', value: 'Bearer made-up-new' },
        { name: 'X-Keep' },
        { name: 'X-Added', value: 'added-made-up' },
      ],
    });

    expect(JSON.stringify(result)).not.toContain('made-up');
    expect(await storedHeaders(id)).toEqual({
      Authorization: 'Bearer made-up-new',
      'X-Keep': 'keep-made-up',
      'X-Added': 'added-made-up',
    });

    // Saving the edit form unchanged sends every name without a value: nothing changes
    await callers.admin.webhooks.update({
      organizationId: org,
      id,
      headers: [{ name: 'Authorization' }, { name: 'X-Keep' }, { name: 'X-Added' }],
    });
    expect(await storedHeaders(id)).toEqual({
      Authorization: 'Bearer made-up-new',
      'X-Keep': 'keep-made-up',
      'X-Added': 'added-made-up',
    });
  });

  it('the test send makes one delivery, to the chosen webhook, with the stored header values', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{"made-up":"receiver answer"}',
    });

    const result = await callers.admin.webhooks.test({ organizationId: org, id: chosen });
    expect(result).toEqual({ success: true, triggered: 1, failed: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: TOKEN, 'X-Tenant': TENANT });

    const deliveries = await pg
      .select()
      .from(webhookDeliveries)
      .where(inArray(webhookDeliveries.webhookId, [chosen, other]));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      webhookId: chosen,
      eventType: 'diagnostic.submitted',
      status: 'success',
      response: '{"made-up":"receiver answer"}',
    });
  });

  it('shows the response body to a manager, the outcome only to a member', async () => {
    const asMember = await callers.member.webhooks.deliveries({
      organizationId: org,
      webhookId: chosen,
    });
    expect(asMember.canViewDetails).toBe(false);
    expect(asMember.deliveries).toHaveLength(1);
    expect(asMember.deliveries[0]).toMatchObject({
      status: 'success',
      statusCode: 200,
      attempts: 1,
      response: null,
      error: null,
    });
    expect(JSON.stringify(asMember)).not.toContain('receiver answer');

    const asAdmin = await callers.admin.webhooks.deliveries({
      organizationId: org,
      webhookId: chosen,
    });
    expect(asAdmin.canViewDetails).toBe(true);
    expect(asAdmin.deliveries[0].response).toBe('{"made-up":"receiver answer"}');
  });

  it('hides the error text of a failed delivery from a member', async () => {
    const id = await createWebhook('失敗する連携', {});
    await pg.insert(webhookDeliveries).values({
      webhookId: id,
      eventType: 'diagnostic.submitted',
      payload: { id: unique(), event: 'diagnostic.submitted', data: {} },
      status: 'failed',
      statusCode: 502,
      error: 'HTTP 502: made-up upstream internals',
      response: 'made-up proxy page',
      attempts: 3,
      completedAt: new Date(),
    });

    const asMember = await callers.member.webhooks.deliveries({ organizationId: org, webhookId: id });
    expect(asMember.canViewDetails).toBe(false);
    expect(asMember.deliveries).toHaveLength(1);
    expect(asMember.deliveries[0]).toMatchObject({
      status: 'failed',
      statusCode: 502,
      attempts: 3,
      error: null,
      response: null,
    });
    expect(asMember.deliveries[0].createdAt).toBeInstanceOf(Date);
    expect(asMember.deliveries[0].completedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(asMember)).not.toContain('made-up');

    const asOwner = await callers.owner.webhooks.deliveries({ organizationId: org, webhookId: id });
    expect(asOwner.canViewDetails).toBe(true);
    expect(asOwner.deliveries[0]).toMatchObject({
      error: 'HTTP 502: made-up upstream internals',
      response: 'made-up proxy page',
    });
  });

  describe("moving the URL to another origin (S1)", () => {
    const stored = { Authorization: 'Bearer made-up-s1', 'X-Tenant': 'tenant-made-up-s1' };
    const rowOf = async (id: string) =>
      (await pg.select().from(webhooks).where(eq(webhooks.id, id)))[0];

    it('refuses to keep stored values, missing or masked, and changes nothing', async () => {
      const id = await createWebhook('移す連携', stored);
      const before = await rowOf(id);

      for (const headers of [
        undefined,
        [{ name: 'Authorization' }, { name: 'X-Tenant', value: 'new' }],
        [
          { name: 'Authorization', value: WEBHOOK_HEADER_MASK },
          { name: 'X-Tenant', value: 'new' },
        ],
      ]) {
        await expect(
          callers.admin.webhooks.update({
            organizationId: org,
            id,
            url: 'https://collector.example.net/steal',
            headers,
          })
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: expect.stringMatching(/^headers_reentry_required:/),
        });
      }

      const after = await rowOf(id);
      expect(after.url).toBe(before.url);
      expect(after.headers).toEqual(stored);
    });

    it('accepts the move with every value entered again', async () => {
      const id = await createWebhook('移す連携2', stored);
      await callers.admin.webhooks.update({
        organizationId: org,
        id,
        url: 'https://new-receiver.example.org/hook',
        headers: [
          { name: 'authorization', value: 'Bearer made-up-new-receiver' },
          { name: 'X-Tenant', value: 'tenant-new' },
        ],
      });
      const after = await rowOf(id);
      expect(after.url).toBe('https://new-receiver.example.org/hook');
      expect(after.headers).toEqual({
        authorization: 'Bearer made-up-new-receiver',
        'X-Tenant': 'tenant-new',
      });
    });

    it('refuses to keep stored values when only the path or query changes', async () => {
      const id = await createWebhook('パスだけ変える連携', stored);
      const before = await rowOf(id);
      // A shared receiver tells its users apart by path
      for (const url of [`${new URL(before.url).origin}/another-path`, `${before.url}?x=1`]) {
        await expect(
          callers.admin.webhooks.update({
            organizationId: org,
            id,
            url,
            headers: [{ name: 'Authorization' }, { name: 'X-Tenant', value: WEBHOOK_HEADER_MASK }],
          })
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: expect.stringMatching(/^headers_reentry_required:/),
        });
      }
      const after = await rowOf(id);
      expect(after.url).toBe(before.url);
      expect(after.headers).toEqual(stored);
    });

    it('keeps stored values when the same URL is sent again, or none; a case-only rename keeps the value', async () => {
      const id = await createWebhook('同じURLの連携', stored);
      const before = await rowOf(id);
      const parsed = new URL(before.url);
      const sameUrlWritten = `${parsed.protocol}//${parsed.host.toUpperCase()}:443${parsed.pathname}`;

      for (const url of [before.url, sameUrlWritten, undefined]) {
        await callers.admin.webhooks.update({
          organizationId: org,
          id,
          url,
          headers: [{ name: 'AUTHORIZATION' }, { name: 'X-Tenant', value: WEBHOOK_HEADER_MASK }],
        });
        expect((await rowOf(id)).headers).toEqual({
          AUTHORIZATION: 'Bearer made-up-s1',
          'X-Tenant': 'tenant-made-up-s1',
        });
      }
    });
  });

  describe("another organization's webhook", () => {
    let foreignWebhook: string;
    const FOREIGN_VALUE = 'Bearer made-up-foreign';

    beforeAll(async () => {
      const [row] = await pg
        .insert(organizations)
        .values({ name: '別組織テスト株式会社', slug: `headers-other-${unique()}` })
        .returning();
      otherOrganizations.push(row.id);
      foreignWebhook = await createWebhook('別組織の連携', { Authorization: FOREIGN_VALUE }, row.id);
      await pg.insert(webhookDeliveries).values({
        webhookId: foreignWebhook,
        eventType: 'diagnostic.submitted',
        payload: { id: unique(), event: 'diagnostic.submitted', data: {} },
        status: 'failed',
        error: 'made-up foreign error',
        attempts: 1,
      });
    });

    it('get, update, test and delete answer NOT_FOUND and change nothing', async () => {
      vi.stubGlobal('fetch', fetchMock);
      const ref = { organizationId: org, id: foreignWebhook };
      for (const call of [
        () => callers.owner.webhooks.get(ref),
        () =>
          callers.owner.webhooks.update({
            ...ref,
            name: '乗っ取り',
            headers: [{ name: 'Authorization', value: 'Bearer made-up-hijack' }],
          }),
        () => callers.owner.webhooks.test(ref),
        () => callers.owner.webhooks.delete(ref),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }

      expect(fetchMock).not.toHaveBeenCalled();
      const [row] = await pg.select().from(webhooks).where(eq(webhooks.id, foreignWebhook));
      expect(row.name).toBe('別組織の連携');
      expect(row.headers).toEqual({ Authorization: FOREIGN_VALUE });
      const deliveries = await pg
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, foreignWebhook));
      expect(deliveries).toHaveLength(1);
    });

    it('lists none of its deliveries', async () => {
      const result = await callers.owner.webhooks.deliveries({
        organizationId: org,
        webhookId: foreignWebhook,
      });
      expect(result.deliveries).toEqual([]);
    });
  });

  describe('a change between the read and the write (B)', () => {
    /**
     * The database, except that the router's UPDATE first runs `beforeWrite`: another tab's
     * change lands after the router has read the row and before it writes
     */
    function racingDatabase(beforeWrite: () => Promise<unknown>): typeof pg {
      return new Proxy(pg, {
        get(target, prop, receiver) {
          if (prop !== 'update') return Reflect.get(target, prop, receiver);
          return (table: typeof webhooks) => ({
            set: (values: Partial<typeof webhooks.$inferInsert>) => ({
              where: (condition: SQL | undefined) => ({
                returning: async () => {
                  await beforeWrite();
                  return target.update(table).set(values).where(condition).returning();
                },
              }),
            }),
          });
        },
      });
    }

    const rowOf = async (id: string) =>
      (await pg.select().from(webhooks).where(eq(webhooks.id, id)))[0];

    it('answers CONFLICT and leaves the other change in place when the URL moved meanwhile', async () => {
      const id = await createWebhook('競合する連携', { Authorization: 'Bearer made-up-race' });
      const caller = await callerAs(
        'admin',
        racingDatabase(() =>
          pg
            .update(webhooks)
            .set({ url: 'https://moved.example.org/hook', headers: {}, updatedAt: new Date() })
            .where(eq(webhooks.id, id))
        )
      );

      await expect(
        caller.webhooks.update({
          organizationId: org,
          id,
          name: '古い画面からの保存',
          headers: [{ name: 'Authorization' }],
        })
      ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/^conflict:/) });

      const after = await rowOf(id);
      expect(after.name).toBe('競合する連携');
      expect(after.url).toBe('https://moved.example.org/hook');
      expect(after.headers).toEqual({});
    });

    it('answers CONFLICT when only the headers changed meanwhile', async () => {
      const id = await createWebhook('ヘッダーが変わる連携', { Authorization: 'Bearer made-up-race' });
      const caller = await callerAs(
        'admin',
        racingDatabase(() =>
          pg
            .update(webhooks)
            .set({ headers: { Authorization: 'Bearer made-up-other-tab' }, updatedAt: new Date() })
            .where(eq(webhooks.id, id))
        )
      );

      await expect(
        caller.webhooks.update({ organizationId: org, id, status: 'inactive' })
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const after = await rowOf(id);
      expect(after.status).toBe('active');
      expect(after.headers).toEqual({ Authorization: 'Bearer made-up-other-tab' });
    });

    it('does not conflict with a delivery recorded meanwhile', async () => {
      const id = await createWebhook('配信中の連携', { Authorization: 'Bearer made-up-race' });
      const caller = await callerAs(
        'admin',
        // What a delivery writes: counters and updated_at, not the URL or the headers
        racingDatabase(() =>
          pg
            .update(webhooks)
            .set({ lastTriggeredAt: new Date(), failureCount: 0, updatedAt: new Date() })
            .where(eq(webhooks.id, id))
        )
      );

      await caller.webhooks.update({ organizationId: org, id, name: '保存できる' });
      const after = await rowOf(id);
      expect(after.name).toBe('保存できる');
      expect(after.headers).toEqual({ Authorization: 'Bearer made-up-race' });
    });

    it('moves updated_at on every update', async () => {
      const id = await createWebhook('更新日時の連携', {});
      const before = await rowOf(id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await callers.admin.webhooks.update({ organizationId: org, id, name: '更新日時2' });
      expect((await rowOf(id)).updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    });
  });
});
