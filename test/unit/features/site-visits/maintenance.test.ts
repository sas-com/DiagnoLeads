/**
 * The daily maintenance of the visit measurement (lib/features/site-visits/maintenance.ts, #412)
 * without a database (#6): the days whose totals are written (the last days, and the days about
 * to be deleted so a missed run loses none), what is deleted, and the order of the steps. The
 * database is test/mocks/recording-db.ts; the totals and the deletions on a real PostgreSQL are
 * covered by test/unit/integration/site-visits.db.test.ts.
 */
import { publicRateLimits, siteVisitSalts, siteVisits } from '@/lib/db/schema';
import {
  SITE_VISIT_RETENTION_DAYS,
  maintainSiteVisits,
} from '@/lib/features/site-visits/maintenance';
import { type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { beforeEach, describe, expect, it } from 'vitest';

type Database = Parameters<typeof maintainSiteVisits>[0];

// 2026-10-23, 12:00 in Japan
const NOW = new Date('2026-10-23T03:00:00Z');

let fake: RecordingDb;
const db = () => fake.db as unknown as Database;

beforeEach(() => {
  fake = recordingDb();
});

describe('maintainSiteVisits', () => {
  it('keeps single views for 90 days', () => {
    expect(SITE_VISIT_RETENTION_DAYS).toBe(90);
  });

  it('writes the totals of the last two days and of the days about to be deleted, in one statement', async () => {
    fake.results.push(Object.assign([], { count: 7 }));

    await maintainSiteVisits(db(), NOW);

    const [totals] = fake.calls;
    expect(totals.op).toBe('execute');
    const statement = sqlOf(totals.statement);
    expect(statement.sql).toContain('insert into site_visit_daily');
    expect(statement.sql).toContain('on conflict (organization_id, day, path) do update set');
    // Grouped per organization, so no organization's totals mix with another's
    expect(statement.sql).toContain('group by organization_id, day, path');
    expect(statement.sql).toContain('where day >= $2::date or day < $3::date');
    expect(statement.params).toEqual([NOW.toISOString(), '2026-10-21', '2026-07-25']);
  });

  it('deletes the views older than the retention, the salts of past days and ended rate limit windows', async () => {
    fake.results.push(Object.assign([], { count: 0 }), [{ id: 'v1' }, { id: 'v2' }]);

    await maintainSiteVisits(db(), NOW);

    const deletes = fake.calls.filter((call) => call.op === 'delete');
    const [views, salts, ...rateLimits] = deletes;
    expect(views.table).toBe(siteVisits);
    expect(sqlOf(views.where)).toEqual({ sql: '"site_visits"."day" < $1', params: ['2026-07-25'] });
    expect(views.returning).toBeDefined();
    expect(salts.table).toBe(siteVisitSalts);
    // Today's salt stays: the views of today still use it
    expect(sqlOf(salts.where)).toEqual({
      sql: '"site_visit_salts"."day" < $1',
      params: ['2026-10-23'],
    });
    // The views add a rate limit window per address and day: 40 batches of the clean-up
    expect(rateLimits).toHaveLength(40);
    for (const call of rateLimits) expect(call.table).toBe(publicRateLimits);
  });

  it('writes the totals before deleting the views they count', async () => {
    // When each query is awaited and when its answer comes: building the queries in this order
    // and then running them side by side (Promise.all) would delete views not yet counted
    const steps: string[] = [];
    fake = recordingDb(async (call) => {
      steps.push(`start ${call.op}`);
      await Promise.resolve();
      steps.push(`end ${call.op}`);
      return undefined;
    });

    await maintainSiteVisits(db(), NOW);

    expect(steps.slice(0, 6)).toEqual([
      'start execute',
      'end execute',
      'start delete',
      'end delete',
      'start delete',
      'end delete',
    ]);
  });

  it('returns the days counted and the views deleted', async () => {
    fake.results.push(Object.assign([], { count: 5 }), [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]);

    expect(await maintainSiteVisits(db(), NOW)).toEqual({ daysCounted: 5, deleted: 3 });
  });

  it('counts no days when the driver reports no count', async () => {
    fake.results.push([], []);

    expect(await maintainSiteVisits(db(), NOW)).toEqual({ daysCounted: 0, deleted: 0 });
  });

  it('dates the day in Japan time, so a run just after midnight in Japan starts the new day', async () => {
    // 2026-10-24, 00:30 in Japan
    await maintainSiteVisits(db(), new Date('2026-10-23T15:30:00Z'));

    const salts = fake.calls.filter((call) => call.op === 'delete')[1];
    expect(sqlOf(salts.where).params).toEqual(['2026-10-24']);
    expect(sqlOf(fake.calls[0].statement).params.slice(1)).toEqual(['2026-10-22', '2026-07-26']);
  });
});
