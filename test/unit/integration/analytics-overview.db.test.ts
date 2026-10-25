/**
 * The analytics overview counts leads per MQL level (#605) on a real PostgreSQL, with the same
 * rules as the lead list's MQL level filter (#447): a lead with an MQL date is 関心あり, a lead
 * without a diagnosis or an MQL date is 診断なし. Another organization's leads are not counted.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/analytics-overview.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('analytics overview by MQL level (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  let userId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  const createOrganization = async (name: string) => {
    const [row] = await pg
      .insert(organizations)
      .values({ name, slug: `overview-${unique()}` })
      .returning();
    organizationIds.push(row.id);
    return row.id;
  };
  const insertLead = (organizationId: string, values: Partial<typeof leads.$inferInsert>) =>
    pg.insert(leads).values({ organizationId, email: `ov-${unique()}@example.com`, ...values });

  let orgA: string;

  beforeAll(async () => {
    orgA = await createOrganization('分析の概要テスト');
    const orgB = await createOrganization('別の組織');
    const [user] = await pg
      .insert(users)
      .values({ email: `overview-${unique()}@example.com`, name: 'member' })
      .returning();
    userId = user.id;
    await pg.insert(organizationMembers).values({ organizationId: orgA, userId, role: 'member' });
    caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);

    const ax = (level: string) => ({ axMigration: { mql: { level } } });
    await insertLead(orgA, { responses: ax('interest') });
    await insertLead(orgA, { responses: ax('fit') });
    await insertLead(orgA, { responses: ax('fit') });
    await insertLead(orgA, { responses: ax('none') });
    // Judged MQL by hand without a diagnosis: 関心あり, as in the list
    await insertLead(orgA, { mqlQualifiedAt: new Date('2026-10-10T00:00:00Z') });
    await insertLead(orgA, {});
    // Another organization's lead is never counted
    await insertLead(orgB, { responses: ax('interest') });
  });

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    await pg.delete(users).where(eq(users.id, userId));
    await client?.end();
  });

  it('counts the leads per MQL level, like the list filter, and the MQL rate', async () => {
    const overview = await caller.analytics.getOverview({ organizationId: orgA, dateRange: '30d' });
    expect(overview.totalLeads).toBe(6);
    expect(overview.mqlLevels).toEqual({ interest: 2, fit: 2, none: 1, unknown: 1 });
    expect(overview.mqlRate).toBe(33.33); // 2 / 6
    expect(overview).not.toHaveProperty('averageScore');
  });
});
