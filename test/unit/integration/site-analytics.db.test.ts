/**
 * Site analytics (#755) against PostgreSQL: daily visitors and page views of a period, from the
 * views of the last 90 days and the daily totals before them (a day counted once), the previous
 * period, page names, the organization's rows only, and who may read them. Totals only: no
 * visitor hash leaves the API.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/site-analytics.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  organizationMembers,
  organizations,
  siteVisitDaily,
  siteVisits,
  users,
} from '@/lib/db/schema';
import { getSiteOverview } from '@/lib/features/site-analytics/service';
import { appRouter } from '@/server/routers/_app';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

// "Today" in Japan for every test: 2026-10-30
const NOW = new Date('2026-10-30T03:00:00Z');

describe.skipIf(!url)('site analytics (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let orgA: string;
  let orgB: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `site-analytics-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string, role: schema.OrganizationRole) {
    const [user] = await pg
      .insert(users)
      .values({ email: `site-analytics-${unique()}@example.com`, name: 'Analytics' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  const view = (organizationId: string, day: string, path: string, pageType: string, visitor: string) => ({
    organizationId,
    day,
    path,
    pageType,
    device: 'desktop',
    visitorHash: `hash-${visitor}`,
  });

  beforeAll(async () => {
    orgA = await createOrganization('サイト分析A');
    orgB = await createOrganization('サイト分析B');
    await pg.insert(diagnoses).values({
      organizationId: orgA,
      slug: 'sa-dx-check',
      name: '架空の DX 診断',
      status: 'published',
      draftDefinition: cloudReadiness(),
    });
    await pg.insert(siteVisits).values([
      // Today: 2 visitors on the LP (one twice), 1 on a column
      view(orgA, '2026-10-30', '/ja/ax-migration', 'ax-lp', 'a'),
      view(orgA, '2026-10-30', '/ja/ax-migration', 'ax-lp', 'a'),
      view(orgA, '2026-10-30', '/ja/ax-migration', 'ax-lp', 'b'),
      view(orgA, '2026-10-30', '/ja/ax-migration/column/access-file-types', 'ax-column', 'a'),
      // 3 days ago: the same visitor hash on another day counts again
      view(orgA, '2026-10-27', '/ja/ax-migration', 'ax-lp', 'a'),
      view(orgA, '2026-10-27', '/ja/d/sa-dx-check', 'diagnosis', 'c'),
      // In the previous 7-day period (10/17-10/23)
      view(orgA, '2026-10-20', '/ja/ax-migration', 'ax-lp', 'd'),
      // Another organization: never counted for A
      view(orgB, '2026-10-30', '/ja/ax-migration', 'ax-lp', 'x'),
    ]);
    await pg.insert(siteVisitDaily).values([
      // Before the 90 days of views: taken from the daily totals
      { organizationId: orgA, day: '2026-07-20', path: '/ja/ax-migration', pageType: 'ax-lp', visitors: 5, pageviews: 9 },
      // A day that also has views: the views win, the total is not added on top
      { organizationId: orgA, day: '2026-10-27', path: '/ja/ax-migration', pageType: 'ax-lp', visitors: 50, pageviews: 50 },
    ]);
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('counts the visitors per day and the pages of the period', async () => {
    const overview = await getSiteOverview(pg as never, { organizationId: orgA, days: 7, now: NOW });
    expect(overview.from).toBe('2026-10-24');
    expect(overview.to).toBe('2026-10-30');
    expect(overview.days).toHaveLength(7);
    expect(overview.days.find((d) => d.day === '2026-10-30')).toEqual({
      day: '2026-10-30',
      visitors: 3,
      pageviews: 4,
    });
    expect(overview.days.find((d) => d.day === '2026-10-27')).toEqual({
      day: '2026-10-27',
      visitors: 2,
      pageviews: 2,
    });
    expect(overview.days.find((d) => d.day === '2026-10-25')).toEqual({
      day: '2026-10-25',
      visitors: 0,
      pageviews: 0,
    });
    expect(overview.totals).toEqual({ visitors: 5, pageviews: 6 });
    expect(overview.previous).toEqual({ visitors: 1, pageviews: 1 });
    expect(overview.lastRecordedDay).toBe('2026-10-30');
  });

  it('names the pages: column titles and diagnosis names, the rest by type', async () => {
    const { pages } = await getSiteOverview(pg as never, { organizationId: orgA, days: 7, now: NOW });
    expect(pages.map(({ path, pageType, visitors, pageviews }) => ({ path, pageType, visitors, pageviews }))).toEqual([
      { path: '/ja/ax-migration', pageType: 'ax-lp', visitors: 3, pageviews: 4 },
      { path: '/ja/ax-migration/column/access-file-types', pageType: 'ax-column', visitors: 1, pageviews: 1 },
      { path: '/ja/d/sa-dx-check', pageType: 'diagnosis', visitors: 1, pageviews: 1 },
    ]);
    expect(pages[0].title).toBeNull();
    expect(pages[1].title).toEqual(expect.any(String));
    expect(pages[2].title).toBe('架空の DX 診断');
  });

  it('takes days before the 90 days of views from the daily totals', async () => {
    const overview = await getSiteOverview(pg as never, { organizationId: orgA, days: 90, now: NOW });
    // 90 days including today: 8/2-10/30
    expect(overview.from).toBe('2026-08-02');
    // 10/20 is inside the 90 days now
    expect(overview.totals).toEqual({ visitors: 6, pageviews: 7 });
    // The previous 90 days include 7/20 from the daily totals
    expect(overview.previous).toEqual({ visitors: 5, pageviews: 9 });
  });

  it('lets members read their own organization only, and not parent organization viewers', async () => {
    const member = await callerFor(orgA, 'member');
    const result = await member.siteAnalytics.overview({ organizationId: orgA, days: 7 });
    expect(result.totals.visitors).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('hash-');

    const viewer = await callerFor(orgA, 'parent_viewer');
    await expect(viewer.siteAnalytics.overview({ organizationId: orgA, days: 7 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const memberB = await callerFor(orgB, 'admin');
    await expect(memberB.siteAnalytics.overview({ organizationId: orgA, days: 7 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('reports nothing recorded for an organization without views', async () => {
    const orgC = await createOrganization('サイト分析C');
    const overview = await getSiteOverview(pg as never, { organizationId: orgC, days: 30, now: NOW });
    expect(overview.lastRecordedDay).toBeNull();
    expect(overview.totals).toEqual({ visitors: 0, pageviews: 0 });
    expect(overview.pages).toEqual([]);
    expect(overview.days).toHaveLength(30);
  });
});
