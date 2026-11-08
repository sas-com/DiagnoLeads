/**
 * Personal data in webhook deliveries on a real PostgreSQL (#918): a finished delivery keeps the
 * lead's id, the event and its result but not the email, name, company or phone; a delivery
 * waiting for a retry keeps its payload; deleting a lead fails its retries and redacts its
 * deliveries, in its own organization only. The HTTP side is a stubbed fetch. All names are
 * made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/webhook-payload-redaction.db.test.ts
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
import {
  processWebhookRetries,
  redactFinishedDeliveries,
  triggerWebhooks,
} from '@/lib/features/webhooks/services/webhook-service';
import { sendLeadEvents } from '@/lib/features/webhooks/services/lead-events';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Tasks run after the response (lead.deleted) are left alone here
vi.mock('@/lib/auth/email-helpers', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runAfterResponse: () => {},
}));

const url = process.env.TEST_DATABASE_URL;

const PERSON = {
  email: 'redact-taro@example.com',
  name: '消去 太郎',
  company: '架空商事',
  phone: '000-0000-0000',
};

describe.skipIf(!url)('webhook payload redaction (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let webhookA: string;
  let webhookB: string;
  let userId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let callerA: any;
  const fetchMock = vi.fn();
  const answer = (status: number) => ({
    ok: status < 400,
    status,
    statusText: String(status),
    text: async () => '',
  });

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `redact-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function createWebhook(organizationId: string, maxRetries = 3) {
    const [row] = await pg
      .insert(webhooks)
      .values({
        organizationId,
        name: '架空の連携',
        url: `https://hooks.example.com/${unique()}`,
        secret: 'whsec_test',
        events: ['lead.created', 'diagnostic.submitted', 'organization.member_added'],
        retryConfig: { maxRetries, retryDelayMs: 1000 },
      })
      .returning();
    return row.id;
  }

  async function createDelivery(
    webhookId: string,
    eventType: 'lead.created' | 'lead.updated' | 'diagnostic.submitted' | 'organization.member_added',
    data: Record<string, unknown>,
    status: 'pending' | 'success' | 'failed' = 'pending'
  ) {
    const [row] = await pg
      .insert(webhookDeliveries)
      .values({
        webhookId,
        eventType,
        payload: { id: unique(), event: eventType, data },
        status,
        attempts: 1,
        nextRetryAt: status === 'pending' ? new Date(Date.now() - 1000) : null,
      })
      .returning();
    return row.id;
  }

  const load = async (id: string) =>
    (await pg.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0];
  const dataOf = (row: { payload: unknown }) =>
    (row.payload as { data: Record<string, unknown> }).data;

  beforeAll(async () => {
    orgA = await createOrganization('消去テストA株式会社');
    orgB = await createOrganization('消去テストB株式会社');
    webhookA = await createWebhook(orgA);
    webhookB = await createWebhook(orgB);
    const [user] = await pg
      .insert(users)
      .values({ email: `redact-${unique()}@example.com`, name: '消去 花子' })
      .returning();
    userId = user.id;
    await pg.insert(organizationMembers).values({ organizationId: orgA, userId, role: 'admin' });
    callerA = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(200));
    await pg
      .delete(webhookDeliveries)
      .where(inArray(webhookDeliveries.webhookId, [webhookA, webhookB]));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    await pg.delete(users).where(eq(users.id, userId));
    await client?.end();
  });

  it('keeps the id and the result of a successful delivery, not the person', async () => {
    await triggerWebhooks(
      orgA,
      'diagnostic.submitted',
      { leadId: 'lead-1', score: 70, ...PERSON },
      { database: pg }
    );

    // The receiver got everything
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).data).toMatchObject(PERSON);

    const [row] = await pg
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookA));
    expect(row.status).toBe('success');
    expect(dataOf(row)).toEqual({ leadId: 'lead-1', score: 70 });
  });

  it('keeps the payload of a delivery waiting for a retry, and redacts it once the retries run out', async () => {
    fetchMock.mockResolvedValue(answer(500));
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgA, email: `retry-${unique()}@example.com` })
      .returning();
    await triggerWebhooks(orgA, 'lead.created', { id: lead.id, ...PERSON }, { database: pg });
    const [waiting] = await pg
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookA));
    expect(waiting.status).toBe('pending');
    expect(dataOf(waiting)).toMatchObject(PERSON);

    // The last attempt fails too
    await pg
      .update(webhookDeliveries)
      .set({ attempts: 2, nextRetryAt: new Date(Date.now() - 1000) })
      .where(eq(webhookDeliveries.id, waiting.id));
    await processWebhookRetries({ database: pg });

    const finished = await load(waiting.id);
    expect(finished.status).toBe('failed');
    expect(dataOf(finished)).toEqual({ id: lead.id });
  });

  it('keeps no answer of the receiver for an event with personal data, and keeps it for others (#936)', async () => {
    // A receiver echoing the request
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => ({
      ...answer(200),
      text: async () => init.body,
    }));
    await triggerWebhooks(orgA, 'diagnostic.submitted', { leadId: 'x', ...PERSON }, { database: pg });
    await triggerWebhooks(orgA, 'organization.member_added', { email: 'm@example.com' }, { database: pg });

    const rows = await pg
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookA));
    const byEvent = Object.fromEntries(rows.map((row) => [row.eventType, row]));
    expect(byEvent['diagnostic.submitted']).toMatchObject({ status: 'success', statusCode: 200, response: null });
    expect(byEvent['organization.member_added'].response).toContain('m@example.com');
  });

  it('sends no change of a lead deleted meanwhile, and fails a retry made for one (#936)', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgA, email: PERSON.email, name: PERSON.name })
      .returning();
    await pg.delete(leads).where(eq(leads.id, lead.id));

    // A change sent after the response, once the lead is gone
    await sendLeadEvents(orgA, [{ type: 'lead.updated', lead }], { database: pg });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await pg.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookA))
    ).toEqual([]);

    // A delivery made just before the deletion: failed by the retry run, never sent
    const orphan = await createDelivery(webhookA, 'lead.updated', {
      id: lead.id,
      ...PERSON,
    });
    const result = await processWebhookRetries({ database: pg });
    expect(result.orphaned).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await load(orphan);
    expect(row).toMatchObject({ status: 'failed', nextRetryAt: null });
    expect(row.error).toMatch(/^lead_deleted:/);
    expect(dataOf(row)).toEqual({ id: lead.id });
  });

  it('sweeps finished deliveries that still hold personal data, and nothing else', async () => {
    const finished = await createDelivery(webhookA, 'lead.created', { id: 'l', ...PERSON }, 'success');
    const waiting = await createDelivery(webhookA, 'lead.created', { id: 'l', ...PERSON });
    const member = await createDelivery(
      webhookA,
      'organization.member_added',
      { email: 'member@example.com' },
      'success'
    );

    expect(await redactFinishedDeliveries(pg)).toBeGreaterThanOrEqual(1);

    expect(dataOf(await load(finished))).toEqual({ id: 'l' });
    expect(dataOf(await load(waiting))).toMatchObject(PERSON);
    expect(dataOf(await load(member))).toEqual({ email: 'member@example.com' });
    // Run again: nothing left of these
    await redactFinishedDeliveries(pg);
    expect(dataOf(await load(finished))).toEqual({ id: 'l' });
  });

  it('fails the retries of a deleted lead and redacts its deliveries, in its organization only', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgA, email: PERSON.email, name: PERSON.name })
      .returning();
    const [other] = await pg
      .insert(leads)
      .values({ organizationId: orgA, email: `other-${unique()}@example.com` })
      .returning();
    const created = await createDelivery(webhookA, 'lead.created', { id: lead.id, ...PERSON });
    const submitted = await createDelivery(webhookA, 'diagnostic.submitted', {
      leadId: lead.id,
      ...PERSON,
    });
    const otherLead = await createDelivery(webhookA, 'lead.created', { id: other.id, ...PERSON });
    // Another organization's delivery naming the same id is not touched
    const elsewhere = await createDelivery(webhookB, 'lead.created', { id: lead.id, ...PERSON });

    await callerA.leads.delete({ organizationId: orgA, id: lead.id });

    for (const id of [created, submitted]) {
      const row = await load(id);
      expect(row).toMatchObject({ status: 'failed', nextRetryAt: null });
      expect(row.error).toMatch(/^lead_deleted:/);
      expect(dataOf(row)).not.toHaveProperty('email');
      expect(dataOf(row)).not.toHaveProperty('name');
    }
    expect(dataOf(await load(otherLead))).toMatchObject(PERSON);
    expect(await load(otherLead)).toMatchObject({ status: 'pending' });
    expect(dataOf(await load(elsewhere))).toMatchObject(PERSON);
    expect(await load(elsewhere)).toMatchObject({ status: 'pending' });
  });
});
