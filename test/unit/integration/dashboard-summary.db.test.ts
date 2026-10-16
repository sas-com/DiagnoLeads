/**
 * Dashboard figures on a real PostgreSQL.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/dashboard-summary.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { diagnosticSubmissions, leads, organizations } from '@/lib/db/schema';
import { dashboardPeriod, getDashboardSummary, jstDay } from '@/lib/features/analytics/dashboard';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('dashboard summary (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof getDashboardSummary>[0];
  // Friday 2026-10-16 15:00 JST
  const now = new Date('2026-10-16T06:00:00Z');
  const at = (iso: string) => new Date(iso);
  let organizationId: string;
  let otherOrganizationId: string;

  const lead = async (values: Partial<typeof leads.$inferInsert> & { createdAt: Date }, orgId = organizationId) => {
    const [row] = await pg
      .insert(leads)
      .values({
        organizationId: orgId,
        email: `${Math.random().toString(36).slice(2)}@example.com`,
        status: 'new',
        ...values,
      })
      .returning();
    return row;
  };
  const ax = (platform: string) => ({ axMigration: { platform } });

  beforeAll(async () => {
    const unique = Date.now();
    organizationId = (
      await pg.insert(organizations).values({ name: 'ダッシュボード', slug: `dash-${unique}` }).returning()
    )[0].id;
    otherOrganizationId = (
      await pg.insert(organizations).values({ name: '別組織', slug: `dash-other-${unique}` }).returning()
    )[0].id;

    // This week (7-day period starts 2026-10-10 00:00 JST)
    await lead({ createdAt: at('2026-10-15T23:30:00Z'), score: 80, responses: ax('as400') }); // 10/16 JST
    await lead({ createdAt: at('2026-10-16T01:00:00Z'), score: 60, responses: ax('as400') }); // 10/16
    const consult = await lead({
      createdAt: at('2026-10-13T02:00:00Z'), // Tue 10/13 JST
      score: 90,
      conversionPoint: 'consultation',
      mqlQualifiedAt: at('2026-10-13T02:00:00Z'),
      responses: ax('acos'),
      name: '期限切れ',
    });
    // Asked for a consultation from a later diagnosis: the deadline counts from that request
    const later = await lead({
      createdAt: at('2026-10-09T10:00:00Z'), // 10/9 JST, before the period
      conversionPoint: 'consultation',
      responses: ax('access'),
      name: '後から相談',
    });
    await pg.insert(diagnosticSubmissions).values([
      {
        organizationId,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 1,
        answers: {},
        result: {},
        leadId: consult.id,
        consultationRequestedAt: at('2026-10-13T02:00:00Z'),
      },
      {
        organizationId,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 1,
        answers: {},
        result: {},
        leadId: later.id,
        consultationRequestedAt: at('2026-10-15T03:00:00Z'), // Thu 10/15 JST → due Mon 10/19
      },
      // A submission of another organization pointing at the same lead never moves its deadline
      {
        organizationId: otherOrganizationId,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 1,
        answers: {},
        result: {},
        leadId: later.id,
        consultationRequestedAt: at('2026-09-01T03:00:00Z'),
      },
    ] as (typeof diagnosticSubmissions.$inferInsert)[]);
    // Already contacted: not waiting any more
    await lead({ createdAt: at('2026-10-12T02:00:00Z'), conversionPoint: 'consultation', status: 'nurturing' });
    // Previous period (2026-10-03 .. 10-09 JST)
    await lead({ createdAt: at('2026-10-05T02:00:00Z'), conversionPoint: 'consultation' });
    await lead({ createdAt: at('2026-10-09T14:59:00Z'), mqlQualifiedAt: at('2026-10-09T14:59:00Z') }); // 10/9 23:59 JST
    // Another organization is never counted
    await lead({ createdAt: at('2026-10-16T01:00:00Z'), conversionPoint: 'consultation' }, otherOrganizationId);
  });

  afterAll(async () => {
    for (const id of [organizationId, otherOrganizationId]) {
      if (id) await pg.delete(organizations).where(eq(organizations.id, id));
    }
    await client?.end();
  });

  it('uses Japanese calendar days for the period', () => {
    expect(jstDay(at('2026-10-15T15:00:00Z'))).toBe('2026-10-16');
    const { from, previousFrom } = dashboardPeriod(7, now);
    expect(from.toISOString()).toBe('2026-10-09T15:00:00.000Z');
    expect(previousFrom.toISOString()).toBe('2026-10-02T15:00:00.000Z');
  });

  it('counts the period against the previous period of the same length, per organization', async () => {
    const s = await getDashboardSummary(db, organizationId, 7, now);

    expect(s.newLeads).toBe(4); // 10/16 x2, 10/13, 10/12
    expect(s.previousNewLeads).toBe(3); // 10/5, 10/9 x2
    expect(s.consultations).toBe(2);
    expect(s.previousConsultations).toBe(2);
    expect(s.mql).toBe(1);
    expect(s.previousMql).toBe(1);
    expect(s.averageScore).toBe(77); // (80 + 60 + 90) / 3
    expect(s.previousAverageScore).toBeNull(); // no scored lead in the previous period
  });

  it('counts MQL as 関心あり only and 適合 only apart (#139)', async () => {
    const [own] = await pg
      .insert(organizations)
      .values({ name: '適合', slug: `dash-fit-${Date.now()}` })
      .returning();
    try {
      const mql = (level: string) => ({ axMigration: { platform: 'as400', mql: { level, signals: [], unmet: [] } } });
      const createdAt = at('2026-10-14T01:00:00Z');
      await lead({ createdAt, responses: mql('interest'), mqlQualifiedAt: createdAt }, own.id);
      await lead({ createdAt, responses: mql('fit') }, own.id);
      await lead({ createdAt, responses: mql('fit') }, own.id);
      // Marketing confirmed it as an MQL by hand: no longer 適合 only
      await lead({ createdAt, responses: mql('fit'), mqlQualifiedAt: createdAt }, own.id);
      await lead({ createdAt, responses: mql('none') }, own.id);
      // Before the period
      await lead({ createdAt: at('2026-10-01T01:00:00Z'), responses: mql('fit') }, own.id);

      const s = await getDashboardSummary(db, own.id, 7, now);
      expect(s.mql).toBe(2);
      expect(s.fitOnly).toBe(2);
    } finally {
      await pg.delete(organizations).where(eq(organizations.id, own.id));
    }
  });

  it('lists every day of the period, with zero for days without leads', async () => {
    const s = await getDashboardSummary(db, organizationId, 7, now);

    expect(s.daily.map((d) => d.date)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
    ]);
    expect(s.daily.find((d) => d.date === '2026-10-16')).toEqual({ date: '2026-10-16', leads: 2, consultations: 0 });
    expect(s.daily.find((d) => d.date === '2026-10-13')).toEqual({ date: '2026-10-13', leads: 1, consultations: 1 });
    expect(s.daily.find((d) => d.date === '2026-10-14')?.leads).toBe(0);
    expect(s.trend.unit).toBe('day');
    expect(s.trend.points).toHaveLength(7);
  });

  it('adds up weeks for 90 days', async () => {
    const s = await getDashboardSummary(db, organizationId, 90, now);

    expect(s.trend.unit).toBe('week');
    expect(s.trend.points.at(-1)).toEqual({
      start: '2026-10-12',
      end: '2026-10-16',
      leads: 4,
      consultations: 2, // 10/13 and the one already contacted on 10/12
    });
    expect(s.trend.points.reduce((sum, p) => sum + p.leads, 0)).toBe(s.newLeads);
  });

  it('lists consultation requests waiting for contact by deadline, flagging overdue ones', async () => {
    const s = await getDashboardSummary(db, organizationId, 7, now);

    // Waiting requests are listed whenever they came in, not only within the period
    expect(s.pendingConsultationTotal).toBe(3);
    expect(s.pendingConsultations.map((p) => [p.name, p.deadline, p.overdue])).toEqual([
      [null, '2026/10/07', true], // asked Mon 10/5 (previous period) → due Wed 10/7
      ['期限切れ', '2026/10/15', true], // asked Tue 10/13 → due Thu 10/15
      ['後から相談', '2026/10/19', false], // asked Thu 10/15 → due Mon 10/19
    ]);
    // Seen on Friday 10/16: business days late, or left
    expect(s.pendingConsultations.map((p) => [p.due, p.businessDays])).toEqual([
      ['overdue', 7],
      ['overdue', 1],
      ['later', 1],
    ]);
  });

  it('breaks the period down by migration source and shows the whole pipeline', async () => {
    const s = await getDashboardSummary(db, organizationId, 7, now);

    expect(s.platforms).toEqual(
      expect.arrayContaining([
        { platform: 'as400', count: 2 },
        { platform: 'acos', count: 1 },
        { platform: 'unknown', count: 1 },
      ])
    );
    expect(s.platforms[0]).toEqual({ platform: 'as400', count: 2 });
    expect(s.statuses.find((x) => x.status === 'new')?.count).toBe(6);
    expect(s.statuses.find((x) => x.status === 'nurturing')?.count).toBe(1);
    expect(s.recentLeads[0].createdAt.getTime()).toBe(at('2026-10-16T01:00:00Z').getTime());
    expect(s.recentLeads).toHaveLength(6);
    expect(s.recentLeads[0]).toMatchObject({ status: 'new', mql: false });
    expect(s.recentLeads.find((l) => l.name === '期限切れ')).toMatchObject({ mql: true, consultation: true });
    expect(s.platforms.at(-1)?.platform).toBe('unknown');
  });

  it('reports no average score when the period has no leads', async () => {
    const s = await getDashboardSummary(db, organizationId, 7, new Date('2026-12-01T00:00:00Z'));
    expect(s.newLeads).toBe(0);
    expect(s.averageScore).toBeNull();
    expect(s.pendingConsultationTotal).toBe(3);
  });
});
