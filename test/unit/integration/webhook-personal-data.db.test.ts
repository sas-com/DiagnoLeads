/**
 * Confirming that lead personal data is sent (#917) on a real PostgreSQL: a webhook that sends it
 * is saved only with the confirmation, the audit row is written in the same transaction, and a
 * confirmed webhook can still be renamed (the update's condition on the stored events matches).
 * All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/webhook-personal-data.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  organizationMembers,
  organizations,
  users,
  webhookDeliveries,
  webhooks,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// Host names resolve to a public address: no real DNS lookup
vi.mock('node:dns/promises', () => {
  const lookup = async () => [{ address: '93.184.215.14', family: 4 }];
  return { lookup, default: { lookup } };
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('webhook personal data confirmation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgId: string;
  let userId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  const confirmations = () =>
    pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.resource, 'webhook')));

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '個人情報確認テスト株式会社', slug: `pd-confirm-${unique()}` })
      .returning();
    orgId = org.id;
    const [user] = await pg
      .insert(users)
      .values({ email: `pd-confirm-${unique()}@example.com`, name: '確認 太郎' })
      .returning();
    userId = user.id;
    await pg.insert(organizationMembers).values({ organizationId: orgId, userId, role: 'admin' });
    caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, [orgId]));
    await pg.delete(users).where(eq(users.id, userId));
    await client?.end();
  });

  it('saves nothing without the confirmation', async () => {
    await expect(
      caller.webhooks.create({
        organizationId: orgId,
        name: '架空の CRM',
        url: 'https://crm.example.com/refused',
        events: ['lead.created'],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await pg.select().from(webhooks).where(eq(webhooks.organizationId, orgId))).toEqual([]);
  });

  it('creates, renames and moves a confirmed webhook, recording each confirmation', async () => {
    const created = await caller.webhooks.create({
      organizationId: orgId,
      name: '架空の CRM',
      url: 'https://crm.example.com/hook',
      events: ['lead.created', 'lead.deleted'],
      personalDataConfirmed: true,
    });
    const [first] = await confirmations();
    expect(first).toMatchObject({
      userId,
      action: 'create',
      resourceId: created.id,
      metadata: {
        personalDataConfirmation: {
          events: ['lead.created'],
          fields: ['email', 'name', 'company', 'phone'],
        },
      },
    });

    // The update's condition on the stored events (jsonb) matches: no CONFLICT
    const renamed = await caller.webhooks.update({
      organizationId: orgId,
      id: created.id,
      name: '名前を変えた CRM',
    });
    expect(renamed.name).toBe('名前を変えた CRM');
    expect(await confirmations()).toHaveLength(1);

    await expect(
      caller.webhooks.update({
        organizationId: orgId,
        id: created.id,
        url: 'https://other.example.com/hook',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const [stored] = await pg.select().from(webhooks).where(eq(webhooks.id, created.id));
    expect(stored.url).toBe('https://crm.example.com/hook');

    // A retry stored for the old URL is not sent to the new one (#927 review)
    await pg.insert(webhookDeliveries).values({
      webhookId: created.id,
      eventType: 'lead.created',
      payload: { event: 'lead.created', data: { email: 'made-up@example.com' } },
      status: 'pending',
      attempts: 1,
      nextRetryAt: new Date(),
    });

    await caller.webhooks.update({
      organizationId: orgId,
      id: created.id,
      url: 'https://other.example.com/hook',
      personalDataConfirmed: true,
    });
    const rows = await confirmations();
    expect(rows.map((row) => row.action).sort()).toEqual(['create', 'update']);
    const deliveries = await pg
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, created.id));
    expect(deliveries.map((d) => [d.status, d.nextRetryAt])).toEqual([['failed', null]]);
    expect(deliveries[0].error).toMatch(/^url_changed:/);
  });
});
