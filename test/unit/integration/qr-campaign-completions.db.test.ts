/**
 * Leads from the scans of a QR campaign (#700, owner decision of 2026-10-25) against PostgreSQL:
 * the /q/ entry passes the campaign's short code on to the diagnosis (qr), the answer keeps it in
 * tracking, and a submission of the AX diagnosis or of a builder diagnosis that creates a lead
 * adds one to completion_count of the campaign of the lead's organization with that code, in the
 * transaction that creates the lead. Not counted: an answer sent again, a lead that was already
 * there, a code of another organization's campaign, an unknown or malformed code, a test answer.
 * Answers at the same moment count exactly. getCampaignStats answers the count and the rate from
 * the campaign row.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/qr-campaign-completions.db.test.ts
 */
import { GET } from '@/app/q/[code]/route';
import { readTrackingParams } from '@/components/features/diagnosis-runner/tracking-params';
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  diagnosticSubmissions,
  diagnosticTemplates,
  leads,
  organizationMembers,
  organizations,
  qrCampaigns,
  qrScans,
  users,
} from '@/lib/db/schema';
import {
  type PublicDiagnosis,
  type PublicDiagnosisVersion,
  findPublicDiagnosis,
} from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  type DiagnosisSubmissionInput,
  diagnosisSubmissionSchema,
  submitBuilderDiagnosis,
} from '@/lib/features/diagnosis-builder/submission-service';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import {
  type AxMigrationSubmissionInput,
  axMigrationSubmissionSchema,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { countQrCompletion } from '@/lib/features/diagnostics/service';
import type { Tracking } from '@/lib/features/diagnostics/tracking';
import { QR_ENTRY_RATE_LIMITS, QR_SCAN_DAILY_CAP } from '@/lib/features/distribution/limits';
import { appRouter } from '@/server/routers/_app';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

// The entry and the router run on the test database; organization A receives the AX diagnosis.
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

describe.skipIf(!url)('QR campaign completions (PostgreSQL)', () => {
  // Enough connections for the answers at the same moment to meet on the campaign row
  const client = url ? postgres(url, { max: 10, onnotice: () => {} }) : null;
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
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const templates = new Map<string, string>();
  let orgA: string;
  let orgB: string;
  /** A's published builder diagnosis, as /d/<slug> serves it */
  let diagnosisOfA: PublicDiagnosis;
  let versionOfA: PublicDiagnosisVersion;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `qr-done-${unique()}` })
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
    const shortCode = `Qd${randomPart(8)}`;
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

  async function completionsOf(campaignId: string) {
    const [row] = await pg
      .select({ completionCount: qrCampaigns.completionCount })
      .from(qrCampaigns)
      .where(eq(qrCampaigns.id, campaignId));
    return row?.completionCount;
  }

  const email = () => `Qr-${unique()}@Example.co.jp`;

  const axInput = (
    tracking: Tracking,
    overrides: Partial<AxMigrationSubmissionInput> = {}
  ): AxMigrationSubmissionInput => ({
    answers: as400Answers,
    contact: { company: '架空製作所', name: '試験 太郎', email: email() },
    privacyConsent: true,
    consultationRequested: false,
    tracking,
    locale: 'ja',
    ...overrides,
  });

  const builderInput = (
    tracking: Tracking,
    overrides: Partial<DiagnosisSubmissionInput> = {}
  ): DiagnosisSubmissionInput => ({
    versionId: versionOfA.id,
    answers: { hosting: 'onprem', team_size: 150, migration_plan: 'this_year', confidence: 4 },
    contact: { company: '架空商事', name: '試験 花子', email: email() },
    privacyConsent: true,
    consentVersion: '2026-10-01',
    consultationRequested: false,
    tracking,
    locale: 'ja',
    ...overrides,
  });

  async function submitAx(organizationId: string, input: AxMigrationSubmissionInput) {
    const outcome = await submitAxMigrationDiagnosis(pg, organizationId, input, now);
    if (!outcome.ok) throw new Error('AX submission failed');
    return outcome;
  }

  async function submitBuilder(input: DiagnosisSubmissionInput) {
    const outcome = await submitBuilderDiagnosis(pg, diagnosisOfA, versionOfA, input, now);
    if (!outcome.ok) throw new Error('builder submission failed');
    return outcome;
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

  beforeAll(async () => {
    orgA = await createOrganization('QR完了A');
    orgB = await createOrganization('QR完了B');
    deps.axOrganizationId = orgA;
    const slug = `qr-done-${randomPart(8)}`;
    await createPublishedDiagnosis(orgA, slug);
    const served = await findPublicDiagnosis(pg, slug);
    if (!served) throw new Error('diagnosis not served');
    diagnosisOfA = served;
    versionOfA = served.current;
  });

  afterEach(() => {
    deps.afterTasks.length = 0;
    window.history.replaceState(null, '', '/');
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

  describe('a new lead counts once for the campaign of its organization', () => {
    it('from the AX diagnosis, with the code the entry passed on', async () => {
      const campaign = await createCampaign(orgA);
      const tracking = await scanAndRead(campaign.code);
      expect(tracking.qr).toBe(campaign.code);

      const outcome = await submitAx(orgA, axInput(tracking));
      expect(outcome.leadCreated).toBe(true);
      expect(await completionsOf(campaign.id)).toBe(1);
      // The answer keeps the code with the UTM values; the scan row stays as it was
      const [submission] = await pg
        .select({ tracking: diagnosticSubmissions.tracking })
        .from(diagnosticSubmissions)
        .where(eq(diagnosticSubmissions.id, outcome.submissionId));
      expect(submission.tracking).toMatchObject({
        utmSource: 'qrcode',
        utmMedium: 'offline',
        utmCampaign: 'fair-2026',
        qr: campaign.code,
      });
      const scans = await pg.select().from(qrScans).where(eq(qrScans.campaignId, campaign.id));
      expect(scans).toHaveLength(1);
      expect(scans[0]).toMatchObject({ converted: false, leadId: null });
    });

    it('from a builder diagnosis, with the code the entry passed on to /d/<slug>', async () => {
      const campaign = await createCampaign(orgA, { diagnosisId: diagnosisOfA.id });
      const tracking = await scanAndRead(campaign.code);
      expect(window.location.pathname).toBe(`/ja/d/${diagnosisOfA.slug}`);
      const parsed = diagnosisSubmissionSchema.parse({ ...builderInput(tracking) });

      const outcome = await submitBuilder(parsed);
      expect(outcome.leadCreated).toBe(true);
      expect(await completionsOf(campaign.id)).toBe(1);
    });

    it('also when the campaign was paused or has expired since the scan', async () => {
      const paused = await createCampaign(orgA, { isActive: false });
      const expired = await createCampaign(orgA, { expiresAt: new Date('2026-10-01T00:00:00Z') });
      await submitAx(orgA, axInput({ qr: paused.code }));
      await submitBuilder(builderInput({ qr: expired.code }));
      expect(await completionsOf(paused.id)).toBe(1);
      expect(await completionsOf(expired.id)).toBe(1);
    });

    it('counts and rolls back with the transaction that creates the lead', async () => {
      const campaign = await createCampaign(orgA);
      const failed = pg.transaction(async (tx) => {
        expect(
          await countQrCompletion(tx, {
            organizationId: orgA,
            leadCreated: true,
            isTest: false,
            tracking: { qr: campaign.code },
          })
        ).toBe(true);
        throw new Error('the submission failed after the count');
      });
      await expect(failed).rejects.toThrow('the submission failed after the count');
      expect(await completionsOf(campaign.id)).toBe(0);
    });
  });

  describe('what does not count', () => {
    it('the same answer sent again, by the AX diagnosis and by a builder diagnosis', async () => {
      const campaign = await createCampaign(orgA);
      const ax = axInput({ qr: campaign.code });
      expect((await submitAx(orgA, ax)).leadCreated).toBe(true);
      expect((await submitAx(orgA, ax)).leadCreated).toBe(false);
      const builder = builderInput({ qr: campaign.code });
      expect((await submitBuilder(builder)).leadCreated).toBe(true);
      expect((await submitBuilder(builder)).leadCreated).toBe(false);
      // One per new lead
      expect(await completionsOf(campaign.id)).toBe(2);
    });

    it('the same answer sent twice at the same moment (a double submit)', async () => {
      const campaign = await createCampaign(orgA);
      const ax = axInput({ qr: campaign.code });
      const outcomes = await Promise.all([submitAx(orgA, ax), submitAx(orgA, ax)]);
      expect(outcomes.map((outcome) => outcome.leadCreated).sort()).toEqual([false, true]);
      expect(await completionsOf(campaign.id)).toBe(1);
    });

    it('a lead that was already there, which the submission is only linked to', async () => {
      const campaign = await createCampaign(orgA);
      const address = email();
      // The lead came first, without a code (another channel)
      const [lead] = await pg
        .insert(leads)
        .values({ organizationId: orgA, email: address.toLowerCase(), name: '既存', company: '既存' })
        .returning({ id: leads.id });
      const contact = { company: '別の会社', name: '別の人', email: address };
      const ax = await submitAx(orgA, axInput({ qr: campaign.code }, { contact }));
      const builder = await submitBuilder(builderInput({ qr: campaign.code }, { contact }));
      expect([ax.leadId, builder.leadId]).toEqual([lead.id, lead.id]);
      expect([ax.leadCreated, builder.leadCreated]).toEqual([false, false]);
      expect(await completionsOf(campaign.id)).toBe(0);
    });

    it("a code of another organization's campaign, either way", async () => {
      const ofB = await createCampaign(orgB);
      const ofA = await createCampaign(orgA);
      // A's AX diagnosis and A's builder diagnosis with B's code
      expect((await submitAx(orgA, axInput({ qr: ofB.code }))).leadCreated).toBe(true);
      expect((await submitBuilder(builderInput({ qr: ofB.code }))).leadCreated).toBe(true);
      expect(await completionsOf(ofB.id)).toBe(0);
      // An answer in B with A's code
      expect((await submitAx(orgB, axInput({ qr: ofA.code }))).leadCreated).toBe(true);
      expect(await completionsOf(ofA.id)).toBe(0);
    });

    it('an unknown code, another case of a code, and a malformed one, without failing the answer', async () => {
      const campaign = await createCampaign(orgA);
      const before = await pg
        .select({ id: qrCampaigns.id, completionCount: qrCampaigns.completionCount })
        .from(qrCampaigns)
        .where(inArray(qrCampaigns.organizationId, [orgA, orgB]));

      // Unknown, and the code in another case (codes are case-sensitive)
      const unknown = [`No${randomPart(8)}`, campaign.code.toUpperCase(), campaign.code.toLowerCase()];
      for (const qr of unknown) {
        expect((await submitAx(orgA, axInput({ qr }))).leadCreated, qr).toBe(true);
        expect((await submitBuilder(builderInput({ qr }))).leadCreated, qr).toBe(true);
      }
      // What cannot be a code is dropped by the parse of the answer, never rejected
      const malformed = axMigrationSubmissionSchema.parse({
        ...axInput({}),
        tracking: { utmSource: 'qrcode', qr: `${campaign.code}-x` },
      });
      expect(malformed.tracking).toEqual({ utmSource: 'qrcode' });
      const parsed = await submitAx(orgA, malformed);
      const [stored] = await pg
        .select({ tracking: diagnosticSubmissions.tracking })
        .from(diagnosticSubmissions)
        .where(eq(diagnosticSubmissions.id, parsed.submissionId));
      expect(stored.tracking).toEqual({ utmSource: 'qrcode' });
      // and counts nothing even when it reaches the count unparsed
      expect((await submitAx(orgA, axInput({ qr: `${campaign.code}' or '1'='1` }))).leadCreated).toBe(
        true
      );

      const after = await pg
        .select({ id: qrCampaigns.id, completionCount: qrCampaigns.completionCount })
        .from(qrCampaigns)
        .where(inArray(qrCampaigns.organizationId, [orgA, orgB]));
      expect(after).toEqual(expect.arrayContaining(before));
      expect(after).toHaveLength(before.length);
    });

    it('a test answer', async () => {
      const campaign = await createCampaign(orgA);
      const counted = await pg.transaction((tx) =>
        countQrCompletion(tx, {
          organizationId: orgA,
          leadCreated: true,
          isTest: true,
          tracking: { qr: campaign.code },
        })
      );
      expect(counted).toBe(false);
      expect(await completionsOf(campaign.id)).toBe(0);
    });
  });

  it('counts answers of different new leads at the same moment exactly', async () => {
    const campaign = await createCampaign(orgA, { diagnosisId: diagnosisOfA.id });
    const answers = 24;
    const outcomes = await Promise.all(
      Array.from({ length: answers }, (_, i) =>
        i % 2
          ? submitAx(orgA, axInput({ qr: campaign.code }))
          : submitBuilder(builderInput({ qr: campaign.code }))
      )
    );
    expect(outcomes.every((outcome) => outcome.leadCreated)).toBe(true);
    expect(await completionsOf(campaign.id)).toBe(answers);
  });

  it('getCampaignStats answers the leads and the rate from the campaign row', async () => {
    const campaign = await createCampaign(orgA);
    // Four scans at the entry, one lead from them
    const tracking = await scanAndRead(campaign.code);
    for (let i = 0; i < 3; i++) await scanAndRead(campaign.code);
    await submitAx(orgA, axInput(tracking));

    const [user] = await pg
      .insert(users)
      .values({ email: `qr-done-${unique()}@example.com`, name: 'QR' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId: orgA, userId: user.id, role: 'admin' });
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
    const caller = appRouter.createCaller({
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
    const stats = await caller.distribution.getCampaignStats({
      organizationId: orgA,
      campaignId: campaign.id,
    });
    expect(stats).toMatchObject({ totalScans: 4, totalConversions: 1, conversionRate: 25 });
  });
});
