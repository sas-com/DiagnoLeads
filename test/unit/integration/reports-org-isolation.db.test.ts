/**
 * Organization isolation of the reports router (#356): a member of organization B who passes the
 * id of organization A's scheduled report gets NOT_FOUND (its history comes back empty), and A's
 * reports and history stay as they were.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/reports-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  organizationMembers,
  organizations,
  reportHistory,
  scheduledReports,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('reports organization isolation (PostgreSQL)', () => {
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
  let reportA: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `report-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `report-iso-${unique()}@example.com`, name: 'Report' })
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

  const stateOf = async (organizationId: string) => ({
    reports: await pg
      .select()
      .from(scheduledReports)
      .where(eq(scheduledReports.organizationId, organizationId)),
    history: await pg
      .select()
      .from(reportHistory)
      .where(eq(reportHistory.organizationId, organizationId)),
  });

  beforeAll(async () => {
    orgA = await createOrganization('レポート切り分けA');
    orgB = await createOrganization('レポート切り分けB');
    adminB = await callerFor(orgB);
    const [report] = await pg
      .insert(scheduledReports)
      .values({ organizationId: orgA, name: 'Report A', recipients: 'a@example.com' })
      .returning();
    reportA = report.id;
    await pg.insert(reportHistory).values({
      scheduledReportId: reportA,
      organizationId: orgA,
      periodStart: new Date('2026-10-01T00:00:00Z'),
      periodEnd: new Date('2026-10-08T00:00:00Z'),
    });
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
    get: () => adminB.reports.get({ ...asB(), id: reportA }),
    update: () => adminB.reports.update({ ...asB(), id: reportA, name: 'Changed by B' }),
    delete: () => adminB.reports.delete({ ...asB(), id: reportA }),
    toggleStatus: () => adminB.reports.toggleStatus({ ...asB(), id: reportA }),
    runNow: () => adminB.reports.runNow({ ...asB(), id: reportA }),
  };

  it.each(Object.keys(calls))('%s with a report of another organization answers NOT_FOUND', async (name) => {
    const before = await stateOf(orgA);
    await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await stateOf(orgA)).toEqual(before);
  });

  it('getHistory of a report of another organization comes back empty', async () => {
    const page = await adminB.reports.getHistory({ ...asB(), reportId: reportA });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('writes no history in B from the refused runs', async () => {
    expect((await stateOf(orgB)).history).toEqual([]);
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(
      adminB.reports.get({ organizationId: orgA, id: reportA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
