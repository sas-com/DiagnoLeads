/**
 * The site's own visit measurement (#412) against PostgreSQL: each view lands in the organization
 * whose page it is, the IP address and the browser are never stored, a visitor counts once per
 * day and cannot be matched across days, one visitor cannot flood the table, and the daily
 * maintenance keeps the totals while deleting old views and past salts.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/site-visits.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  organizations,
  siteVisitDaily,
  siteVisitSalts,
  siteVisits,
} from '@/lib/db/schema';
import { createHash } from 'node:crypto';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import { rateLimitKey } from '@/lib/features/diagnostics/rate-limit';
import { maintainSiteVisits } from '@/lib/features/site-visits/maintenance';
import { sitePageOf } from '@/lib/features/site-visits/pages';
import {
  SITE_VISIT_DAILY_CAP,
  SITE_VISIT_RATE_LIMIT,
  SITE_VISIT_RATE_LIMIT_48,
  recordSiteVisit,
} from '@/lib/features/site-visits/record';
import { visitParamsOf } from '@/lib/features/site-visits/request';
import { forgetDaySaltForTests } from '@/lib/features/site-visits/visitor';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

// The operating organization: the company's own pages (AX site, top page, landing) belong to it
const { owners } = vi.hoisted(() => ({ owners: { operator: crypto.randomUUID() } }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => owners.operator,
}));

const url = process.env.TEST_DATABASE_URL;

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IP = '203.0.113.77';

describe.skipIf(!url)('site visits (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  let axOrg: string;
  let builderOrg: string;
  let builderSlug: string;

  async function createOrganization(name: string, id?: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ id, name, slug: `visits-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function publishDiagnosis(organizationId: string, slug: string) {
    const definition = cloudReadiness();
    const [row] = await pg
      .insert(diagnoses)
      .values({ organizationId, slug, name: '架空の診断', status: 'published', draftDefinition: definition })
      .returning({ id: diagnoses.id });
    const [version] = await pg
      .insert(diagnosisVersions)
      .values({
        diagnosisId: row.id,
        organizationId,
        version: 1,
        definition,
        definitionHash: hashDefinition(definition),
        changeSummary: {
          previousVersion: null,
          questionsAdded: [],
          questionsRemoved: [],
          questionsChanged: [],
          partsChanged: [],
        },
        publishedAt: new Date('2026-10-01T00:00:00Z'),
      })
      .returning({ id: diagnosisVersions.id });
    await pg.update(diagnoses).set({ currentVersionId: version.id }).where(eq(diagnoses.id, row.id));
  }

  const view = (
    path: string,
    overrides: Partial<{ ip: string; userAgent: string; now: Date; search: string }> = {}
  ) => {
    const page = sitePageOf(path);
    if (!page) throw new Error(`not measured: ${path}`);
    return recordSiteVisit(pg, {
      page,
      params: visitParamsOf(overrides.search ?? ''),
      referrerHost: 'www.google.com',
      ip: overrides.ip ?? IP,
      userAgent: overrides.userAgent ?? CHROME,
      now: overrides.now,
    });
  };

  const visitsOf = (organizationId: string) =>
    pg.select().from(siteVisits).where(eq(siteVisits.organizationId, organizationId));

  beforeAll(async () => {
    axOrg = await createOrganization('計測 運営', owners.operator);
    builderOrg = await createOrganization('計測 ビルダー');
    builderSlug = `visits-${unique()}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    await publishDiagnosis(builderOrg, builderSlug);
  });

  beforeEach(async () => {
    await pg.delete(siteVisits).where(inArray(siteVisits.organizationId, organizationIds));
    await pg.delete(siteVisitDaily).where(inArray(siteVisitDaily.organizationId, organizationIds));
    await pg.delete(siteVisitSalts);
    // Every rule of the measurement: site-visit, site-visit-48 and site-visit-org-day
    await pg.execute(sql`delete from public_rate_limits where key like ${`${SITE_VISIT_RATE_LIMIT.name}%`}`);
    // The salts table was just emptied: this server must not keep using the salt it read before
    forgetDaySaltForTests();
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    await client?.end();
  });

  it("records each view in the organization whose page it is, decided on the server", async () => {
    expect(await view('/ja/ax-migration', { search: '?utm_source=news&from=ax-column-end' })).toBe(
      'recorded'
    );
    expect(await view('/ja/landing')).toBe('recorded');
    expect(await view(`/ja/d/${builderSlug}`)).toBe('recorded');
    expect(await view('/ja/d/not-published-anywhere')).toBe('no_organization');
    expect(await view('/ja/ax-migration/column/access-file-types')).toBe('recorded');
    expect(await view('/ja/ax-migration/column/made-up-column')).toBe('unknown_page');

    const [ax] = (await visitsOf(axOrg)).filter((row) => row.pageType === 'ax-lp');
    expect(ax).toMatchObject({
      path: '/ja/ax-migration',
      pageType: 'ax-lp',
      referrerHost: 'www.google.com',
      utmSource: 'news',
      fromRef: 'ax-column-end',
      device: 'desktop',
    });
    // The top page and landing belong to the operating organization too
    expect((await visitsOf(axOrg)).map((row) => row.pageType).sort()).toEqual([
      'ax-column',
      'ax-lp',
      'landing',
    ]);
    expect((await visitsOf(builderOrg)).map((row) => row.pageType)).toEqual(['diagnosis']);
  });

  it('stores neither the IP address nor the browser, in the visits or the rate limits', async () => {
    await view('/ja/ax-migration');
    const dump = JSON.stringify([
      await pg.select().from(siteVisits),
      await pg.execute(sql`select * from public_rate_limits`),
    ]);
    expect(dump).not.toContain(IP);
    expect(dump).not.toContain('Chrome/129');
    expect(dump).not.toContain('Windows NT');
  });

  it('keys the visitor hash with the server secret, so the salt and the hash alone cannot be matched', async () => {
    await view('/ja/ax-migration');
    const [{ salt }] = await pg.select().from(siteVisitSalts);
    const [row] = await visitsOf(axOrg);
    // What anyone who can read the two tables could compute for a known address and browser
    const unkeyed = createHash('sha256')
      .update(`${salt}\n${axOrg}\n${IP}\n${CHROME}`)
      .digest('base64url');
    expect(row.visitorHash).not.toBe(unkeyed);
    expect(row.visitorHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('counts a visitor once a day and cannot match them across days', async () => {
    const day1 = new Date('2026-10-23T03:00:00Z');
    const day2 = new Date('2026-10-24T03:00:00Z');
    await view('/ja/ax-migration', { now: day1 });
    await view('/ja/ax-migration/access', { now: day1 });
    await view('/ja/ax-migration', { now: day1, ip: '198.51.100.9', userAgent: IPHONE });
    await view('/ja/ax-migration', { now: day2 });

    const rows = await visitsOf(axOrg);
    const day1Hashes = new Set(rows.filter((r) => r.day === '2026-10-23').map((r) => r.visitorHash));
    expect(day1Hashes.size).toBe(2);
    const [day2Row] = rows.filter((r) => r.day === '2026-10-24');
    expect(day1Hashes.has(day2Row.visitorHash)).toBe(false);
    expect(rows.find((r) => r.device === 'mobile')).toBeDefined();
  });

  it("keeps only the current day's salt", async () => {
    await view('/ja/ax-migration', { now: new Date('2026-10-23T03:00:00Z') });
    await view('/ja/ax-migration', { now: new Date('2026-10-24T03:00:00Z') });
    const salts = await pg.select().from(siteVisitSalts);
    expect(salts.map((row) => row.day)).toEqual(['2026-10-24']);
  });

  it('drops views past the limit of one visitor', async () => {
    const now = new Date('2026-10-23T03:00:00Z');
    for (let i = 0; i < SITE_VISIT_RATE_LIMIT.limit; i++) {
      expect(await view('/ja/ax-migration', { now })).toBe('recorded');
    }
    expect(await view('/ja/ax-migration', { now })).toBe('rate_limited');
    // Another visitor is not affected
    expect(await view('/ja/ax-migration', { now, ip: '198.51.100.9' })).toBe('recorded');
    expect(await visitsOf(axOrg)).toHaveLength(SITE_VISIT_RATE_LIMIT.limit + 1);
  });

  it('counts the limit by address, so changing the browser does not get past it', async () => {
    const now = new Date('2026-10-23T03:00:00Z');
    for (let i = 0; i < SITE_VISIT_RATE_LIMIT.limit; i++) {
      await view('/ja/ax-migration', { now, userAgent: `${CHROME} rotate/${i}` });
    }
    expect(await view('/ja/ax-migration', { now, userAgent: `${CHROME} rotate/x` })).toBe(
      'rate_limited'
    );
  });

  it('counts IPv6 by its /48 first and by its /64, so rotating /64s neither gets past the limit nor adds rows', async () => {
    const now = new Date('2026-10-23T03:00:00Z');
    // Six /64s of one /48 at the limit of each /64 make 720 views; the /48 stops them at 600
    let recorded = 0;
    for (let subnet = 0; subnet < 6; subnet++) {
      for (let i = 0; i < SITE_VISIT_RATE_LIMIT.limit; i++) {
        const result = await view('/ja/ax-migration', {
          now,
          ip: `2001:db8:1:${subnet.toString(16)}::${(i + 1).toString(16)}`,
        });
        if (result === 'recorded') recorded++;
      }
    }
    expect(recorded).toBe(SITE_VISIT_RATE_LIMIT_48.limit);

    // The /48 is counted first: the views it refuses add no row for their /64, however many
    // /64s they rotate through (the sixth /64 above was refused by the /48 from its first view)
    const windowsPer64 = async () => {
      const [{ windows }] = (await pg.execute(
        sql`select count(*)::int as windows from public_rate_limits where key like ${`${SITE_VISIT_RATE_LIMIT.name}:%`}`
      )) as unknown as [{ windows: number }];
      return windows;
    };
    expect(await windowsPer64()).toBe(5);
    for (let subnet = 0x100; subnet < 0x110; subnet++) {
      expect(await view('/ja/ax-migration', { now, ip: `2001:db8:1:${subnet.toString(16)}::1` })).toBe(
        'rate_limited'
      );
    }
    expect(await windowsPer64()).toBe(5);

    // Another /48 is not affected
    expect(await view('/ja/ax-migration', { now, ip: '2001:db8:2::1' })).toBe('recorded');
  });

  it("stops writing an organization's views past its daily cap and flags the one that passed it", async () => {
    const now = new Date('2026-10-23T03:00:00Z');
    // As if the organization had recorded all but one of its views today
    await pg.execute(sql`
      insert into public_rate_limits (key, count, reset_at)
      values (${rateLimitKey(SITE_VISIT_DAILY_CAP, `${axOrg}:2026-10-23`)}, ${SITE_VISIT_DAILY_CAP.limit - 1}, ${'2026-10-24T03:00:00Z'}::timestamptz)
    `);
    expect(await view('/ja/ax-migration', { now })).toBe('recorded');
    expect(await view('/ja/ax-migration', { now, ip: '198.51.100.9' })).toBe('daily_cap_reached');
    expect(await view('/ja/ax-migration', { now, ip: '198.51.100.10' })).toBe('daily_cap');
    expect(await visitsOf(axOrg)).toHaveLength(1);

    // Another organization keeps recording, and so does the next day
    expect(await view(`/ja/d/${builderSlug}`, { now })).toBe('recorded');
    expect(await view('/ja/ax-migration', { now: new Date('2026-10-24T03:00:00Z') })).toBe(
      'recorded'
    );
  });

  it('records without a rate limit when there is no trusted address', async () => {
    const now = new Date('2026-10-23T03:00:00Z');
    for (let i = 0; i <= SITE_VISIT_RATE_LIMIT.limit; i++) {
      expect(await view('/ja/ax-migration', { now, ip: '' })).toBe('recorded');
    }
  });

  it("leaves a later day's salt alone (servers on either side of midnight)", async () => {
    await view('/ja/ax-migration', { now: new Date('2026-10-24T03:00:00Z') });
    await view('/ja/ax-migration', { now: new Date('2026-10-23T14:59:00Z') });
    const salts = await pg.select().from(siteVisitSalts);
    expect(salts.map((row) => row.day).sort()).toEqual(['2026-10-23', '2026-10-24']);
  });

  it('keeps the daily totals, then deletes views past 90 days and past salts', async () => {
    const old = new Date('2026-07-01T03:00:00Z');
    const recent = new Date('2026-10-22T03:00:00Z');
    await view('/ja/ax-migration', { now: old });
    await view('/ja/ax-migration', { now: old });
    await view('/ja/ax-migration', { now: old, ip: '198.51.100.9' });
    await view('/ja/ax-migration/access', { now: recent });

    const result = await maintainSiteVisits(pg, new Date('2026-10-23T03:00:00Z'));
    expect(result.deleted).toBe(3);

    const totals = await pg
      .select()
      .from(siteVisitDaily)
      .where(eq(siteVisitDaily.organizationId, axOrg));
    expect(
      totals.map(({ day, path, pageType, visitors, pageviews }) => ({ day, path, pageType, visitors, pageviews }))
    ).toEqual(
      expect.arrayContaining([
        { day: '2026-07-01', path: '/ja/ax-migration', pageType: 'ax-lp', visitors: 2, pageviews: 3 },
        { day: '2026-10-22', path: '/ja/ax-migration/access', pageType: 'ax-access-lp', visitors: 1, pageviews: 1 },
      ])
    );
    expect((await visitsOf(axOrg)).map((row) => row.day)).toEqual(['2026-10-22']);
    expect(await pg.select().from(siteVisitSalts)).toEqual([]);
    // Rate limit windows that ended a day ago are cleaned up as well: the July views' window
    // goes, the window of the view of the day before stays
    const [{ windows }] = (await pg.execute(
      sql`select count(*)::int as windows from public_rate_limits where key like ${`${SITE_VISIT_RATE_LIMIT.name}:%`}`
    )) as unknown as [{ windows: number }];
    expect(windows).toBe(1);

    // A second run recounts the same days without doubling them
    await maintainSiteVisits(pg, new Date('2026-10-23T03:00:00Z'));
    const again = await pg
      .select()
      .from(siteVisitDaily)
      .where(eq(siteVisitDaily.organizationId, axOrg));
    expect(again).toHaveLength(2);
  });
});
