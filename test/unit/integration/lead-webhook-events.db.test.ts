/**
 * lead.* webhook events on a real PostgreSQL (#308): the lead router's changes reach the
 * organization's subscribed webhooks with the allowlisted columns only, never another
 * organization's, and events past the time budget are queued for the retry processor. The HTTP
 * side is a stubbed fetch. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/lead-webhook-events.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  leads,
  organizationMembers,
  organizations,
  users,
  webhookDeliveries,
  webhooks,
} from '@/lib/db/schema';
import { LEAD_WEBHOOK_FIELDS } from '@/lib/features/webhooks/services/lead-events';
import {
  processWebhookRetries,
  triggerWebhookBatch,
} from '@/lib/features/webhooks/services/webhook-service';
import { appRouter } from '@/server/routers/_app';
import { asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// Host names resolve to a public address: no real DNS lookup
vi.mock('node:dns/promises', () => {
  const lookup = async () => [{ address: '93.184.215.14', family: 4 }];
  return { lookup, default: { lookup } };
});

// The tasks run after the response are collected so the test can wait for them
const { pending } = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));
vi.mock('@/lib/auth/email-helpers', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runAfterResponse: (task: Promise<unknown>) => {
    pending.push(task);
  },
}));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead webhook events (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
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
  const fetchMock = vi.fn();

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `lead-events-${unique()}` })
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
        events: [
          'lead.created',
          'lead.updated',
          'lead.status_changed',
          'lead.scored',
          'lead.deleted',
        ],
      })
      .returning();
    return row.id;
  }

  const deliveriesOf = (webhookId: string) =>
    pg
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(asc(webhookDeliveries.createdAt));

  const dataOf = (delivery: { payload: unknown }) =>
    (delivery.payload as { data: Record<string, unknown> }).data;

  beforeAll(async () => {
    orgA = await createOrganization('イベントテストA株式会社');
    const orgB = await createOrganization('イベントテストB株式会社');
    webhookA = await createWebhook(orgA);
    webhookB = await createWebhook(orgB);

    const [user] = await pg
      .insert(users)
      .values({ email: `lead-events-${unique()}@example.com`, name: 'イベント 太郎' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId: orgA, userId: user.id, role: 'admin' });
    callerA = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => '' });
    await pg.delete(webhookDeliveries).where(inArray(webhookDeliveries.webhookId, [webhookA, webhookB]));
    await pg.delete(leads).where(eq(leads.organizationId, orgA));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('sends lead.created with the allowlisted columns, to the own organization only', async () => {
    const lead = await callerA.leads.create({
      organizationId: orgA,
      email: `new-${unique()}@example.com`,
      name: '新規 花子',
      company: '架空商事',
      responses: { answer: '社外に出さない回答' },
    });
    await settle();

    const [delivery, ...rest] = await deliveriesOf(webhookA);
    expect(rest).toEqual([]);
    expect(delivery.eventType).toBe('lead.created');
    expect(delivery.status).toBe('success');
    expect(Object.keys(dataOf(delivery)).sort()).toEqual([...LEAD_WEBHOOK_FIELDS].sort());
    expect(dataOf(delivery).id).toBe(lead.id);
    expect(JSON.stringify(delivery.payload)).not.toContain('社外に出さない回答');
    expect(await deliveriesOf(webhookB)).toEqual([]);
  });

  it('sends the events of what an update changed', async () => {
    const lead = await callerA.leads.create({
      organizationId: orgA,
      email: `upd-${unique()}@example.com`,
      name: '更新 次郎',
    });
    await settle();
    await pg.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookA));

    await callerA.leads.update({
      organizationId: orgA,
      id: lead.id,
      company: '更新後の商事',
      status: 'nurturing',
    });
    await settle();

    const deliveries = await deliveriesOf(webhookA);
    expect(deliveries.map((d) => d.eventType).sort()).toEqual([
      'lead.status_changed',
      'lead.updated',
    ]);
    const statusChanged = deliveries.find((d) => d.eventType === 'lead.status_changed');
    expect(dataOf(statusChanged!)).toMatchObject({ status: 'nurturing', previousStatus: 'new' });
  });

  it('sends lead.status_changed only for the leads a bulk change really changed', async () => {
    const changed = await callerA.leads.create({
      organizationId: orgA,
      email: `bulk1-${unique()}@example.com`,
    });
    const unchanged = await callerA.leads.create({
      organizationId: orgA,
      email: `bulk2-${unique()}@example.com`,
      status: 'won',
    });
    await settle();
    await pg.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookA));

    await callerA.leads.bulkUpdateStatus({
      organizationId: orgA,
      ids: [changed.id, unchanged.id],
      status: 'won',
    });
    await settle();

    const deliveries = await deliveriesOf(webhookA);
    expect(deliveries.map((d) => [d.eventType, dataOf(d).id])).toEqual([
      ['lead.status_changed', changed.id],
    ]);
  });

  it('sends lead.deleted with the id and time only', async () => {
    const lead = await callerA.leads.create({
      organizationId: orgA,
      email: `del-${unique()}@example.com`,
      name: '削除 三郎',
    });
    await settle();
    await pg.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookA));

    await callerA.leads.delete({ organizationId: orgA, id: lead.id });
    await settle();

    const [delivery] = await deliveriesOf(webhookA);
    expect(delivery.eventType).toBe('lead.deleted');
    expect(Object.keys(dataOf(delivery)).sort()).toEqual(['deletedAt', 'id']);
    expect(dataOf(delivery).id).toBe(lead.id);
  });

  it('queues the events past the time budget, and the retry processor sends them', async () => {
    const counts = await triggerWebhookBatch(
      orgA,
      [
        { eventType: 'lead.deleted', data: { id: 'a' } },
        { eventType: 'lead.deleted', data: { id: 'b' } },
      ],
      { database: pg, timeBudgetMs: 0 }
    );
    expect(counts).toEqual({ sent: 0, failed: 0, queued: 2 });
    expect(fetchMock).not.toHaveBeenCalled();

    const queued = await deliveriesOf(webhookA);
    expect(queued.map((d) => [d.status, d.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
    ]);

    await processWebhookRetries({ database: pg });
    const sent = await deliveriesOf(webhookA);
    expect(sent.map((d) => [d.status, d.attempts])).toEqual([
      ['success', 1],
      ['success', 1],
    ]);
  });
});
