/**
 * Organization isolation of the tags router (#356): a member of organization B who passes the id
 * of organization A's tag gets NOT_FOUND, and A's rows stay as they were.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/tags-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { tags, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('tags organization isolation (PostgreSQL)', () => {
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
  let tagA: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `tags-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `tags-iso-${unique()}@example.com`, name: 'Isolation' })
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


  const stateOfA = async () => ({
    tags: await pg.select().from(tags).where(eq(tags.organizationId, orgA)),
  });

  beforeAll(async () => {
    orgA = await createOrganization('切り分けA');
    orgB = await createOrganization('切り分けB');
    adminB = await callerFor(orgB);
    const [tag] = await pg.insert(tags).values({ organizationId: orgA, name: 'Tag A' }).returning();
    tagA = tag.id;
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
    update: () => adminB.tags.update({ ...asB(), id: tagA, name: 'Changed by B' }),
    delete: () => adminB.tags.delete({ ...asB(), id: tagA }),
  };

  it.each(Object.keys(calls))('%s with ids of another organization answers NOT_FOUND', async (name) => {
    const before = await stateOfA();
    await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await stateOfA()).toEqual(before);
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(adminB.tags.delete({ organizationId: orgA, id: tagA })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
