/**
 * The inflow source of the new leads from a QR campaign's scans (#788, owner decision of
 * 2026-10-26 on #788) against PostgreSQL: a campaign created through the router with a medium of
 * the form's list (or none: the default) keeps it, the /q/ entry passes it on to the diagnosis as
 * utm_medium, and the lead the answer creates gets the inflow source MEDIUM_TO_INFLOW maps it to
 * (seminar → seminar, exhibition → seminar, direct_mail → advertising), from the AX diagnosis and
 * from a builder diagnosis. A campaign created before #788 with the old default 'offline' (the
 * column's default) still opens and makes leads, with no inflow source as before.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/qr-campaign-inflow.db.test.ts
 */
import { GET } from '@/app/q/[code]/route';
import { readTrackingParams } from '@/components/features/diagnosis-runner/tracking-params';
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  diagnosticTemplates,
  leads,
  organizationMembers,
  organizations,
  qrCampaigns,
  users,
} from '@/lib/db/schema';
import {
  type PublicDiagnosis,
  type PublicDiagnosisVersion,
  findPublicDiagnosis,
} from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  diagnosisSubmissionSchema,
  submitBuilderDiagnosis,
} from '@/lib/features/diagnosis-builder/submission-service';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import {
  axMigrationSubmissionSchema,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import type { Tracking } from '@/lib/features/diagnostics/tracking';
import { QR_SCAN_DAILY_CAP } from '@/lib/features/distribution/limits';
import { appRouter } from '@/server/routers/_app';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

// The entry and the router run on the test database; the organization receives the AX diagnosis.
// after() keeps the work the entry leaves for after the response
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

describe.skipIf(!url)('the inflow source of QR campaign leads (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  deps.db = pg;
  const now = new Date('2026-10-29T01:00:00Z');
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  /** Letters and digits of generateShortCode's alphabet, so the codes are unique per run */
  const randomPart = (length: number) => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };
  let organizationId: string;
  let templateId: string;
  let userId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;
  /** The organization's published builder diagnosis, as /d/<slug> serves it */
  let diagnosis: PublicDiagnosis;
  let version: PublicDiagnosisVersion;

  /** Create a campaign as the settings page does, sending the medium only when one is given */
  async function createCampaign(utmMedium?: string, diagnosisId?: string) {
    const created = await caller.distribution.createCampaign({
      organizationId,
      name: `Campaign ${unique()}`,
      diagnosticTemplateId: templateId,
      ...(utmMedium === undefined ? {} : { utmMedium }),
    });
    if (diagnosisId) {
      await pg.update(qrCampaigns).set({ diagnosisId }).where(eq(qrCampaigns.id, created.id));
    }
    return created;
  }

  /**
   * Scan the code at the entry, open the address it sends to, and read the tracking the diagnosis
   * sends with the answer there (readTrackingParams, then the server's parse)
   */
  async function scanAndRead(code: string): Promise<Tracking> {
    const res = await GET(
      new NextRequest(`https://app.example/q/${code}`, { headers: { 'user-agent': IPHONE } }),
      { params: Promise.resolve({ code }) }
    );
    await Promise.all(deps.afterTasks.splice(0).map((task) => task()));
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    if (!location) throw new Error('no location');
    window.history.replaceState(null, '', location);
    return axMigrationSubmissionSchema.shape.tracking.parse(readTrackingParams());
  }

  const email = () => `Qr-inflow-${unique()}@Example.co.jp`;

  /** Answer the AX diagnosis with the tracking; the inflow source of the lead it creates */
  async function answerAx(tracking: Tracking) {
    const outcome = await submitAxMigrationDiagnosis(
      pg,
      organizationId,
      {
        answers: as400Answers,
        contact: { company: '架空製作所', name: '試験 太郎', email: email() },
        privacyConsent: true,
        consultationRequested: false,
        tracking,
        locale: 'ja',
      },
      now
    );
    if (!outcome.ok) throw new Error('AX submission failed');
    expect(outcome.leadCreated).toBe(true);
    return inflowSourceOf(outcome.leadId);
  }

  /** Answer the builder diagnosis with the tracking; the inflow source of the lead it creates */
  async function answerBuilder(tracking: Tracking) {
    const input = diagnosisSubmissionSchema.parse({
      versionId: version.id,
      answers: { hosting: 'onprem', team_size: 150, migration_plan: 'this_year', confidence: 4 },
      contact: { company: '架空商事', name: '試験 花子', email: email() },
      privacyConsent: true,
      consentVersion: '2026-10-01',
      consultationRequested: false,
      tracking,
      locale: 'ja',
    });
    const outcome = await submitBuilderDiagnosis(pg, diagnosis, version, input, now);
    if (!outcome.ok) throw new Error('builder submission failed');
    expect(outcome.leadCreated).toBe(true);
    return inflowSourceOf(outcome.leadId);
  }

  async function inflowSourceOf(leadId: string) {
    const [lead] = await pg
      .select({ inflowSource: leads.inflowSource })
      .from(leads)
      .where(eq(leads.id, leadId));
    return lead?.inflowSource;
  }

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: 'QR流入元', slug: `qr-inflow-${unique()}` })
      .returning({ id: organizations.id });
    organizationId = org.id;
    deps.axOrganizationId = org.id;
    const [template] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning({ id: diagnosticTemplates.id });
    templateId = template.id;

    // A published builder diagnosis, for the campaigns that name one (/d/<slug>)
    const definition = cloudReadiness();
    const slug = `qr-inflow-${randomPart(8)}`;
    const [row] = await pg
      .insert(diagnoses)
      .values({ organizationId, slug, name: '架空の診断', status: 'published', draftDefinition: definition })
      .returning({ id: diagnoses.id });
    const [published] = await pg
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
    await pg.update(diagnoses).set({ currentVersionId: published.id }).where(eq(diagnoses.id, row.id));
    const served = await findPublicDiagnosis(pg, slug);
    if (!served) throw new Error('diagnosis not served');
    diagnosis = served;
    version = served.current;

    const [user] = await pg
      .insert(users)
      .values({ email: `qr-inflow-${unique()}@example.com`, name: 'QR' })
      .returning();
    userId = user.id;
    await pg.insert(organizationMembers).values({ organizationId, userId, role: 'admin' });
    // The session as Better Auth gives it to the router
    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name ?? 'QR',
      emailVerified: false,
      image: null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    caller = appRouter.createCaller({
      db: pg,
      session: {
        session: {
          id: 's',
          userId: user.id,
          token: 't',
          expiresAt: new Date('2099-01-01T00:00:00Z'),
          createdAt: now,
          updatedAt: now,
        },
        user: authUser,
      },
      user: authUser,
    });
  });

  afterEach(() => {
    deps.afterTasks.length = 0;
    window.history.replaceState(null, '', '/');
  });

  afterAll(async () => {
    const campaigns = organizationId
      ? await pg
          .select({ id: qrCampaigns.id })
          .from(qrCampaigns)
          .where(eq(qrCampaigns.organizationId, organizationId))
      : [];
    // The daily caps of this file's campaigns (the entry's limit per address counts only on Vercel)
    for (const campaign of campaigns) {
      await pg.execute(
        sql`delete from public_rate_limits where key like ${`${QR_SCAN_DAILY_CAP.name}:${campaign.id}:%`}`
      );
    }
    if (organizationId) {
      await pg.delete(organizations).where(inArray(organizations.id, [organizationId]));
    }
    if (userId) await pg.delete(users).where(eq(users.id, userId));
    await client?.end();
  });

  it('a campaign created without a medium gets seminar, and its new leads the inflow source seminar', async () => {
    const campaign = await createCampaign();
    expect(campaign.utmMedium).toBe('seminar');

    const tracking = await scanAndRead(campaign.shortCode);
    expect(tracking).toMatchObject({ utmSource: 'qrcode', utmMedium: 'seminar' });
    expect(await answerAx(tracking)).toBe('seminar');
  });

  it.each([
    ['seminar', 'seminar'],
    ['exhibition', 'seminar'],
    ['direct_mail', 'advertising'],
  ])('a campaign of %s gives its new leads the inflow source %s (AX diagnosis)', async (medium, inflow) => {
    const campaign = await createCampaign(medium);
    expect(campaign.utmMedium).toBe(medium);
    const tracking = await scanAndRead(campaign.shortCode);
    expect(tracking.utmMedium).toBe(medium);
    expect(await answerAx(tracking)).toBe(inflow);
  });

  it.each([
    ['exhibition', 'seminar'],
    ['direct_mail', 'advertising'],
  ])('a campaign of %s gives its new leads the inflow source %s (builder diagnosis)', async (medium, inflow) => {
    const campaign = await createCampaign(medium, diagnosis.id);
    const tracking = await scanAndRead(campaign.shortCode);
    expect(window.location.pathname).toBe(`/ja/d/${diagnosis.slug}`);
    expect(await answerBuilder(tracking)).toBe(inflow);
  });

  it("a campaign created before #788 with 'offline' still opens and makes leads, with no inflow source", async () => {
    // As the rows before #788: the column's default, which the router no longer leaves to
    const shortCode = `Qi${randomPart(8)}`;
    const [old] = await pg
      .insert(qrCampaigns)
      .values({
        organizationId,
        diagnosticTemplateId: templateId,
        name: 'Campaign before #788',
        shortCode,
        trackingUrl: `https://example.com/q/${shortCode}`,
      })
      .returning({ id: qrCampaigns.id, utmMedium: qrCampaigns.utmMedium });
    expect(old.utmMedium).toBe('offline');

    // Listed with its own medium in the URL, unchanged
    const listed = await caller.distribution.listCampaigns({ organizationId });
    const row = listed.find((campaign) => campaign.id === old.id);
    expect(row?.trackingUrl).toContain('utm_medium=offline');

    const tracking = await scanAndRead(shortCode);
    expect(tracking.utmMedium).toBe('offline');
    expect(await answerAx(tracking)).toBeNull();
  });
});
