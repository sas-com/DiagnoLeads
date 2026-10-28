/**
 * Organization isolation of the contact records (#554): a member of organization B who passes
 * organization A's deal, lead or contact record is refused (NOT_FOUND, or BAD_REQUEST for a deal
 * named on a record, the same answer as an id that does not exist), and A's rows stay as they
 * were.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-contacts-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  leadContactLogs,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('contact records organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];

  let orgA: string;
  let orgB: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;
  let leadA: string;
  let leadB: string;
  let dealA: string;
  let contactA: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `contacts-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `contacts-iso-${unique()}@example.com`, name: 'Isolation' })
      .returning();
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  async function createLead(organizationId: string) {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.co.jp`, company: '架空商事' })
      .returning();
    return lead.id;
  }

  const contactsOf = (leadId: string) =>
    pg.select().from(leadContactLogs).where(eq(leadContactLogs.leadId, leadId));

  beforeAll(async () => {
    orgA = await createOrganization('連絡の分離A');
    orgB = await createOrganization('連絡の分離B');
    adminA = await callerFor(orgA);
    adminB = await callerFor(orgB);
    leadA = await createLead(orgA);
    leadB = await createLead(orgB);
    dealA = (await adminA.deals.create({ organizationId: orgA, leadId: leadA, name: '調査' })).id;
    contactA = (
      await adminA.leadFollowUp.recordContact({
        organizationId: orgA,
        leadId: leadA,
        kind: 'visit',
        durationMinutes: 60,
        dealId: dealA,
      })
    ).id;
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    await client?.end();
  });

  it("does not list another organization's deal activity", async () => {
    await expect(
      adminB.leadActivity.forDeal({ organizationId: orgB, dealId: dealA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadActivity.list({ organizationId: orgB, leadId: leadA, limit: 10 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("does not record on another organization's lead or deal, and leaves its rows as they were", async () => {
    // Another organization's deal on one's own lead: the same answer as a deal that does not exist
    await expect(
      adminB.leadFollowUp.recordContact({
        organizationId: orgB,
        leadId: leadB,
        kind: 'online_meeting',
        dealId: dealA,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'The deal is not a deal of the lead' });
    await expect(
      adminB.leadFollowUp.recordContact({
        organizationId: orgB,
        leadId: leadB,
        kind: 'online_meeting',
        dealId: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'The deal is not a deal of the lead' });
    await expect(
      adminB.leadFollowUp.recordContact({
        organizationId: orgB,
        leadId: leadA,
        kind: 'visit',
        dealId: dealA,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadFollowUp.deleteContact({ organizationId: orgB, id: contactA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await contactsOf(leadB)).toHaveLength(0);
    const rowsA = await contactsOf(leadA);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]).toMatchObject({ id: contactA, dealId: dealA, durationMinutes: 60 });
    const auditA = await pg
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, contactA));
    expect(auditA.map((row) => row.action)).toEqual(['create']);
  });
});
