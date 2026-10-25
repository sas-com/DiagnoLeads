/**
 * The public QR entry (GET /q/<code>, #503) against PostgreSQL: a scan finds the open campaign by
 * its exact short code and is sent to the campaign's own diagnosis with its UTM parameters. A
 * paused, expired or unknown code is 404, a code in another case is another code, and a code
 * that reads like a slug never opens another organization's diagnosis (before #503 the codes sat
 * under /d/, the public page of builder diagnoses, which looks up slugs). Owner decisions in
 * #663: only the AX organization's campaigns without a diagnosis go to the AX diagnosis, a
 * campaign whose diagnosis /d/<slug> does not serve is 404, and one address may scan 200 times
 * in 10 minutes (an event of 100 people, twice).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/qr-short-code-entry.db.test.ts
 */
import { GET } from '@/app/q/[code]/route';
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  diagnosticTemplates,
  organizations,
  qrCampaigns,
} from '@/lib/db/schema';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import { QR_ENTRY_RATE_LIMITS } from '@/lib/features/distribution/limits';
import { findOpenQrCampaign } from '@/lib/features/distribution/short-code-entry';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

// The entry runs on the test database; organization A receives the AX diagnosis
const deps = vi.hoisted(() => ({ db: null as unknown, axOrganizationId: null as string | null }));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return deps.db;
  },
}));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => deps.axOrganizationId,
}));
// after() needs a request scope; the refusal alert is not the point here
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('QR short code entry (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
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
  let orgA: string;
  let orgB: string;
  const templates = new Map<string, string>();

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `qr-entry-${unique()}` })
      .returning({ id: organizations.id });
    organizationIds.push(org.id);
    const [template] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId: org.id, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning({ id: diagnosticTemplates.id });
    templates.set(org.id, template.id);
    return org.id;
  }

  async function createDiagnosis(
    organizationId: string,
    slug: string,
    status: 'published' | 'paused' | 'archived' = 'published'
  ) {
    const definition = cloudReadiness();
    const [row] = await pg
      .insert(diagnoses)
      .values({ organizationId, slug, name: '架空の診断', status, draftDefinition: definition })
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
    shortCode: string,
    values: Partial<typeof qrCampaigns.$inferInsert> = {}
  ) {
    await pg.insert(qrCampaigns).values({
      organizationId,
      // biome-ignore lint/style/noNonNullAssertion: created with the organization
      diagnosticTemplateId: templates.get(organizationId)!,
      name: 'Campaign',
      shortCode,
      // As saved before #503: the entry never reads it
      trackingUrl: `https://example.com/d/${shortCode}`,
      utmCampaign: 'fair-2026',
      ...values,
    });
    return shortCode;
  }

  async function scan(code: string, headers: Record<string, string> = {}) {
    const req = new NextRequest(`https://app.example/q/${code}?utm_source=from-the-request`, {
      headers,
    });
    return GET(req, { params: Promise.resolve({ code }) });
  }

  const AX_UTM = 'utm_source=qrcode&utm_medium=offline&utm_campaign=fair-2026';

  async function expectNotFound(code: string) {
    const res = await scan(code);
    expect(res.status, code).toBe(404);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.text()).toBe('Not Found');
  }

  beforeAll(async () => {
    orgA = await createOrganization('QR入口A');
    orgB = await createOrganization('QR入口B');
    deps.axOrganizationId = orgA;
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    await pg.execute(sql`delete from public_rate_limits where key like ${`${QR_ENTRY_RATE_LIMITS.perIp.name}:%`}`);
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    await client?.end();
  });

  it("sends the AX organization's open campaign without a diagnosis to the AX diagnosis with the campaign's UTM", async () => {
    const code = await createCampaign(orgA, `Ax${randomPart(6)}`);
    const res = await scan(code);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`/ja/ax-diagnosis?${AX_UTM}`);
  });

  it("answers 404 for another organization's campaign without a diagnosis, so its visitors never reach the AX diagnosis (#663)", async () => {
    // B's campaign, whose UTM could name B's customers. The entry itself writes nothing (no lead,
    // no visit): the 404 is what keeps B's visitors off the AX diagnosis, whose answers and page
    // visits become the AX organization's leads and site_visits
    const code = await createCampaign(orgB, `Ob${randomPart(6)}`, {
      utmCampaign: 'customer-of-b',
    });
    await expectNotFound(code);
  });

  it('answers 404 for every campaign without a diagnosis while no organization receives the AX diagnosis', async () => {
    const code = await createCampaign(orgA, `Nx${randomPart(6)}`);
    deps.axOrganizationId = null;
    try {
      await expectNotFound(code);
    } finally {
      deps.axOrganizationId = orgA;
    }
  });

  it("sends a campaign to its organization's published builder diagnosis, also outside the AX organization", async () => {
    const slug = `qr-entry-${randomPart(8)}`;
    const diagnosisId = await createDiagnosis(orgB, slug);
    const code = await createCampaign(orgB, `Pb${randomPart(6)}`, {
      diagnosisId,
      utmSource: 'poster',
      utmMedium: 'print',
      utmCampaign: null,
      utmContent: 'hall-b',
    });
    const res = await scan(code);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      `/ja/d/${slug}?utm_source=poster&utm_medium=print&utm_content=hall-b`
    );
  });

  it('answers 404, not the AX diagnosis, while the diagnosis is paused or archived (#663)', async () => {
    for (const status of ['paused', 'archived'] as const) {
      const diagnosisId = await createDiagnosis(orgA, `qr-entry-${randomPart(8)}`, status);
      // A campaign of the AX organization, which would otherwise go to the AX diagnosis
      await expectNotFound(await createCampaign(orgA, `Ps${randomPart(6)}`, { diagnosisId }));
    }
  });

  it('answers 404 while the diagnosis is a draft that was never published (#663)', async () => {
    const [draft] = await pg
      .insert(diagnoses)
      .values({
        organizationId: orgB,
        slug: `qr-entry-${randomPart(8)}`,
        name: '架空の下書き',
        draftDefinition: cloudReadiness(),
      })
      .returning({ id: diagnoses.id });
    await expectNotFound(await createCampaign(orgB, `Dr${randomPart(6)}`, { diagnosisId: draft.id }));
  });

  it('answers 404 for a paused, an expired and an unknown code', async () => {
    const paused = await createCampaign(orgA, `Of${randomPart(6)}`, { isActive: false });
    const expired = await createCampaign(orgA, `Ex${randomPart(6)}`, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    for (const code of [paused, expired, `No${randomPart(6)}`]) {
      const res = await scan(code);
      expect(res.status, code).toBe(404);
      expect(res.headers.get('location')).toBeNull();
    }
  });

  it('keeps answering a campaign until its end', async () => {
    const code = await createCampaign(orgA, `Fu${randomPart(6)}`, {
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    expect((await scan(code)).status).toBe(307);
  });

  it('compares codes case-sensitively', async () => {
    const code = await createCampaign(orgA, `Mx${randomPart(4)}Ab`);
    expect((await scan(code)).status).toBe(307);
    expect((await scan(code.toLowerCase())).status).toBe(404);
    expect((await scan(code.toUpperCase())).status).toBe(404);
    expect(await findOpenQrCampaign(pg, code.toLowerCase())).toBeNull();
  });

  describe('a lowercase code that reads like the slug of a published diagnosis', () => {
    it("is not another organization's diagnosis when no campaign has it", async () => {
      const lower = randomPart(8);
      await createDiagnosis(orgB, lower);
      // /d/<code> would have opened B's diagnosis; /q/<code> is only a campaign's code
      expect((await scan(lower)).status).toBe(404);
    });

    it("sends A's campaign to its own place, not to B's diagnosis of the same name", async () => {
      const lower = randomPart(8);
      await createDiagnosis(orgB, lower);
      const code = await createCampaign(orgA, lower);
      expect((await scan(code)).headers.get('location')).toBe(`/ja/ax-diagnosis?${AX_UTM}`);
    });

    it("never follows a campaign's diagnosis id into another organization, nor to the AX diagnosis (#663)", async () => {
      const slug = `qr-entry-${randomPart(8)}`;
      const diagnosisOfB = await createDiagnosis(orgB, slug);
      const code = await createCampaign(orgA, randomPart(8), { diagnosisId: diagnosisOfB });
      const campaign = await findOpenQrCampaign(pg, code);
      expect(campaign?.diagnosis).toBeNull();
      expect(campaign?.diagnosisId).toBe(diagnosisOfB);
      await expectNotFound(code);
    });
  });

  it('answers 404 while two organizations publish the slug (the page serves neither, #663)', async () => {
    const slug = `qr-entry-${randomPart(8)}`;
    const diagnosisId = await createDiagnosis(orgA, slug);
    await createDiagnosis(orgB, slug);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await createCampaign(orgA, `Cl${randomPart(6)}`, { diagnosisId });
    await expectNotFound(code);
    errorLog.mockRestore();
  });

  it('lets one address scan 200 times in 10 minutes on Vercel, an event of 100 people twice, and refuses the next, across codes (#663)', async () => {
    vi.stubEnv('VERCEL', '1');
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const code = await createCampaign(orgA, `Rl${randomPart(6)}`);
    expect((await scan(code, { 'x-real-ip': ip })).status).toBe(307);
    // The address has scanned other codes since: 199 of its 200 in the window
    expect(QR_ENTRY_RATE_LIMITS.perIp).toMatchObject({ limit: 200, windowMs: 10 * 60 * 1000 });
    await consumeRateLimit(pg, QR_ENTRY_RATE_LIMITS.perIp, ip, new Date(), 198);
    expect((await scan(code, { 'x-real-ip': ip })).status).toBe(307);
    const res = await scan(code, { 'x-real-ip': ip });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address is not affected
    expect((await scan(code, { 'x-real-ip': '192.0.2.10' })).status).toBe(307);
  });
});
