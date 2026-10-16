/**
 * Analytics aggregations from the lead's own records (#138):
 * 流入元 (inflow_source), acquisition_cost, agency_name; response time pending until #136.
 */
import {
  UNSET_INFLOW_SOURCE,
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
      },
    ]);
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
