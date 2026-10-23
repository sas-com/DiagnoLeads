/**
 * Organization isolation of the organizations router (#356) on a real PostgreSQL: the owner of
 * organization B passes the id of organization A. A is not read or changed, and B's list holds
 * only B. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/organizations-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('organizations: organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let ownerB: any;

  const organizationOf = async (id: string) =>
    (await pg.select().from(organizations).where(eq(organizations.id, id)))[0];

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        {
          name: '組織切り分けA',
          slug: `orgs-iso-a-${unique()}`,
          settings: { hearingCatalog: { hidden: ['machineModel'], version: 1 } },
        },
        { name: '組織切り分けB', slug: `orgs-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    // A has its own owner, so a membership of A exists to be (wrongly) found
    const [ownerOfA, user] = await pg
      .insert(users)
      .values([
        { email: `orgs-iso-a-${unique()}@example.com`, name: 'A のオーナー' },
        { email: `orgs-iso-b-${unique()}@example.com`, name: 'B のオーナー' },
      ])
      .returning();
    userIds.push(ownerOfA.id, user.id);
    await pg.insert(organizationMembers).values([
      { organizationId: orgA, userId: ownerOfA.id, role: 'owner' },
      { organizationId: orgB, userId: user.id, role: 'owner' },
    ]);
    ownerB = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("reads nothing of organization A by its id (getById)", async () => {
    await expect(ownerB.organizations.getById({ id: orgA })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await ownerB.organizations.getById({ id: orgB })).toMatchObject({
      id: orgB,
      role: 'owner',
    });
  });

  it("changes nothing of organization A by its id (update)", async () => {
    const before = await organizationOf(orgA);
    await expect(
      ownerB.organizations.update({
        id: orgA,
        name: '書き換え',
        slug: `rewritten-${unique()}`,
        settings: {},
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await organizationOf(orgA)).toEqual(before);
  });

  it("lists only the caller's own organizations (list)", async () => {
    const { organizations: listed, total } = await ownerB.organizations.list({});
    expect(listed.map((org: { id: string }) => org.id)).toEqual([orgB]);
    expect(total).toBe(1);
  });
});
