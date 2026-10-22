/**
 * Webhook delivery history on a real PostgreSQL: whatever the filters (webhook, status), a member
 * sees only the deliveries of their own organization's webhooks. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/webhook-deliveries.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  organizationMembers,
  organizations,
  users,
  webhookDeliveries,
  webhooks,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('webhook deliveries (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let orgA: string;
  let webhookA: string;
  let webhookB: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let callerA: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `deliveries-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function createWebhook(organizationId: string) {
    const [row] = await pg
      .insert(webhooks)
      .values({
        organizationId,
        name: '架空の連携',
        url: `https://hooks.example.com/${unique()}`,
        secret: 'whsec_test',
        events: ['diagnostic.submitted'],
      })
      .returning();
    return row.id;
  }

  async function createDelivery(webhookId: string, status: 'pending' | 'success' | 'failed') {
    await pg.insert(webhookDeliveries).values({
      webhookId,
      eventType: 'diagnostic.submitted',
      payload: { id: unique(), event: 'diagnostic.submitted', data: {} },
      status,
      attempts: 1,
    });
  }

  beforeAll(async () => {
    orgA = await createOrganization('配信履歴テストA株式会社');
    const orgB = await createOrganization('配信履歴テストB株式会社');
    webhookA = await createWebhook(orgA);
    webhookB = await createWebhook(orgB);
    for (const status of ['success', 'failed'] as const) {
      await createDelivery(webhookA, status);
      await createDelivery(webhookB, status);
    }

    const [user] = await pg
      .insert(users)
      .values({ email: `deliveries-${unique()}@example.com`, name: '配信 太郎' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId: orgA, userId: user.id, role: 'member' });
    callerA = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  const webhookIdsOf = (result: { deliveries: { webhookId: string }[] }) => [
    ...new Set(result.deliveries.map((d) => d.webhookId)),
  ];

  it('lists only the own organization without filters', async () => {
    const result = await callerA.webhooks.deliveries({ organizationId: orgA, limit: 100 });
    expect(webhookIdsOf(result)).toEqual([webhookA]);
    expect(result.deliveries).toHaveLength(2);
  });

  it('keeps the organization scope with a status filter', async () => {
    const result = await callerA.webhooks.deliveries({
      organizationId: orgA,
      status: 'success',
      limit: 100,
    });
    expect(webhookIdsOf(result)).toEqual([webhookA]);
    expect(result.deliveries.map((d: { status: string }) => d.status)).toEqual(['success']);
  });

  it("returns nothing for another organization's webhook", async () => {
    const result = await callerA.webhooks.deliveries({
      organizationId: orgA,
      webhookId: webhookB,
      limit: 100,
    });
    expect(result.deliveries).toEqual([]);
  });

  it('combines the webhook and status filters within the organization', async () => {
    const result = await callerA.webhooks.deliveries({
      organizationId: orgA,
      webhookId: webhookA,
      status: 'failed',
      limit: 100,
    });
    expect(webhookIdsOf(result)).toEqual([webhookA]);
    expect(result.deliveries.map((d: { status: string }) => d.status)).toEqual(['failed']);
  });
});
