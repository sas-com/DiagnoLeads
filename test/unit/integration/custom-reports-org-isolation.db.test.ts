/**
 * Organization isolation of custom reports (#356) on a real PostgreSQL: an admin of
 * organization B passes the ids of A's reports, a public one included. Nothing of A is read,
 * copied into B, changed or deleted, and B's list holds none of A's reports. All values are
 * fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/custom-reports-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { customReports, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('custom reports: organization isolation (PostgreSQL)', () => {
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
  /** A's reports: one public, one private */
  const reportsA: string[] = [];

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `reports-iso-${unique()}@example.com`, name: 'テスト' })
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
    pg
      .select()
      .from(customReports)
      .where(inArray(customReports.id, reportsA))
      .orderBy(customReports.name);
  const reportsOfB = () =>
    pg.select({ id: customReports.id }).from(customReports).where(eq(customReports.organizationId, orgB));

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: 'レポート切り分けA', slug: `reports-iso-a-${unique()}` },
        { name: 'レポート切り分けB', slug: `reports-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA);
    adminB = await callerFor(orgB);
    for (const isPublic of [true, false]) {
      const report = await adminA.customReports.create({
        organizationId: orgA,
        name: isPublic ? 'A の共有レポート' : 'A の自分だけのレポート',
        isPublic,
      });
      reportsA.push(report.id);
    }
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(adminB.customReports.list({ organizationId: orgA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("lists and reads none of A's reports, public or not (list, get)", async () => {
    expect(await adminB.customReports.list({ organizationId: orgB })).toEqual([]);
    for (const id of reportsA) {
      await expect(adminB.customReports.get({ organizationId: orgB, id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it("copies none of A's reports into B (duplicate)", async () => {
    for (const id of reportsA) {
      await expect(
        adminB.customReports.duplicate({ organizationId: orgB, id, newName: 'B への複製' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await reportsOfB()).toEqual([]);
  });

  it("changes and deletes none of A's reports by their ids (update, delete)", async () => {
    const before = await rowsOfA();
    for (const id of reportsA) {
      await expect(
        adminB.customReports.update({ organizationId: orgB, id, name: '書き換え', isPublic: true })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.customReports.delete({ organizationId: orgB, id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await rowsOfA()).toEqual(before);
  });
});
