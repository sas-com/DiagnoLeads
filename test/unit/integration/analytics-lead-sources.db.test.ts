/**
 * Analytics by 流入元 / acquisition cost / agency on a real PostgreSQL (#138), with what the
 * deals of the leads brought in (#448).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_analytics138 \
 *     bunx vitest --run test/unit/integration/analytics-lead-sources.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { deals, leads, organizations } from '@/lib/db/schema';
import {
  getAcquisitionCost,
  getAgencyPerformance,
  getInflowSourceBreakdown,
} from '@/lib/features/analytics/lead-sources';
import { analyticsPeriodStart } from '@/lib/features/analytics/period';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('analytics by inflow source, cost and agency (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof getAgencyPerformance>[0];
  // Friday 2026-10-16 15:00 JST; the 7-day period starts 2026-10-10 00:00 JST (10-09 15:00 UTC)
  const now = new Date('2026-10-16T06:00:00Z');
  const from = analyticsPeriodStart('7d', now);
  let organizationId: string;
  let otherOrganizationId: string;

  const lead = (values: Partial<typeof leads.$inferInsert>, orgId = organizationId) =>
    pg.insert(leads).values({
      organizationId: orgId,
      email: `${Math.random().toString(36).slice(2)}@example.com`,
      status: 'new',
      createdAt: new Date('2026-10-14T03:00:00Z'),
      ...values,
    });

  beforeAll(async () => {
    const unique = Date.now();
    organizationId = (
      await pg.insert(organizations).values({ name: '分析', slug: `analytics-${unique}` }).returning()
    )[0].id;
    otherOrganizationId = (
      await pg
        .insert(organizations)
        .values({ name: '別組織', slug: `analytics-other-${unique}` })
        .returning()
    )[0].id;

    // Agency A: 3 appointments of 30,000 yen, one judged SQL and won
    await lead({
      inflowSource: 'telemarketing_agency',
      agencyName: 'A社',
      acquisitionCost: 30000,
      sqlDecision: 'qualified',
      status: 'won',
    });
    await lead({
      inflowSource: 'telemarketing_agency',
      agencyName: ' A社 ', // same agency typed with spaces
      acquisitionCost: 30000,
      sqlDecision: 'not_qualified',
    });
    await lead({
      inflowSource: 'telemarketing_agency',
      agencyName: 'A社',
      acquisitionCost: 30000,
    });
    // Agency B: 2 SQL, one cost not recorded yet
    await lead({
      inflowSource: 'referral_agency',
      agencyName: 'B社',
      acquisitionCost: 50000,
      sqlDecision: 'qualified',
    });
    await lead({ inflowSource: 'referral_agency', agencyName: 'B社', sqlDecision: 'qualified' });
    // Agency C: no SQL
    await lead({ inflowSource: 'referral_agency', agencyName: 'C社', acquisitionCost: 20000 });
    // Not an agency; legacy `source` must not matter
    await lead({ inflowSource: 'lp_organic', source: 'website' });
    await lead({ inflowSource: null, source: 'website' });
    await lead({ inflowSource: '', agencyName: '' }); // blank = 未設定, not an agency
    // First instant of the period (10/10 00:00 JST) is in; the one before is out
    await lead({ inflowSource: 'seminar', createdAt: new Date('2026-10-09T15:00:00Z') });
    await lead({
      inflowSource: 'seminar',
      agencyName: 'A社',
      acquisitionCost: 999999,
      createdAt: new Date('2026-10-09T14:59:59Z'),
    });
    // Another organization's leads never count
    await lead(
      {
        inflowSource: 'telemarketing_agency',
        agencyName: 'A社',
        acquisitionCost: 777777,
        sqlDecision: 'qualified',
      },
      otherOrganizationId
    );
    await lead({ inflowSource: 'advertising' }, otherOrganizationId);
  });

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, [organizationId, otherOrganizationId]));
    await client?.end();
  });

  it('counts leads by inflow_source, 未設定 (null or blank) last, in the JST period', async () => {
    expect(await getInflowSourceBreakdown(db, organizationId, from)).toEqual([
      { source: 'referral_agency', count: 3, percentage: 30 },
      { source: 'telemarketing_agency', count: 3, percentage: 30 },
      { source: 'lp_organic', count: 1, percentage: 10 },
      { source: 'seminar', count: 1, percentage: 10 },
      { source: 'unset', count: 2, percentage: 20 },
    ]);
  });

  it('includes the lead before the period for all time', async () => {
    const all = await getInflowSourceBreakdown(db, organizationId, null);
    expect(all.find((row) => row.source === 'seminar')?.count).toBe(2);
    expect(all.reduce((sum, row) => sum + row.count, 0)).toBe(11);
  });

  it('computes per-agency SQL rate and cost per SQL from acquisition_cost', async () => {
    expect(await getAgencyPerformance(db, organizationId, from)).toEqual([
      {
        agencyName: 'A社',
        leadCount: 3,
        sqlCount: 1,
        sqlRate: 33.33,
        wonCount: 1,
        costedLeadCount: 3,
        totalCost: 90000,
        costPerSql: 90000,
        deals: null,
      },
      {
        agencyName: 'B社',
        leadCount: 2,
        sqlCount: 2,
        sqlRate: 100,
        wonCount: 0,
        costedLeadCount: 1,
        totalCost: 50000,
        costPerSql: 25000,
        deals: null,
      },
      {
        agencyName: 'C社',
        leadCount: 1,
        sqlCount: 0,
        sqlRate: 0,
        wonCount: 0,
        costedLeadCount: 1,
        totalCost: 20000,
        costPerSql: null,
        deals: null,
      },
    ]);
  });

  it('sums acquisition cost by inflow source with per-SQL and per-win cost', async () => {
    const summary = await getAcquisitionCost(db, organizationId, from);
    expect(summary).toMatchObject({
      leadCount: 10,
      costedLeadCount: 5,
      sqlCount: 3,
      wonCount: 1,
      totalCost: 160000,
      costPerSql: 53333,
      costPerWon: 160000,
    });
    const tele = summary.bySource.find((row) => row.source === 'telemarketing_agency');
    expect(tele).toMatchObject({ totalCost: 90000, costPerSql: 90000, costPerWon: 90000 });
    const referral = summary.bySource.find((row) => row.source === 'referral_agency');
    expect(referral).toMatchObject({ totalCost: 70000, sqlCount: 2, costPerSql: 35000, costPerWon: null });
    expect(summary.bySource.at(-1)?.source).toBe('unset');
  });

  it('keeps organizations apart', async () => {
    expect(await getAgencyPerformance(db, otherOrganizationId, from)).toEqual([
      expect.objectContaining({ agencyName: 'A社', leadCount: 1, totalCost: 777777 }),
    ]);
    expect(await getInflowSourceBreakdown(db, otherOrganizationId, from)).toEqual([
      { source: 'advertising', count: 1, percentage: 50 },
      { source: 'telemarketing_agency', count: 1, percentage: 50 },
    ]);
  });

  // What the deals of the period's leads brought in (#448)
  it('adds the won amount, ROI and days to win of the deals, only when asked', async () => {
    const [agencyLead] = await lead({
      inflowSource: 'telemarketing_agency',
      agencyName: 'A社',
      createdAt: new Date('2026-10-12T03:00:00Z'), // 10/12 JST
    }).returning();
    const [organicLead] = await lead({ inflowSource: 'lp_organic' }).returning();
    const [oldLead] = await lead({
      inflowSource: 'telemarketing_agency',
      agencyName: 'A社',
      createdAt: new Date('2026-10-01T03:00:00Z'), // before the period
    }).returning();
    const [otherLead] = await lead(
      { inflowSource: 'telemarketing_agency', agencyName: 'A社' },
      otherOrganizationId
    ).returning();
    const deal = (leadId: string, values: Partial<typeof deals.$inferInsert>, orgId = organizationId) =>
      pg.insert(deals).values({ organizationId: orgId, leadId, name: '調査', ...values });
    await deal(agencyLead.id, { stage: 'won', amount: 450000, closedOn: '2026-10-26' });
    await deal(agencyLead.id, { kind: 'migration', stage: 'proposal', amount: 3000000 });
    await deal(organicLead.id, { stage: 'won', amount: 200000, closedOn: '2026-10-20' });
    await deal(oldLead.id, { stage: 'won', amount: 9_000_000, closedOn: '2026-10-05' });
    await deal(otherLead.id, { stage: 'won', amount: 8_000_000, closedOn: '2026-10-20' }, otherOrganizationId);

    // Not asked for (those who may not read deals): no amounts at all
    expect((await getAcquisitionCost(db, organizationId, from)).deals).toBeNull();

    const summary = await getAcquisitionCost(db, organizationId, from, { withDeals: true });
    const tele = summary.bySource.find((row) => row.source === 'telemarketing_agency');
    // 10/12 → 10/26 JST: 14 days; the open migration deal adds no amount; 90,000 yen spent
    expect(tele?.deals).toEqual({
      dealCount: 2,
      wonDealCount: 1,
      wonAmount: 450000,
      costPerWonDeal: 90000,
      roi: 5,
      medianDaysToWin: 14,
    });
    // Nothing spent on the organic lead: no ROI
    expect(summary.bySource.find((row) => row.source === 'lp_organic')?.deals).toMatchObject({
      wonAmount: 200000,
      roi: null,
    });
    // The lead before the period and the other organization's deal are not counted
    expect(summary.deals).toMatchObject({ dealCount: 3, wonDealCount: 2, wonAmount: 650000 });

    const agencies = await getAgencyPerformance(db, organizationId, from, { withDeals: true });
    expect(agencies.find((row) => row.agencyName === 'A社')?.deals).toMatchObject({
      dealCount: 2,
      wonAmount: 450000,
    });
    expect(agencies.find((row) => row.agencyName === 'B社')?.deals).toMatchObject({
      dealCount: 0,
      wonAmount: 0,
      roi: 0,
    });
    const other = await getAgencyPerformance(db, otherOrganizationId, from, { withDeals: true });
    expect(other[0].deals).toMatchObject({ dealCount: 1, wonAmount: 8_000_000 });
  });
});
