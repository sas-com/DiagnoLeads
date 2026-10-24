/**
 * Builder diagnosis submissions (#116) against a real PostgreSQL: the public lookup, accepted
 * versions (current / replaced within 24 hours), lead creation and matching, the stored
 * evaluation, consultation requests and the pending consultation list.
 * Only a fictional diagnosis is used (the repository is public).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_builder116 \
 *     bunx vitest --run test/unit/integration/diagnosis-submission.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  agencyLinks,
  diagnoses,
  diagnosisVersions,
  diagnosticSubmissions,
  leads,
  organizations,
} from '@/lib/db/schema';
import { getDashboardSummary } from '@/lib/features/analytics/dashboard';
import {
  findPublicDiagnosis,
  resolveSubmittedVersion,
} from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  type DiagnosisSubmissionInput,
  requestBuilderConsultation,
  submitBuilderDiagnosis,
} from '@/lib/features/diagnosis-builder/submission-service';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import { generateAgencyCode } from '@/lib/features/agency-links/types/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('builder diagnosis submission (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof submitBuilderDiagnosis>[0];
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date('2026-10-16T01:00:00Z');
  const HOUR = 60 * 60 * 1000;

  let organizationId: string;
  let otherOrganizationId: string;
  let diagnosisId: string;
  let slug: string;
  /** v1 replaced by v2 two hours ago; v2 is current */
  let v1: string;
  let v2: string;

  const answers = { hosting: 'onprem', team_size: 150, migration_plan: 'this_year', confidence: 4 };

  const input = (overrides: Partial<DiagnosisSubmissionInput> = {}): DiagnosisSubmissionInput => ({
    versionId: v2,
    answers,
    contact: { company: '架空商事', name: '試験 太郎', email: `Taro-${unique()}@Example.co.jp` },
    privacyConsent: true,
    consentVersion: '2026-10-01',
    consultationRequested: false,
    tracking: { utmSource: 'newsletter', utmMedium: 'email' },
    locale: 'ja',
    ...overrides,
  });

  const accepted = async (versionId: string, at: Date = now) => {
    const resolved = await resolveSubmittedVersion(db, slug, versionId, at);
    if (!resolved.ok) throw new Error(`version not accepted: ${resolved.reason}`);
    return resolved;
  };

  async function insertDiagnosis(orgId: string, diagnosisSlug: string, versions: Date[]) {
    const definition = cloudReadiness();
    const [row] = await pg
      .insert(diagnoses)
      .values({
        organizationId: orgId,
        slug: diagnosisSlug,
        name: '架空のクラウド準備度',
        status: 'published',
        draftDefinition: definition,
      })
      .returning({ id: diagnoses.id });
    const ids: string[] = [];
    for (const [index, publishedAt] of versions.entries()) {
      const versioned = { ...definition, title: `${definition.title} v${index + 1}` };
      const [version] = await pg
        .insert(diagnosisVersions)
        .values({
          diagnosisId: row.id,
          organizationId: orgId,
          version: index + 1,
          definition: versioned,
          definitionHash: hashDefinition(versioned),
          changeSummary: {
            previousVersion: index === 0 ? null : index,
            questionsAdded: [],
            questionsRemoved: [],
            questionsChanged: [],
            partsChanged: ['title'],
          },
          publishedAt,
        })
        .returning({ id: diagnosisVersions.id });
      ids.push(version.id);
    }
    await pg
      .update(diagnoses)
      .set({ currentVersionId: ids[ids.length - 1] })
      .where(eq(diagnoses.id, row.id));
    return { id: row.id, versionIds: ids };
  }

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: 'Builder submit test', slug: `dx-test-${unique()}` },
        { name: 'Builder other', slug: `dx-other-${unique()}` },
      ])
      .returning({ id: organizations.id });
    organizationId = created[0].id;
    otherOrganizationId = created[1].id;
    slug = `cloud-check-${Math.random().toString(36).slice(2, 8)}`;
    const inserted = await insertDiagnosis(organizationId, slug, [
      new Date(now.getTime() - 48 * HOUR),
      new Date(now.getTime() - 2 * HOUR),
    ]);
    diagnosisId = inserted.id;
    [v1, v2] = inserted.versionIds;
  });

  afterAll(async () => {
    if (organizationId) {
      await pg.delete(organizations).where(eq(organizations.id, organizationId));
      await pg.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    }
    await client?.end();
  });

  describe('public lookup and versions', () => {
    it('finds the published diagnosis with its current version and organization', async () => {
      const found = await findPublicDiagnosis(db, slug);
      expect(found).toMatchObject({
        id: diagnosisId,
        organizationId,
        current: { id: v2, version: 2 },
      });
    });

    it('does not serve a paused diagnosis or an invalid slug', async () => {
      const paused = await insertDiagnosis(organizationId, `paused-${unique()}`, [now]);
      await pg.update(diagnoses).set({ status: 'paused' }).where(eq(diagnoses.id, paused.id));
      const pausedSlug = (
        await pg.select({ slug: diagnoses.slug }).from(diagnoses).where(eq(diagnoses.id, paused.id))
      )[0].slug;
      expect(await findPublicDiagnosis(db, pausedSlug)).toBeNull();
      expect(await findPublicDiagnosis(db, 'Not A Slug')).toBeNull();
    });

    it('does not serve a slug published by two organizations', async () => {
      const shared = `shared-${Math.random().toString(36).slice(2, 8)}`;
      await insertDiagnosis(organizationId, shared, [now]);
      expect(await findPublicDiagnosis(db, shared)).not.toBeNull();
      await insertDiagnosis(otherOrganizationId, shared, [now]);
      expect(await findPublicDiagnosis(db, shared)).toBeNull();
    });

    it('accepts the current version and the one replaced within 24 hours, else outdated', async () => {
      expect((await accepted(v2)).version.version).toBe(2);
      // v2 was published 2 hours before `now`
      expect((await accepted(v1)).version).toMatchObject({ id: v1, version: 1 });
      const later = new Date(now.getTime() + 23 * HOUR);
      expect((await resolveSubmittedVersion(db, slug, v1, later)).ok).toBe(false);
      expect(await resolveSubmittedVersion(db, slug, v1, later)).toEqual({
        ok: false,
        reason: 'outdated',
      });
      expect(
        await resolveSubmittedVersion(db, slug, '00000000-0000-4000-8000-000000000000', now)
      ).toEqual({ ok: false, reason: 'outdated' });
    });

    it('a version of another diagnosis is outdated, not accepted', async () => {
      const other = await insertDiagnosis(organizationId, `other-${unique()}`, [now]);
      expect(await resolveSubmittedVersion(db, slug, other.versionIds[0], now)).toEqual({
        ok: false,
        reason: 'outdated',
      });
    });
  });

  describe('submissions', () => {
    it('creates a lead with the server score, MQL and summary, and stores the evaluation', async () => {
      const { diagnosis, version } = await accepted(v2);
      const data = input();
      const outcome = await submitBuilderDiagnosis(db, diagnosis, version, data, now);
      if (!outcome.ok) throw new Error('submission failed');
      expect(outcome.leadCreated).toBe(true);
      // team ≥ 100 (+30) and this year (+40) → 70; required team ≥ 10 met, score ≥ 50
      expect(outcome.evaluation.leadScore).toEqual({
        points: 70,
        reasons: ['担当者が100人以上', '今年中に移行の予定がある'],
      });
      expect(outcome.evaluation.mql.qualified).toBe(true);

      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead).toMatchObject({
        organizationId,
        email: data.contact.email.toLowerCase(),
        company: '架空商事',
        status: 'new',
        score: 70,
        source: 'website',
        conversionPoint: 'web_diagnosis',
      });
      expect(lead?.mqlQualifiedAt).toEqual(now);
      expect(lead?.responses).toMatchObject({
        diagnosis: {
          diagnosisId,
          slug,
          version: 2,
          versionId: v2,
          submissionId: outcome.submissionId,
          resultTypeName: '計画型',
          leadScore: 70,
          leadScoreReasons: ['担当者が100人以上', '今年中に移行の予定がある'],
          mqlLevel: 'interest',
          mqlQualified: true,
          mqlReasons: ['リードスコア 70 点（基準 50 点以上）', '今年中に移行する予定（強いシグナル）'],
          consultationRequested: false,
        },
      });

      const submission = await pg.query.diagnosticSubmissions.findFirst({
        where: eq(diagnosticSubmissions.id, outcome.submissionId),
      });
      expect(submission).toMatchObject({
        organizationId,
        leadId: outcome.leadId,
        leadCreated: true,
        diagnosticKey: `d:${diagnosisId}`,
        diagnosticVersion: 2,
        diagnosisVersionId: v2,
        isTest: false,
        consent: { version: '2026-10-01', agreedAt: now.toISOString() },
        answers,
        consultationRequestedAt: null,
      });
      expect(submission?.result).toMatchObject({ leadScore: { points: 70 }, resultTypeId: 'planner' });
    });

    it('stores the previous version number when the replaced version is answered', async () => {
      const { diagnosis, version } = await accepted(v1);
      const outcome = await submitBuilderDiagnosis(db, diagnosis, version, input({ versionId: v1 }), now);
      if (!outcome.ok) throw new Error('submission failed');
      const submission = await pg.query.diagnosticSubmissions.findFirst({
        where: eq(diagnosticSubmissions.id, outcome.submissionId),
      });
      expect(submission).toMatchObject({ diagnosticVersion: 1, diagnosisVersionId: v1 });
    });

    it('never modifies an existing lead (email is case-insensitive)', async () => {
      const email = `owner-${unique()}@example.co.jp`;
      const [existing] = await pg
        .insert(leads)
        .values({
          organizationId,
          email,
          name: '既存 花子',
          company: '既存社',
          score: 5,
          status: 'nurturing',
          responses: { note: 'kept' },
        })
        .returning();
      const { diagnosis, version } = await accepted(v2);
      const outcome = await submitBuilderDiagnosis(
        db,
        diagnosis,
        version,
        input({
          contact: { company: '別の会社', name: '別人', email: email.toUpperCase() },
          consultationRequested: true,
        }),
        now
      );
      if (!outcome.ok) throw new Error('submission failed');
      expect(outcome).toMatchObject({
        leadId: existing.id,
        leadCreated: false,
        existingLead: { name: '既存 花子', company: '既存社', email },
      });
      const after = await pg.query.leads.findFirst({ where: eq(leads.id, existing.id) });
      expect(after).toMatchObject({
        name: '既存 花子',
        company: '既存社',
        score: 5,
        status: 'nurturing',
        conversionPoint: null,
        mqlQualifiedAt: null,
        responses: { note: 'kept' },
      });
      const count = await pg
        .select({ n: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), sql`lower(${leads.email}) = ${email}`));
      expect(count[0].n).toBe(1);
    });

    it('serializes concurrent submissions for the same email: one lead', async () => {
      const { diagnosis, version } = await accepted(v2);
      const data = input();
      const outcomes = await Promise.all(
        [0, 1, 2].map(() => submitBuilderDiagnosis(db, diagnosis, version, data, now))
      );
      const leadIds = new Set(outcomes.map((o) => (o.ok ? o.leadId : null)));
      expect(leadIds.size).toBe(1);
      expect(outcomes.filter((o) => o.ok && o.leadCreated)).toHaveLength(1);
    });

    it('takes the inflow source from an issued agency link, as the AX diagnosis does (#481)', async () => {
      const { diagnosis, version } = await accepted(v2);
      const [link] = await pg
        .insert(agencyLinks)
        .values({
          organizationId,
          code: generateAgencyCode(),
          agencyName: '架空テレアポ',
          kind: 'telemarketing_agency',
        })
        .returning();
      const outcome = await submitBuilderDiagnosis(
        db,
        diagnosis,
        version,
        // The link decides over the UTM parameters
        input({ tracking: { agency: link.code.toUpperCase(), utmMedium: 'cpc' } }),
        now
      );
      if (!outcome.ok) throw new Error('submission failed');
      expect(outcome.referralMemberUserId).toBeNull();
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead).toMatchObject({
        inflowSource: 'telemarketing_agency',
        agencyName: '架空テレアポ',
        agencyLinkId: link.id,
        referrerName: null,
      });

      // A link of another organization attributes nothing
      const [other] = await pg
        .insert(agencyLinks)
        .values({
          organizationId: otherOrganizationId,
          code: generateAgencyCode(),
          agencyName: '別組織の代行',
          kind: 'referral_agency',
        })
        .returning();
      const unrelated = await submitBuilderDiagnosis(
        db,
        diagnosis,
        version,
        input({ tracking: { agency: other.code } }),
        now
      );
      if (!unrelated.ok) throw new Error('submission failed');
      const plain = await pg.query.leads.findFirst({ where: eq(leads.id, unrelated.leadId) });
      expect(plain).toMatchObject({ inflowSource: 'lp_organic', agencyLinkId: null });
    });

    it('rejects invalid answers without saving anything', async () => {
      const { diagnosis, version } = await accepted(v2);
      const data = input({ answers: { hosting: 'onprem', points: 100 } });
      const outcome = await submitBuilderDiagnosis(db, diagnosis, version, data, now);
      expect(outcome.ok).toBe(false);
      const saved = await pg.query.leads.findFirst({
        where: sql`lower(${leads.email}) = ${data.contact.email.toLowerCase()}`,
      });
      expect(saved).toBeUndefined();
    });
  });

  describe('consultation requests', () => {
    it('with the submission: lead in the pending consultation list with the request time', async () => {
      const { diagnosis, version } = await accepted(v2);
      const outcome = await submitBuilderDiagnosis(
        db,
        diagnosis,
        version,
        input({ consultationRequested: true }),
        now
      );
      if (!outcome.ok) throw new Error('submission failed');
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.conversionPoint).toBe('consultation');

      const summary = await getDashboardSummary(
        pg as unknown as Parameters<typeof getDashboardSummary>[0],
        organizationId,
        30,
        new Date(now.getTime() + HOUR)
      );
      const pending = summary.pendingConsultations.find((p) => p.id === outcome.leadId);
      expect(pending).toMatchObject({ requestedAt: now, deadline: '2026/10/20' });
    });

    it('from the result page: recorded once, lead updated only when the submission created it', async () => {
      const { diagnosis, version } = await accepted(v2);
      const outcome = await submitBuilderDiagnosis(db, diagnosis, version, input(), now);
      if (!outcome.ok) throw new Error('submission failed');
      const at = new Date(now.getTime() + 60_000);

      const first = await requestBuilderConsultation(db, diagnosisId, outcome.submissionId, at);
      expect(first).toEqual({
        ok: true,
        alreadyRequested: false,
        organizationId,
        leadId: outcome.leadId,
        leadCreated: true,
        requestedAt: at,
      });
      // A later call gets the time of the first request: the preferences close a day after it (#241)
      const second = await requestBuilderConsultation(
        db,
        diagnosisId,
        outcome.submissionId,
        new Date(at.getTime() + 60_000)
      );
      expect(second).toMatchObject({ ok: true, alreadyRequested: true, requestedAt: at });

      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.conversionPoint).toBe('consultation');
      expect(lead?.responses).toMatchObject({
        diagnosis: { consultationRequested: true, leadScore: 70 },
      });
      const submission = await pg.query.diagnosticSubmissions.findFirst({
        where: eq(diagnosticSubmissions.id, outcome.submissionId),
      });
      expect(submission?.consultationRequestedAt).toEqual(at);
    });

    it('適合 only, then a consultation from the result page makes it 関心あり (#139)', async () => {
      const { diagnosis, version } = await accepted(v2);
      const fitAnswers = { hosting: 'cloud', team_size: 50, practices: ['none'], confidence: 1 };
      const outcome = await submitBuilderDiagnosis(
        db,
        diagnosis,
        version,
        input({ answers: fitAnswers }),
        now
      );
      if (!outcome.ok) throw new Error('submission failed');
      expect(outcome.evaluation.mql.level).toBe('fit');
      let lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.mqlQualifiedAt).toBeNull();
      expect(lead?.responses).toMatchObject({
        diagnosis: { mqlLevel: 'fit', mqlQualified: false, mqlReasons: [] },
      });

      const at = new Date(now.getTime() + 60_000);
      await requestBuilderConsultation(db, diagnosisId, outcome.submissionId, at);
      lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.mqlQualifiedAt).toEqual(at);
      expect(lead?.responses).toMatchObject({
        diagnosis: {
          consultationRequested: true,
          mqlLevel: 'interest',
          mqlQualified: true,
          mqlReasons: ['相談申込'],
        },
      });
      const submission = await pg.query.diagnosticSubmissions.findFirst({
        where: eq(diagnosticSubmissions.id, outcome.submissionId),
      });
      expect(submission?.result).toMatchObject({
        mql: { level: 'interest', qualified: true, reasons: [{ code: 'consultation' }] },
      });
    });

    it('a consultation with the answers makes a fit respondent 関心あり at once', async () => {
      const { diagnosis, version } = await accepted(v2);
      const outcome = await submitBuilderDiagnosis(
        db,
        diagnosis,
        version,
        input({
          answers: { hosting: 'cloud', team_size: 50, practices: ['none'], confidence: 1 },
          consultationRequested: true,
        }),
        now
      );
      if (!outcome.ok) throw new Error('submission failed');
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.mqlQualifiedAt).toEqual(now);
      expect(lead?.conversionPoint).toBe('consultation');
    });

    it('closed a day after the answer, as in the AX diagnosis (#481)', async () => {
      const { diagnosis, version } = await accepted(v2);
      const outcome = await submitBuilderDiagnosis(db, diagnosis, version, input(), now);
      if (!outcome.ok) throw new Error('submission failed');
      const dayLater = new Date(now.getTime() + 24 * HOUR + 60_000);
      expect(
        await requestBuilderConsultation(db, diagnosisId, outcome.submissionId, dayLater)
      ).toEqual({ ok: false, reason: 'closed' });
      const submission = await pg.query.diagnosticSubmissions.findFirst({
        where: eq(diagnosticSubmissions.id, outcome.submissionId),
      });
      expect(submission?.consultationRequestedAt).toBeNull();
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.conversionPoint).toBe('web_diagnosis');

      // Up to the end of the day it is still taken
      const again = await submitBuilderDiagnosis(db, diagnosis, version, input(), now);
      if (!again.ok) throw new Error('submission failed');
      expect(
        await requestBuilderConsultation(
          db,
          diagnosisId,
          again.submissionId,
          new Date(now.getTime() + 24 * HOUR)
        )
      ).toMatchObject({ ok: true, alreadyRequested: false });
    });

    it('not found for a submission of another diagnosis', async () => {
      const { diagnosis, version } = await accepted(v2);
      const outcome = await submitBuilderDiagnosis(db, diagnosis, version, input(), now);
      if (!outcome.ok) throw new Error('submission failed');
      const otherDiagnosis = '00000000-0000-4000-8000-000000000001';
      expect(
        await requestBuilderConsultation(db, otherDiagnosis, outcome.submissionId, now)
      ).toEqual({ ok: false, reason: 'not_found' });
    });
  });
});
