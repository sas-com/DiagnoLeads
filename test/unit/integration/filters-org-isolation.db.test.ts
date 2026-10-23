/**
 * Organization isolation of saved lead filters (#356) on a real PostgreSQL: an admin of
 * organization B passes the ids of A's filters, a public one included. Nothing of A is read,
 * used, changed or deleted, and B's list holds none of A's filters. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/filters-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { organizationMembers, organizations, savedFilters, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

const statusIsNew = {
  logic: 'and' as const,
  conditions: [{ field: 'status', operator: 'equals' as const, value: 'new' }],
};

describe.skipIf(!url)('saved filters: organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminB: any;
  /** A's filters: one public, one private */
  const filtersA: string[] = [];

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `filters-iso-${unique()}@example.com`, name: 'テスト' })
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

  const rowsOfA = () =>
    pg.select().from(savedFilters).where(inArray(savedFilters.id, filtersA)).orderBy(savedFilters.name);

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '絞り込み切り分けA', slug: `filters-iso-a-${unique()}` },
        { name: '絞り込み切り分けB', slug: `filters-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA);
    adminB = await callerFor(orgB);
    for (const isPublic of [true, false]) {
      const filter = await adminA.filters.create({
        organizationId: orgA,
        name: isPublic ? 'A の共有の条件' : 'A の自分だけの条件',
        filters: statusIsNew,
        isPublic,
      });
      filtersA.push(filter.id);
    }
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(
      adminB.filters.list({ organizationId: orgA, includePublic: true, includePrivate: true })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("lists and reads none of A's filters, public or not (list, get)", async () => {
    expect(
      await adminB.filters.list({ organizationId: orgB, includePublic: true, includePrivate: true })
    ).toEqual([]);
    for (const id of filtersA) {
      await expect(adminB.filters.get({ organizationId: orgB, id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it("uses, changes and deletes none of A's filters by their ids (use, update, delete)", async () => {
    const before = await rowsOfA();
    for (const id of filtersA) {
      await expect(adminB.filters.use({ organizationId: orgB, id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        adminB.filters.update({ organizationId: orgB, id, name: '書き換え', isPublic: true })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(adminB.filters.delete({ organizationId: orgB, id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    // Usage count, name, visibility: all as they were
    expect(await rowsOfA()).toEqual(before);
  });
});
