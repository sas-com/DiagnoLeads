/**
 * Analytics aggregations from the lead's own records (#138):
 * 流入元 (inflow_source), acquisition_cost, agency_name; response time pending until #136.
 */
import {
  type DealOfLead,
  UNSET_INFLOW_SOURCE,
  dealReturns,
  summarizeAcquisitionCost,
  summarizeAgencies,
  summarizeInflowSources,
} from '@/lib/features/analytics/lead-sources';
import { analyticsPeriodStart, jstMonthStart } from '@/lib/features/analytics/period';
import {
  bucketResponseTimes,
  getResponseTimeDistribution,
} from '@/lib/features/analytics/response-time';
import { describe, expect, it } from 'vitest';

describe('summarizeInflowSources', () => {
  it('orders by count with 未設定 last, whatever its size', () => {
    const result = summarizeInflowSources([
      { source: 'seminar', count: 2 },
      { source: UNSET_INFLOW_SOURCE, count: 10 },
      { source: 'lp_organic', count: 6 },
      { source: 'advertising', count: 2 },
    ]);
    expect(result.map((row) => row.source)).toEqual([
      'lp_organic',
      'advertising',
      'seminar',
      UNSET_INFLOW_SOURCE,
    ]);
    expect(result.map((row) => row.percentage)).toEqual([30, 10, 10, 50]);
  });

  it('returns nothing for no leads', () => {
    expect(summarizeInflowSources([])).toEqual([]);
  });
});

describe('summarizeAcquisitionCost', () => {
  it('sums the recorded costs and divides by SQL and wins', () => {
    const summary = summarizeAcquisitionCost([
      {
        source: 'telemarketing_agency',
        leadCount: 4,
        costedLeadCount: 4,
        sqlCount: 2,
        wonCount: 1,
        totalCost: 120_000,
      },
      {
        source: UNSET_INFLOW_SOURCE,
        leadCount: 5,
        costedLeadCount: 0,
        sqlCount: 1,
        wonCount: 0,
        totalCost: 0,
      },
      {
        source: 'advertising',
        leadCount: 3,
        costedLeadCount: 2,
        sqlCount: 0,
        wonCount: 0,
        totalCost: 10_000,
      },
    ]);
    expect(summary.bySource.map((row) => row.source)).toEqual([
      'telemarketing_agency',
      'advertising',
      UNSET_INFLOW_SOURCE,
    ]);
    expect(summary.bySource[0]).toMatchObject({ costPerSql: 60_000, costPerWon: 120_000 });
    // No SQL / no win: no unit cost rather than a made-up number
    expect(summary.bySource[1]).toMatchObject({ costPerSql: null, costPerWon: null });
    expect(summary).toMatchObject({
      leadCount: 12,
      costedLeadCount: 6,
      sqlCount: 3,
      wonCount: 1,
      totalCost: 130_000,
      costPerSql: 43_333,
      costPerWon: 130_000,
    });
  });

  it('is all zero without leads', () => {
    expect(summarizeAcquisitionCost([])).toEqual({
      leadCount: 0,
      costedLeadCount: 0,
      sqlCount: 0,
      wonCount: 0,
      totalCost: 0,
      costPerSql: null,
      costPerWon: null,
      deals: null,
      bySource: [],
    });
  });
});

describe('summarizeAgencies', () => {
  it('computes SQL rate and cost per SQL per agency, larger agencies first', () => {
    const rows = summarizeAgencies([
      {
        agencyName: 'B社',
        leadCount: 2,
        sqlCount: 0,
        wonCount: 0,
        costedLeadCount: 2,
        totalCost: 60_000,
      },
      {
        agencyName: 'A社',
        leadCount: 3,
        sqlCount: 1,
        wonCount: 1,
        costedLeadCount: 3,
        totalCost: 90_000,
      },
    ]);
    expect(rows).toEqual([
      {
        agencyName: 'A社',
        leadCount: 3,
        sqlCount: 1,
        sqlRate: 33.33,
        wonCount: 1,
        costedLeadCount: 3,
        totalCost: 90_000,
        costPerSql: 90_000,
        deals: null,
      },
      {
        agencyName: 'B社',
        leadCount: 2,
        sqlCount: 0,
        sqlRate: 0,
        wonCount: 0,
        costedLeadCount: 2,
        totalCost: 60_000,
        costPerSql: null,
        deals: null,
      },
    ]);
  });
});

