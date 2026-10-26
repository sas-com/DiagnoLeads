/**
 * Recording the scans of a QR campaign at its public entry (GET /q/<code>, #41) against
 * PostgreSQL: each scan the entry sends on adds one qr_scans row of the campaign's organization
 * and counts it in qr_campaigns.scan_count, also when many arrive at once; a 404, a 429, a bot
 * and a HEAD request record nothing, nor a scan past the campaign's daily cap. A scan keeps the
 * kind of device and the day only (decision 2026-10-23-site-visit-measurement), and
 * getCampaignStats counts what was recorded.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/qr-scan-recording.db.test.ts
 */
import { GET } from '@/app/q/[code]/route';
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  diagnosticTemplates,
  organizationMembers,
  organizations,
  qrCampaigns,
  qrScans,
  users,
} from '@/lib/db/schema';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import { QR_ENTRY_RATE_LIMITS, QR_SCAN_DAILY_CAP } from '@/lib/features/distribution/limits';
import { recordQrScan, scanDayOf } from '@/lib/features/distribution/scans';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

// The entry and the router run on the test database; organization A receives the AX diagnosis.
// after() keeps the work the entry leaves for after the response, which scan() then runs
const deps = vi.hoisted(() => ({
  db: null as unknown,
  axOrganizationId: null as string | null,
  afterTasks: [] as (() => unknown)[],
}));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return deps.db;
  },
}));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => deps.axOrganizationId,
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    deps.afterTasks.push(task);
  },
}));

