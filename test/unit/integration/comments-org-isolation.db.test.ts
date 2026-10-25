/**
 * Organization isolation of the comments router (#356): a member of organization B who passes the id
 * of organization A's comment or lead gets NOT_FOUND (list is empty, getCount answers 0), and A's rows
 * stay as they were.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/comments-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  leadComments,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('comments organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let orgA: string;
  let orgB: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;
  let leadA: string;
  let commentA: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `comments-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `comments-iso-${unique()}@example.com`, name: 'Isolation' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  async function insertLead(organizationId: string) {
    const [row] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.com`, status: 'new' })
      .returning();
    return row.id;
  }

  const stateOfA = async () => ({
    comments: await pg.select().from(leadComments).where(eq(leadComments.organizationId, orgA)),
  });
  // Audit rows of both organizations: a refused write records nothing (#555)
  const audits = () =>
    pg
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(inArray(auditLogs.organizationId, [orgA, orgB]));

  beforeAll(async () => {
    orgA = await createOrganization('切り分けA');
    orgB = await createOrganization('切り分けB');
    adminB = await callerFor(orgB);
    leadA = await insertLead(orgA);
    const [comment] = await pg
      .insert(leadComments)
      .values({ organizationId: orgA, leadId: leadA, content: 'Comment of A' })
      .returning();
    commentA = comment.id;
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  const asB = () => ({ organizationId: orgB });

  const calls: Record<string, () => Promise<unknown>> = {
    update: () => adminB.comments.update({ ...asB(), id: commentA, content: 'Changed by B' }),
    delete: () => adminB.comments.delete({ ...asB(), id: commentA }),
    togglePin: () => adminB.comments.togglePin({ ...asB(), id: commentA }),
  };

  it.each(Object.keys(calls))('%s with ids of another organization answers NOT_FOUND', async (name) => {
    const before = await stateOfA();
    await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await stateOfA()).toEqual(before);
  });

  it('create and addActivity on ids of another organization answer NOT_FOUND and record nothing', async () => {
    const leadB = await insertLead(orgB);
    const before = { a: await stateOfA(), audits: await audits() };

    await expect(
      adminB.comments.create({ ...asB(), leadId: leadA, content: 'On a lead of A' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.comments.create({ ...asB(), leadId: leadB, content: 'Reply to A', parentId: commentA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.comments.addActivity({ ...asB(), leadId: leadA, content: 'Activity on A' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await stateOfA()).toEqual(before.a);
    expect(await audits()).toEqual(before.audits);
  });

  it('list of a lead of another organization comes back empty', async () => {
    const page = await adminB.comments.list({ ...asB(), leadId: leadA });
    expect(JSON.stringify(page)).not.toContain('Comment of A');
    expect(JSON.stringify(page)).not.toContain(commentA);
  });

  it('getCount of a lead of another organization answers 0', async () => {
    expect(await adminB.comments.getCount({ ...asB(), leadId: leadA })).toEqual({ count: 0 });
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(adminB.comments.getCount({ organizationId: orgA, leadId: leadA })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
