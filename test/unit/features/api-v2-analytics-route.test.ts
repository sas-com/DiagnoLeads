/**
 * REST API v2 analytics (GET /api/v2/analytics): the real handler is called with the real query
 * schema and drizzle conditions; the authentication and the database are mocked. Each of the
 * four aggregate queries is checked to be limited to the authenticated organization.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

/** One db.select() chain: records its where condition and resolves to the next queued rows */
interface SelectCall {
  where?: unknown;
}

const { db, selects, results, getAuthenticatedOrganization } = vi.hoisted(() => {
  const selects: SelectCall[] = [];
  const results: unknown[][] = [];
  const db = {
    select: vi.fn(() => {
      const call: SelectCall = {};
      selects.push(call);
      const rows = results.shift() ?? [];
      const builder = {
        from: () => builder,
        where: (condition: unknown) => {
          call.where = condition;
          return builder;
        },
        groupBy: () => builder,
        orderBy: () => builder,
        // biome-ignore lint/suspicious/noThenProperty: drizzle query builders are thenables
        then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return builder;
    }),
  };
  return { db, selects, results, getAuthenticatedOrganization: vi.fn() };
});

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/api/v2-auth', () => ({ getAuthenticatedOrganization }));

const { GET } = await import('@/app/api/v2/analytics/route');

const toQuery = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL);
const get = (query = '') => GET(new NextRequest(`http://localhost/api/v2/analytics${query}`));

/** Queue the rows of the overview, status, source and daily trend queries, in that order */
function queue(overview: unknown[], status: unknown[], source: unknown[], trend: unknown[]) {
  results.push(overview, status, source, trend);
}

describe('GET /api/v2/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selects.length = 0;
    results.length = 0;
    getAuthenticatedOrganization.mockResolvedValue({ organizationId: ORG_ID, userId: 'user-1' });
  });
  afterEach(() => vi.useRealTimers());

  it('answers 401 without an authenticated organization and reads nothing', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    const res = await get();

    expect(res.status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
  });

  it.each([
    ['a start date that is not an ISO date-time', '?startDate=2026-10-01'],
    ['an unknown grouping', '?groupBy=year'],
  ])('rejects %s with 400 and reads nothing', async (_label, query) => {
    const res = await get(query);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation Error');
    expect(json.details).toBeDefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('limits every aggregate to the organization and the requested period', async () => {
    queue([{ totalLeads: 0, avgScore: null }], [], [], []);

    const res = await get('?startDate=2026-10-01T00:00:00Z&endDate=2026-10-24T23:59:59Z');

    expect(res.status).toBe(200);
    expect(selects).toHaveLength(4);
    for (const call of selects) {
      const where = toQuery(call.where);
      expect(where.sql).toBe(
        '("leads"."organization_id" = $1 and "leads"."created_at" >= $2 and "leads"."created_at" <= $3)'
      );
      expect(where.params).toEqual([
        ORG_ID,
        '2026-10-01T00:00:00.000Z',
        '2026-10-24T23:59:59.000Z',
      ]);
    }
    expect((await res.json()).meta.dateRange).toEqual({
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-24T23:59:59Z',
    });
  });

  it('counts the whole history but trends the last 30 days when no period is given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'));
    queue([{ totalLeads: 0, avgScore: null }], [], [], []);

    const res = await get();

    const [overview, , , trend] = selects.map((call) => toQuery(call.where));
    expect(overview.sql).toBe('"leads"."organization_id" = $1');
    expect(overview.params).toEqual([ORG_ID]);
    expect(trend.params).toEqual([ORG_ID, '2026-09-25T00:00:00.000Z', '2026-10-25T00:00:00.000Z']);
    expect((await res.json()).meta.dateRange).toEqual({
      start: '2026-09-25T00:00:00.000Z',
      end: '2026-10-25T00:00:00.000Z',
    });
  });

  it('turns the rows into totals, rounded averages, shares and the conversion rate', async () => {
    queue(
      [{ totalLeads: 4, avgScore: '62.5' }],
      [
        { status: 'won', count: 1 },
        { status: 'new', count: 3 },
      ],
      [
        { source: 'ax-migration', count: 3 },
        { source: null, count: 1 },
      ],
      [
        { date: '2026-10-23', count: 3, avgScore: '70.333333' },
        { date: '2026-10-24', count: 1, avgScore: null },
      ]
    );

    const res = await get();

    expect((await res.json()).data).toEqual({
      overview: { totalLeads: 4, averageScore: 62.5, conversionRate: 25 },
      statusBreakdown: [
        { status: 'won', count: 1, percentage: 25 },
        { status: 'new', count: 3, percentage: 75 },
      ],
      sourceBreakdown: [
        { source: 'ax-migration', count: 3, percentage: 75 },
        { source: 'unknown', count: 1, percentage: 25 },
      ],
      trend: [
        { date: '2026-10-23', count: 3, avgScore: 70.33 },
        { date: '2026-10-24', count: 1, avgScore: null },
      ],
    });
  });

  it('answers zeros instead of dividing by zero for an organization without leads', async () => {
    queue(
      [{ totalLeads: 0, avgScore: null }],
      [{ status: 'new', count: 0 }],
      [{ source: 'api', count: 0 }],
      []
    );

    const res = await get();

    const { data } = await res.json();
    expect(data.overview).toEqual({ totalLeads: 0, averageScore: null, conversionRate: 0 });
    expect(data.statusBreakdown[0].percentage).toBe(0);
    expect(data.sourceBreakdown[0].percentage).toBe(0);
  });

  it('answers 500 without details when the database fails', async () => {
    db.select.mockImplementationOnce(() => {
      throw new Error('db down');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to fetch analytics',
    });
    errorSpy.mockRestore();
  });
});