const url = process.env.TEST_DATABASE_URL;

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe.skipIf(!url)('QR scan recording (PostgreSQL)', () => {
  // Enough connections for the scans at the same moment to meet on the campaign row
  const client = url ? postgres(url, { max: 10, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  deps.db = pg;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  /** Letters and digits of generateShortCode's alphabet, so the codes are unique per run */
  const randomPart = (length: number) => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const templates = new Map<string, string>();
  let orgA: string;
  let orgB: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `qr-scan-${unique()}` })
      .returning({ id: organizations.id });
    organizationIds.push(org.id);
    const [template] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId: org.id, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning({ id: diagnosticTemplates.id });
    templates.set(org.id, template.id);
    return org.id;
  }

  async function createPublishedDiagnosis(organizationId: string, slug: string) {
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
    return row.id;
  }

  async function createCampaign(
    organizationId: string,
    values: Partial<typeof qrCampaigns.$inferInsert> = {}
  ) {
    const shortCode = `Sc${randomPart(8)}`;
    const [row] = await pg
      .insert(qrCampaigns)
      .values({
        organizationId,
        // biome-ignore lint/style/noNonNullAssertion: created with the organization
        diagnosticTemplateId: templates.get(organizationId)!,
        name: 'Campaign',
        shortCode,
        trackingUrl: `https://example.com/q/${shortCode}`,
        utmCampaign: 'fair-2026',
        ...values,
      })
      .returning({ id: qrCampaigns.id });
    return { id: row.id, code: shortCode };
  }

  /** GET /q/<code> as a phone, then the work it left for after the response */
  async function scan(code: string, headers: Record<string, string> = { 'user-agent': IPHONE }) {
    const res = await request(code, headers);
    await Promise.all(deps.afterTasks.splice(0).map((task) => task()));
    return res;
  }

  function request(code: string, headers: Record<string, string>, method = 'GET') {
    const req = new NextRequest(`https://app.example/q/${code}`, { headers, method });
    return GET(req, { params: Promise.resolve({ code }) });
  }

  const scansOf = (campaignId: string) =>
    pg.select().from(qrScans).where(eq(qrScans.campaignId, campaignId));

  async function scanCountOf(campaignId: string) {
    const [row] = await pg
      .select({ scanCount: qrCampaigns.scanCount })
      .from(qrCampaigns)
      .where(eq(qrCampaigns.id, campaignId));
    return row?.scanCount;
  }

  async function expectNothingRecorded(campaignId: string) {
    expect(await scansOf(campaignId)).toEqual([]);
    expect(await scanCountOf(campaignId)).toBe(0);
  }

  beforeAll(async () => {
    orgA = await createOrganization('QRスキャンA');
    orgB = await createOrganization('QRスキャンB');
    deps.axOrganizationId = orgA;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    deps.afterTasks.length = 0;
  });

  afterAll(async () => {
    for (const rule of [QR_ENTRY_RATE_LIMITS.perIp, QR_SCAN_DAILY_CAP]) {
      await pg.execute(sql`delete from public_rate_limits where key like ${`${rule.name}:%`}`);
    }
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("records one scan per redirect, of the campaign's organization, with the device and the day only", async () => {
    const campaign = await createCampaign(orgA);
    const day = scanDayOf();

    expect((await scan(campaign.code)).status).toBe(307);
    const [row] = await scansOf(campaign.id);
    expect(row).toMatchObject({
      campaignId: campaign.id,
      organizationId: orgA,
      deviceType: 'mobile',
      // Nothing of who scanned
      ipAddressHash: null,
      userAgent: null,
      location: null,
      sessionId: null,
      converted: false,
      leadId: null,
    });
    // The day in Japan at midnight, never the time of the scan (the column has no time zone)
    expect([day, scanDayOf()]).toContain(row.scannedAt.toISOString().slice(0, 10));
    expect(row.scannedAt.toISOString().slice(10)).toBe('T00:00:00.000Z');
    expect(await scanCountOf(campaign.id)).toBe(1);

    expect((await scan(campaign.code, { 'user-agent': DESKTOP })).status).toBe(307);
    const rows = await scansOf(campaign.id);
    expect(rows.map((scanRow) => scanRow.deviceType).sort()).toEqual(['desktop', 'mobile']);
    expect(await scanCountOf(campaign.id)).toBe(2);
  });

  it("records a scan sent to another organization's own diagnosis in that organization", async () => {
    const diagnosisId = await createPublishedDiagnosis(orgB, `qr-scan-${randomPart(8)}`);
    const campaign = await createCampaign(orgB, { diagnosisId });
    expect((await scan(campaign.code)).status).toBe(307);
    const rows = await scansOf(campaign.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(orgB);
    expect(await scanCountOf(campaign.id)).toBe(1);
  });

  it('records nothing for a 404: a paused or expired campaign, one with nowhere to send, a draft diagnosis', async () => {
    const paused = await createCampaign(orgA, { isActive: false });
    const expired = await createCampaign(orgA, { expiresAt: new Date(Date.now() - 60_000) });
    // B's campaign without a diagnosis: only the AX organization's go to the AX diagnosis (#663)
    const ofB = await createCampaign(orgB);
    const [draft] = await pg
      .insert(diagnoses)
      .values({
        organizationId: orgB,
        slug: `qr-scan-${randomPart(8)}`,
        name: '架空の下書き',
        draftDefinition: cloudReadiness(),
      })
      .returning({ id: diagnoses.id });
    const unpublished = await createCampaign(orgB, { diagnosisId: draft.id });

    for (const campaign of [paused, expired, ofB, unpublished]) {
      expect((await scan(campaign.code)).status, campaign.code).toBe(404);
      await expectNothingRecorded(campaign.id);
    }
    expect((await scan(`No${randomPart(8)}`)).status).toBe(404);
  });

  it('records nothing for a scan the rate limit refuses (429), only the ones it lets through', async () => {
    vi.stubEnv('VERCEL', '1');
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const campaign = await createCampaign(orgA);
    const phone = { 'user-agent': IPHONE, 'x-real-ip': ip };
    expect((await scan(campaign.code, phone)).status).toBe(307);
    // The address has used up the rest of its 200 in the window
    await consumeRateLimit(pg, QR_ENTRY_RATE_LIMITS.perIp, ip, new Date(), 199);
    expect((await scan(campaign.code, phone)).status).toBe(429);
    expect((await scan(campaign.code, phone)).status).toBe(429);
    expect(await scansOf(campaign.id)).toHaveLength(1);
    expect(await scanCountOf(campaign.id)).toBe(1);
  });

  it('sends bots and HEAD requests on without recording them', async () => {
    const campaign = await createCampaign(orgA);
    expect((await scan(campaign.code, { 'user-agent': 'Slackbot-LinkExpanding 1.0' })).status).toBe(
      307
    );
    expect((await scan(campaign.code, {})).status).toBe(307);
    expect((await request(campaign.code, { 'user-agent': IPHONE }, 'HEAD')).status).toBe(307);
    expect(deps.afterTasks).toEqual([]);
    await expectNothingRecorded(campaign.id);
  });

  it("stops recording a campaign's scans past its daily cap, still sending them on, and warns once", async () => {
    const campaign = await createCampaign(orgA);
    const other = await createCampaign(orgA);
    // The campaign has recorded its 2,000 of the day (counted as the entry counts them)
    await consumeRateLimit(
      pg,
      QR_SCAN_DAILY_CAP,
      `${campaign.id}:${scanDayOf()}`,
      new Date(),
      QR_SCAN_DAILY_CAP.limit
    );
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      const res = await scan(campaign.code);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toMatch(/^\/ja\/ax-diagnosis\?/);
    }
    await expectNothingRecorded(campaign.id);
    // Only the scan that went past the cap is reported
    expect(warnLog).toHaveBeenCalledTimes(1);
    expect(warnLog.mock.calls[0][1]).toMatchObject({ campaignId: campaign.id });
    warnLog.mockRestore();

    // The cap is the campaign's: another campaign of the organization still records
    expect((await scan(other.code)).status).toBe(307);
    expect(await scansOf(other.id)).toHaveLength(1);
    expect(await scanCountOf(other.id)).toBe(1);
  });

  it('counts every scan when many arrive at once: the count and the rows agree', async () => {
    const campaign = await createCampaign(orgA);
    const scans = 40;
    // The redirects first, then their writes all at the same moment
    const responses = await Promise.all(
      Array.from({ length: scans }, () => request(campaign.code, { 'user-agent': IPHONE }))
    );
    expect(responses.every((res) => res.status === 307)).toBe(true);
    const writes = deps.afterTasks.splice(0);
    expect(writes).toHaveLength(scans);
    await Promise.all(writes.map((task) => task()));

    expect(await scanCountOf(campaign.id)).toBe(scans);
    expect(await scansOf(campaign.id)).toHaveLength(scans);
  });

  it('counts concurrent writes atomically also when called directly', async () => {
    const campaign = await createCampaign(orgA);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        recordQrScan(pg, { campaignId: campaign.id, organizationId: orgA }, i % 2 ? 'mobile' : 'tablet')
      )
    );
    expect(results.every(Boolean)).toBe(true);
    expect(await scanCountOf(campaign.id)).toBe(50);
    expect(await scansOf(campaign.id)).toHaveLength(50);
  });

  it('writes nothing for a campaign that is gone or of another organization, without an error', async () => {
    const campaign = await createCampaign(orgA);
    // The id of A's campaign with B's organization: no row, no count
    expect(await recordQrScan(pg, { campaignId: campaign.id, organizationId: orgB }, 'mobile')).toBe(
      false
    );
    await expectNothingRecorded(campaign.id);

    // Deleted between the lookup of the entry and the write after the response
    expect((await request(campaign.code, { 'user-agent': IPHONE })).status).toBe(307);
    await pg.delete(qrCampaigns).where(eq(qrCampaigns.id, campaign.id));
    const errorLog = vi.spyOn(console, 'error');
    await Promise.all(deps.afterTasks.splice(0).map((task) => task()));
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
    expect(await scansOf(campaign.id)).toEqual([]);
  });

  it('getCampaignStats counts the scans the entry recorded, of that campaign only', async () => {
    const day = scanDayOf();
    const campaign = await createCampaign(orgA);
    const other = await createCampaign(orgA);
    await scan(campaign.code);
    await scan(campaign.code);
    await scan(campaign.code, { 'user-agent': DESKTOP });
    await scan(other.code);

    const [user] = await pg
      .insert(users)
      .values({ email: `qr-scan-${unique()}@example.com`, name: 'QR' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId: orgA, userId: user.id, role: 'admin' });
    const caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);

    const stats = await caller.distribution.getCampaignStats({
      organizationId: orgA,
      campaignId: campaign.id,
    });
    expect(stats).toMatchObject({
      totalScans: 3,
      totalConversions: 0,
      conversionRate: 0,
      deviceBreakdown: { mobile: 2, desktop: 1 },
    });
    expect(stats.recentScans).toHaveLength(3);
    // The latest scans carry no column that could hold who scanned, and the day as a day
    for (const recent of stats.recentScans) {
      expect(Object.keys(recent).sort()).toEqual(['deviceType', 'id', 'scannedOn']);
      expect(recent.scannedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect([day, scanDayOf()]).toContain(recent.scannedOn);
    }
  });
});