// What the deals of the leads brought in (#448)
describe('dealReturns', () => {
  let nextLead = 0;
  const deal = (overrides: Partial<DealOfLead> = {}): DealOfLead => ({
    leadId: `lead-${(nextLead += 1)}`,
    source: 'lp_organic',
    agencyName: null,
    stage: 'proposal',
    amount: null,
    daysToClose: null,
    ...overrides,
  });

  it('adds up the won deals, the cost per win, the ROI and the median days to win', () => {
    const result = dealReturns(
      [
        deal({ stage: 'won', amount: 500_000, daysToClose: 30 }),
        deal({ stage: 'won', amount: 1_000_000, daysToClose: 10 }),
        deal({ stage: 'won', amount: null, daysToClose: 20 }),
        deal({ stage: 'lost', amount: 2_000_000, daysToClose: 5 }),
        deal(),
      ],
      300_000
    );
    expect(result).toEqual({
      dealCount: 5,
      wonDealCount: 3,
      wonAmount: 1_500_000,
      costPerWonDeal: 100_000,
      roi: 5,
      medianDaysToWin: 20,
    });
  });

  it('has no ROI when nothing was spent, and no cost per win or median without a win', () => {
    expect(dealReturns([deal({ stage: 'won', amount: 100, daysToClose: 3 })], 0)).toMatchObject({
      roi: null,
      costPerWonDeal: 0,
    });
    expect(dealReturns([deal()], 50_000)).toMatchObject({
      wonDealCount: 0,
      costPerWonDeal: null,
      roi: 0,
      medianDaysToWin: null,
    });
    // An even number of wins takes the middle two
    expect(
      dealReturns(
        [deal({ stage: 'won', daysToClose: 4 }), deal({ stage: 'won', daysToClose: 9 })],
        1
      ).medianDaysToWin
    ).toBe(6.5);
  });

  it("takes each lead's first win for the days to win", () => {
    // One lead won a survey on day 10 and a migration on day 200; another won on day 30
    const result = dealReturns(
      [
        deal({ leadId: 'a', stage: 'won', daysToClose: 200 }),
        deal({ leadId: 'a', stage: 'won', daysToClose: 10 }),
        deal({ leadId: 'b', stage: 'won', daysToClose: 30 }),
      ],
      1
    );
    expect(result.wonDealCount).toBe(3);
    expect(result.medianDaysToWin).toBe(20);
  });

  it('splits the deals by 流入元 and by agency, and leaves them out when not given', () => {
    const summary = summarizeAcquisitionCost(
      [
        { source: 'lp_organic', leadCount: 2, costedLeadCount: 0, sqlCount: 1, wonCount: 1, totalCost: 0 },
        {
          source: 'telemarketing_agency',
          leadCount: 3,
          costedLeadCount: 3,
          sqlCount: 1,
          wonCount: 1,
          totalCost: 90_000,
        },
      ],
      [
        deal({ stage: 'won', amount: 200_000, daysToClose: 7 }),
        deal({ source: 'telemarketing_agency', agencyName: 'A社', stage: 'won', amount: 450_000 }),
      ]
    );
    const bySource = Object.fromEntries(summary.bySource.map((row) => [row.source, row.deals]));
    expect(bySource.lp_organic).toMatchObject({ wonAmount: 200_000, roi: null });
    expect(bySource.telemarketing_agency).toMatchObject({ wonAmount: 450_000, roi: 5 });
    expect(summary.deals).toMatchObject({ dealCount: 2, wonAmount: 650_000 });

    const agencies = summarizeAgencies(
      [{ agencyName: 'A社', leadCount: 3, sqlCount: 1, wonCount: 1, costedLeadCount: 3, totalCost: 90_000 }],
      [deal({ agencyName: 'A社', stage: 'won', amount: 450_000 }), deal({ agencyName: 'B社' })]
    );
    expect(agencies[0].deals).toMatchObject({ dealCount: 1, wonAmount: 450_000 });
  });
});

describe('response time', () => {
  it('is pending until the first contact is recorded (#136), never computed from updatedAt', async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('no query may run');
        },
      }
    ) as Parameters<typeof getResponseTimeDistribution>[0];
    await expect(getResponseTimeDistribution(db, 'org', null)).resolves.toEqual({
      status: 'pending',
      reason: 'first_contact_not_recorded',
    });
  });

  it('buckets hours to the first contact for #136', () => {
    const result = bucketResponseTimes([0.5, 2, 30, 100, 200]);
    expect(result.map((row) => [row.period, row.count])).toEqual([
      ['< 1 hour', 1],
      ['1-24 hours', 1],
      ['1-3 days', 1],
      ['3+ days', 2],
    ]);
    expect(result[3]).toMatchObject({ percentage: 40, averageHours: 150 });
  });
});

describe('analytics period (JST, like the dashboard)', () => {
  // Friday 2026-10-16 08:30 JST = 10-15 23:30 UTC
  const now = new Date('2026-10-15T23:30:00Z');

  it('starts at 00:00 JST of the first day; 7 days is today and the six days before', () => {
    expect(analyticsPeriodStart('7d', now)?.toISOString()).toBe('2026-10-09T15:00:00.000Z');
    expect(analyticsPeriodStart('30d', now)?.toISOString()).toBe('2026-09-16T15:00:00.000Z');
    expect(analyticsPeriodStart('all', now)).toBeNull();
  });

  it('takes the month in Japan', () => {
    expect(jstMonthStart(new Date('2026-09-30T16:00:00Z')).toISOString()).toBe(
      '2026-09-30T15:00:00.000Z'
    );
  });
});
