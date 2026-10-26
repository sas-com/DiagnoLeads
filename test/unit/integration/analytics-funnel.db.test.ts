/**
 * The analytics funnel by the stages of the lead lifecycle (#802) on a real PostgreSQL:
 * リード → MQL → 商談 → SQL → 受注, nested so a lead counts for every stage before the one it
 * reached, and the nurtured leads (再育成) counted beside the stages. Another organization's
 * leads are not counted.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/analytics-funnel.db.test.ts
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

describe.skipIf(!url)('analytics funnel by lifecycle stage (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  let userId: string;
  let orgA: string;
  let caller: ReturnType<typeof appRouter.createCaller>;

  const createOrganization = async (name: string) => {
    const [row] = await pg
      .insert(organizations)
      .values({ name, slug: `funnel-${unique()}` })
      .returning();
    organizationIds.push(row.id);
    return row.id;
  };
  const insertLead = (organizationId: string, values: Partial<typeof leads.$inferInsert>) =>
    pg.insert(leads).values({ organizationId, email: `fn-${unique()}@example.com`, ...values });

  beforeAll(async () => {
    orgA = await createOrganization('ファネルのテスト');
    const orgB = await createOrganization('別の組織');
    const [user] = await pg
      .insert(users)
      .values({ email: `funnel-${unique()}@example.com`, name: 'member' })
      .returning();
    userId = user.id;
    await pg.insert(organizationMembers).values({ organizationId: orgA, userId, role: 'member' });
    caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId }, user },
      user,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);

    const mqlDate = new Date('2026-10-20T00:00:00Z');
    // A lead only
    await insertLead(orgA, {});
    // MQL by its MQL date; MQL and nurtured (再育成)
    await insertLead(orgA, { mqlQualifiedAt: mqlDate });
    await insertLead(orgA, { mqlQualifiedAt: mqlDate, status: 'nurturing' });
    // An agency appointment: a deal without MQL counts as MQL too
    await insertLead(orgA, { status: 'negotiating', hasNegotiated: true });
    // SQL; won (counts for every stage)
    await insertLead(orgA, {
      mqlQualifiedAt: mqlDate,
      status: 'negotiating',
      hasNegotiated: true,
      sqlDecision: 'qualified',
    });
    await insertLead(orgA, { status: 'won', hasNegotiated: true, sqlDecision: 'qualified' });
    // MQL from the diagnosis alone (関心あり, no MQL date); 適合 is not MQL
    await insertLead(orgA, { responses: { axMigration: { mql: { level: 'interest' } } } });
    await insertLead(orgA, { responses: { axMigration: { mql: { level: 'fit' } } } });
    // Lost after a deal: reached 商談
    await insertLead(orgA, { status: 'lost', lostReason: 'budget', hasNegotiated: true });
    // A deal phase set by hand without a deal: 商談, as in the agency funnel
    await insertLead(orgA, { dealPhase: 'proposal', dealPhaseReachedAt: { proposal: '2026-10-20' } });
    // Won by hand long ago (no negotiated flag, no SQL): every stage
    await insertLead(orgA, { status: 'won' });
    // Before the 7-day period: only for all time
    await insertLead(orgA, { status: 'won', createdAt: new Date('2020-01-01T00:00:00Z') });
    // Another organization's lead is never counted
    await insertLead(orgB, { status: 'won', hasNegotiated: true, sqlDecision: 'qualified' });
  });

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    await pg.delete(users).where(eq(users.id, userId));
    await client?.end();
  });

  it('counts the leads that reached each stage, and the nurtured leads beside them', async () => {
    const funnel = await caller.analytics.getConversionFunnel({
      organizationId: orgA,
      dateRange: 'all',
    });
    expect(funnel.totalLeads).toBe(12);
    expect(funnel.stages.map((stage) => [stage.name, stage.cumulativeCount])).toEqual([
      ['lead', 12],
      ['mql', 10], // not the plain lead nor the 適合 one
      ['deal', 7], // + lost after a deal, the phase set by hand, the two won by hand
      ['sql', 4], // qualified, and every won lead
      ['won', 3],
    ]);
    expect(funnel.nurturingCount).toBe(1);
    expect(funnel.overallConversionRate).toBe(25);
  });

  it('counts only the leads created in the period', async () => {
    const funnel = await caller.analytics.getConversionFunnel({
      organizationId: orgA,
      dateRange: '7d',
    });
    expect(funnel.totalLeads).toBe(11);
    expect(funnel.stages.at(-1)?.cumulativeCount).toBe(2);
  });
});
