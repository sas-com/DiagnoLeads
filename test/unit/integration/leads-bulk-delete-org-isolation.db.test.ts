/**
 * Organization isolation of leads.bulkDelete (#356): a member of organization B who passes the ids
 * of organization A's leads deletes nothing (deletedCount 0), and A's leads stay as they were. The
 * other lead procedures are covered by tenant-scope.db.test.ts and the leads DB tests.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/leads-bulk-delete-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('leads.bulkDelete organization isolation (PostgreSQL)', () => {
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
  let leadB: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `leads-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `leads-iso-${unique()}@example.com`, name: 'Isolation' })
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
    leads: await pg.select().from(leads).where(eq(leads.organizationId, orgA)),
  });

  beforeAll(async () => {
    orgA = await createOrganization('切り分けA');
    orgB = await createOrganization('切り分けB');
    adminB = await callerFor(orgB);
    leadA = await insertLead(orgA);
    leadB = await insertLead(orgB);
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  const asB = () => ({ organizationId: orgB });

  it('deletes nothing of another organization, even mixed with its own ids', async () => {
    const before = await stateOfA();
    const result = await adminB.leads.bulkDelete({ ...asB(), ids: [leadA, leadB] });
    expect(result).toEqual({ success: true, deletedCount: 1 });
    expect(await stateOfA()).toEqual(before);
    expect(await pg.select().from(leads).where(eq(leads.id, leadB))).toEqual([]);
  });

  it('deletes nothing when every id belongs to another organization', async () => {
    const before = await stateOfA();
    const result = await adminB.leads.bulkDelete({ ...asB(), ids: [leadA] });
    expect(result).toEqual({ success: true, deletedCount: 0 });
    expect(await stateOfA()).toEqual(before);
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(adminB.leads.bulkDelete({ organizationId: orgA, ids: [leadA] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
