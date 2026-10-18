/**
 * AX migration submission against a real PostgreSQL database.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ax-migration-submission.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { axSalesPlaybooks, diagnosticSubmissions, leads, organizations } from '@/lib/db/schema';
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import {
  type AxMigrationSubmissionInput,
  addAxMigrationDetails,
  RESULT_SCREEN_WINDOW_MS,
  requestAxMigrationConsultation,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AX migration submission (PostgreSQL)', () => {
  // Several connections so that concurrent submissions really run in parallel
  const client = url ? postgres(url, { max: 4 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof submitAxMigrationDiagnosis>[0];
  let organizationId: string;
  let otherOrganizationId: string;
  const now = new Date('2026-10-09T01:00:00Z');
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const input = (overrides: Partial<AxMigrationSubmissionInput> = {}): AxMigrationSubmissionInput => ({
    answers: as400Answers,
    contact: { company: '三田製作所', name: '山田 太郎', email: `Yamada-${unique()}@Example.co.jp` },
    privacyConsent: true,
    consultationRequested: false,
    tracking: { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'ax-hito' },
    locale: 'ja',
    ...overrides,
  });

  const leadsByEmail = (orgId: string, email: string) =>
    pg
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), sql`lower(${leads.email}) = ${email.toLowerCase()}`));

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: 'AX test', slug: `ax-test-${unique()}` },
        { name: 'AX other', slug: `ax-other-${unique()}` },
      ])
      .returning({ id: organizations.id });
    organizationId = created[0].id;
    otherOrganizationId = created[1].id;
  });

  afterAll(async () => {
    if (organizationId) {
      await pg.delete(organizations).where(eq(organizations.id, organizationId));
      await pg.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    }
    await client?.end();
  });

  it('creates a lead with pipeline fields filled from the diagnosis', async () => {
    const data = input();
    const outcome = await submitAxMigrationDiagnosis(db, organizationId, data, now);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.leadCreated).toBe(true);
    expect(outcome.existingLead).toBeNull();

    const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
    expect(lead).toMatchObject({
      email: data.contact.email.toLowerCase(),
      company: '三田製作所',
      status: 'new',
      source: 'website',
      inflowSource: 'advertising',
      conversionPoint: 'web_diagnosis',
      targetSystem: 'as400',
      score: outcome.result.leadScore,
    });
    // An IT department head: a decision-making role makes it 関心あり（MQL） (#139)
    expect(lead?.mqlQualifiedAt).toEqual(now);
    expect(lead?.responses).toMatchObject({
      axMigration: {
        submissionId: outcome.submissionId,
        mqlCandidate: true,
        mql: { level: 'interest', signals: ['decision_role'], unmet: [] },
        primaryChallenge: 'people',
        platform: 'as400',
      },
    });

    const submission = await pg.query.diagnosticSubmissions.findFirst({
      where: eq(diagnosticSubmissions.id, outcome.submissionId),
    });
    expect(submission).toMatchObject({
      leadId: outcome.leadId,
      leadCreated: true,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 3,
      tracking: { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'ax-hito' },
      consultationRequestedAt: null,
    });
  });

  describe('適合 and 関心あり（MQL） (#139)', () => {
    /** Target industry and system, nothing that shows interest */
    const fitOnly = { ...as400Answers, role: 'it_staff' };

    it('leaves the MQL date empty for a lead that only fits', async () => {
      const outcome = await submitAxMigrationDiagnosis(db, organizationId, input({ answers: fitOnly }), now);
      if (!outcome.ok) throw new Error('submission failed');
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.mqlQualifiedAt).toBeNull();
      expect(lead?.responses).toMatchObject({
        axMigration: { mqlCandidate: true, mql: { level: 'fit', signals: [], unmet: [] } },
      });
    });

    it('makes a consultation request on the form 関心あり', async () => {
      const outcome = await submitAxMigrationDiagnosis(
        db,
        organizationId,
        input({ answers: fitOnly, consultationRequested: true }),
        now
      );
      if (!outcome.ok) throw new Error('submission failed');
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.mqlQualifiedAt).toEqual(now);
      expect(lead?.responses).toMatchObject({
        axMigration: { mql: { level: 'interest', signals: ['consultation'] } },
      });
    });

    it('turns a fitting lead into 関心あり on a later consultation request, and records it on the submission', async () => {
      const outcome = await submitAxMigrationDiagnosis(db, organizationId, input({ answers: fitOnly }), now);
      if (!outcome.ok) throw new Error('submission failed');
      const later = new Date(now.getTime() + 60_000);
      const request = await requestAxMigrationConsultation(db, outcome.submissionId, later);
      expect(request).toMatchObject({ ok: true, alreadyRequested: false });

      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead).toMatchObject({ conversionPoint: 'consultation', mqlQualifiedAt: later });
      expect(lead?.responses).toMatchObject({
        axMigration: { consultationRequested: true, mql: { level: 'interest', signals: ['consultation'] } },
      });
      const submission = await pg.query.diagnosticSubmissions.findFirst({
        where: eq(diagnosticSubmissions.id, outcome.submissionId),
      });
      expect(submission?.result).toMatchObject({ mql: { level: 'interest', qualified: true } });
    });

    it('keeps an MQL date already set when a consultation is requested later', async () => {
      const outcome = await submitAxMigrationDiagnosis(db, organizationId, input(), now);
      if (!outcome.ok) throw new Error('submission failed');
      await requestAxMigrationConsultation(db, outcome.submissionId, new Date(now.getTime() + 60_000));
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.mqlQualifiedAt).toEqual(now);
      expect(lead?.responses).toMatchObject({
        axMigration: { mql: { level: 'interest', signals: ['consultation', 'decision_role'] } },
      });
    });

    it('does not make a lead outside the target an MQL on a consultation request', async () => {
      const outcome = await submitAxMigrationDiagnosis(
        db,
        organizationId,
        input({ answers: { ...fitOnly, industry: 'other' } }),
        now
      );
      if (!outcome.ok) throw new Error('submission failed');
      await requestAxMigrationConsultation(db, outcome.submissionId, now);
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead).toMatchObject({ conversionPoint: 'consultation', mqlQualifiedAt: null });
      expect(lead?.responses).toMatchObject({
        axMigration: { consultationRequested: true, mql: { level: 'none', unmet: ['industry'] } },
      });
    });
  });

  it('checks the company size against the target ranges of the sales playbook (#150)', async () => {
    const content = emptyAxPlaybookContent();
    content.targetCompany.annual_revenue = ['1b_3b', '3b_10b'];
    await pg.insert(axSalesPlaybooks).values({ organizationId: otherOrganizationId, content });

    const outside = await submitAxMigrationDiagnosis(
      db,
      otherOrganizationId,
      input({ answers: { ...as400Answers, annual_revenue: 'over_30b', employees: '50_299' } }),
      now
    );
    const skipped = await submitAxMigrationDiagnosis(db, otherOrganizationId, input(), now);
    // Another organization without a playbook: no condition
    const elsewhere = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ answers: { ...as400Answers, annual_revenue: 'over_30b' } }),
      now
    );
    if (!outside.ok || !skipped.ok || !elsewhere.ok) throw new Error('submission failed');

    expect(outside.result.mql).toMatchObject({
      level: 'none',
      candidate: false,
      unmet: ['company_size'],
    });
    const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outside.leadId) });
    expect(lead?.responses).toMatchObject({
      axMigration: {
        mqlCandidate: false,
        companySizeFit: 'not_fit',
        mql: { level: 'none', unmet: ['company_size'] },
      },
    });
    // A later consultation request does not make a company outside the ranges 関心あり
    const request = await requestAxMigrationConsultation(
      db,
      outside.submissionId,
      new Date(now.getTime() + 60_000)
    );
    expect(request).toMatchObject({ ok: true });
    const requested = await pg.query.leads.findFirst({ where: eq(leads.id, outside.leadId) });
    expect(requested?.mqlQualifiedAt).toBeNull();
    expect(requested?.responses).toMatchObject({
      axMigration: { mql: { level: 'none', unmet: ['company_size'] } },
    });
    expect(skipped.result.mql).toMatchObject({
      candidate: true,
      criteria: { companySize: 'unknown' },
    });
    expect(elsewhere.result.mql).toMatchObject({
      candidate: true,
      criteria: { companySize: 'not_configured' },
    });
  });

  it('never modifies an existing lead from the public form (email is case-insensitive)', async () => {
    const email = `owner-${unique()}@example.co.jp`;
    const [existing] = await pg
      .insert(leads)
      .values({
        organizationId,
        email,
        name: '登録済み 花子',
        company: '登録済み商事',
        status: 'negotiating',
        hasNegotiated: true,
        score: 40,
        inflowSource: 'existing_customer',
        conversionPoint: 'via_sales',
        dealPhase: 'proposal',
        responses: { note: 'keep me' },
      })
      .returning();

    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({
        contact: { company: '偽名商事', name: '偽名', email: email.toUpperCase() },
        tracking: { ref: 'partner-x' },
        consultationRequested: true,
      }),
      now
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.leadCreated).toBe(false);
    expect(outcome.leadId).toBe(existing.id);
    expect(outcome.existingLead).toEqual({ name: '登録済み 花子', company: '登録済み商事', email });

    const [after] = await leadsByEmail(organizationId, email);
    expect(after).toMatchObject({
      name: '登録済み 花子',
      company: '登録済み商事',
      status: 'negotiating',
      score: 40,
      inflowSource: 'existing_customer',
      conversionPoint: 'via_sales',
      dealPhase: 'proposal',
      referrerName: null,
      responses: { note: 'keep me' },
    });

    const submission = await pg.query.diagnosticSubmissions.findFirst({
      where: eq(diagnosticSubmissions.id, outcome.submissionId),
    });
    expect(submission).toMatchObject({ leadId: existing.id, leadCreated: false });
    expect(submission?.consultationRequestedAt).toBeInstanceOf(Date);
  });

  it('creates only one lead when the same email is submitted concurrently', async () => {
    const email = `double-${unique()}@example.jp`;
    const data = input({ contact: { company: '並行商事', name: '並行', email } });
    const outcomes = await Promise.all([
      submitAxMigrationDiagnosis(db, organizationId, data, now),
      submitAxMigrationDiagnosis(db, organizationId, data, now),
      submitAxMigrationDiagnosis(db, organizationId, data, now),
    ]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(await leadsByEmail(organizationId, email)).toHaveLength(1);
    expect(outcomes.filter((o) => o.ok && o.leadCreated)).toHaveLength(1);
  });

  it('serializes submissions for the same email with an advisory lock', async () => {
    const email = `locked-${unique()}@example.jp`;
    // Hold the same lock from another session, as a concurrent submission would
    const holder = postgres(url as string, { max: 1 });
    await holder`SELECT pg_advisory_lock(hashtextextended(${`${organizationId}:${email}`}, 0))`;

    let settled = false;
    const pending = submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ contact: { company: 'ロック商事', name: 'ロック', email } }),
      now
    ).then((outcome) => {
      settled = true;
      return outcome;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false); // still waiting for the lock

    await holder`SELECT pg_advisory_unlock(hashtextextended(${`${organizationId}:${email}`}, 0))`;
    await holder.end();
    const outcome = await pending;
    expect(outcome.ok && outcome.leadCreated).toBe(true);
  });

  it('keeps organizations apart: the same email in another organization is not touched', async () => {
    const email = `tenant-${unique()}@example.jp`;
    await pg.insert(leads).values({ organizationId: otherOrganizationId, email, company: '他社' });

    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ contact: { company: '自社', name: '自社', email } }),
      now
    );
    expect(outcome.ok && outcome.leadCreated).toBe(true);
    expect(await leadsByEmail(organizationId, email)).toHaveLength(1);
    const [other] = await leadsByEmail(otherOrganizationId, email);
    expect(other.company).toBe('他社');
  });

  it('rejects invalid answers without writing anything', async () => {
    const count = async () =>
      (
        await pg
          .select()
          .from(diagnosticSubmissions)
          .where(eq(diagnosticSubmissions.organizationId, organizationId))
      ).length;
    const before = await count();
    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ answers: { industry: 'manufacturing' } }),
      now
    );
    expect(outcome.ok).toBe(false);
    expect(await count()).toBe(before);
  });

  it('records a consultation request once even when it arrives concurrently', async () => {
    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ contact: { company: '品川商事', name: '佐藤', email: `sato-${unique()}@example.jp` } }),
      now
    );
    if (!outcome.ok) throw new Error('submission failed');

    const results = await Promise.all([
      requestAxMigrationConsultation(db, outcome.submissionId, now),
      requestAxMigrationConsultation(db, outcome.submissionId, now),
      requestAxMigrationConsultation(db, outcome.submissionId, now),
    ]);
    const first = results.filter((r) => r.ok && !r.alreadyRequested);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ leadId: outcome.leadId, leadCreated: true });

    const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
    expect(lead?.conversionPoint).toBe('consultation');
    expect(lead?.responses).toMatchObject({ axMigration: { consultationRequested: true } });
  });

  it('does not update an existing lead on a consultation request from its email', async () => {
    const email = `existing-consult-${unique()}@example.jp`;
    const [existing] = await pg
      .insert(leads)
      .values({ organizationId, email, conversionPoint: 'document_download' })
      .returning();
    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ contact: { company: 'x', name: 'x', email } }),
      now
    );
    if (!outcome.ok) throw new Error('submission failed');

    const result = await requestAxMigrationConsultation(db, outcome.submissionId, now);
    expect(result).toMatchObject({ ok: true, alreadyRequested: false, leadCreated: false });
    const lead = await pg.query.leads.findFirst({ where: eq(leads.id, existing.id) });
    expect(lead?.conversionPoint).toBe('document_download');
  });

  it('closes the consultation request once the result screen window has passed (#232)', async () => {
    const outcome = await submitAxMigrationDiagnosis(db, organizationId, input(), now);
    if (!outcome.ok) throw new Error('submission failed');

    const late = new Date(now.getTime() + RESULT_SCREEN_WINDOW_MS + 1);
    const result = await requestAxMigrationConsultation(db, outcome.submissionId, late);
    expect(result).toEqual({ ok: false, reason: 'closed' });
    const row = await pg.query.diagnosticSubmissions.findFirst({
      where: eq(diagnosticSubmissions.id, outcome.submissionId),
    });
    expect(row?.consultationRequestedAt).toBeNull();
  });

  it('still answers alreadyRequested after the window for a request made in time (#232)', async () => {
    const outcome = await submitAxMigrationDiagnosis(db, organizationId, input(), now);
    if (!outcome.ok) throw new Error('submission failed');
    await requestAxMigrationConsultation(db, outcome.submissionId, now);

    const late = new Date(now.getTime() + RESULT_SCREEN_WINDOW_MS + 1);
    const result = await requestAxMigrationConsultation(db, outcome.submissionId, late);
    expect(result).toMatchObject({ ok: true, alreadyRequested: true });
  });

  it('returns not_found for an unknown submission', async () => {
    const result = await requestAxMigrationConsultation(db, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  describe('follow-up answers after the result', () => {
    it('adds them, evaluates again and updates the lead the diagnosis created', async () => {
      const outcome = await submitAxMigrationDiagnosis(db, organizationId, input(), now);
      if (!outcome.ok) throw new Error('submission failed');

      const details = await addAxMigrationDetails(
        db,
        outcome.submissionId,
        { as400_screens_forms: 'gte1000', gaiji: 'many' },
        now
      );
      if (!details.ok) throw new Error(`details failed: ${details.reason}`);
      expect(details.result.difficulty.score).toBeGreaterThan(outcome.result.difficulty.score);

      const [submission] = await pg
        .select()
        .from(diagnosticSubmissions)
        .where(eq(diagnosticSubmissions.id, outcome.submissionId));
      expect(submission.answers).toMatchObject({
        platform: 'as400',
        as400_screens_forms: 'gte1000',
        gaiji: 'many',
      });
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.score).toBe(details.result.leadScore);
      expect(lead?.responses).toMatchObject({
        axMigration: { detailsAnsweredAt: now.toISOString() },
      });
    });

    it('accepts only follow-up questions of the chosen path', async () => {
      const outcome = await submitAxMigrationDiagnosis(db, organizationId, input(), now);
      if (!outcome.ok) throw new Error('submission failed');

      // The answers the result was based on cannot be changed afterwards
      expect(
        await addAxMigrationDetails(db, outcome.submissionId, { maintenance: 'team' }, now)
      ).toMatchObject({ ok: false, reason: 'invalid' });
      // A follow-up of another path does not apply
      expect(
        await addAxMigrationDetails(db, outcome.submissionId, { access_size: 'gte1gb' }, now)
      ).toMatchObject({ ok: false, reason: 'invalid' });

      const [submission] = await pg
        .select()
        .from(diagnosticSubmissions)
        .where(eq(diagnosticSubmissions.id, outcome.submissionId));
      expect(submission.answers).toEqual(outcome.answers);
    });

    it('accepts the follow-up answers once, and only within a day', async () => {
      const first = await submitAxMigrationDiagnosis(db, organizationId, input(), now);
      if (!first.ok) throw new Error('submission failed');
      expect(await addAxMigrationDetails(db, first.submissionId, { gaiji: 'none' }, now)).toMatchObject(
        { ok: true }
      );
      // A second call (or a leaked id) changes nothing
      expect(
        await addAxMigrationDetails(db, first.submissionId, { as400_query: 'many' }, now)
      ).toEqual({ ok: false, reason: 'closed' });

      const late = await submitAxMigrationDiagnosis(db, organizationId, input(), now);
      if (!late.ok) throw new Error('submission failed');
      const nextDay = new Date(now.getTime() + 25 * 60 * 60 * 1000);
      expect(await addAxMigrationDetails(db, late.submissionId, { gaiji: 'none' }, nextDay)).toEqual({
        ok: false,
        reason: 'closed',
      });
    });

    it('keeps a lead score that sales have changed', async () => {
      const outcome = await submitAxMigrationDiagnosis(db, organizationId, input(), now);
      if (!outcome.ok) throw new Error('submission failed');
      await pg.update(leads).set({ score: 99 }).where(eq(leads.id, outcome.leadId));

      const details = await addAxMigrationDetails(
        db,
        outcome.submissionId,
        { as400_screens_forms: 'gte1000' },
        now
      );
      expect(details.ok).toBe(true);
      const lead = await pg.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) });
      expect(lead?.score).toBe(99);
      expect(lead?.responses).toMatchObject({
        axMigration: { detailsAnsweredAt: now.toISOString() },
      });
    });

    it('does not touch a lead that existed before the diagnosis', async () => {
      const data = input();
      const first = await submitAxMigrationDiagnosis(db, organizationId, data, now);
      const second = await submitAxMigrationDiagnosis(db, organizationId, data, now);
      if (!first.ok || !second.ok) throw new Error('submission failed');
      expect(second.leadCreated).toBe(false);
      const before = await pg.query.leads.findFirst({ where: eq(leads.id, first.leadId) });

      const details = await addAxMigrationDetails(
        db,
        second.submissionId,
        { as400_screens_forms: 'gte1000', gaiji: 'many' },
        now
      );
      expect(details.ok).toBe(true);
      const after = await pg.query.leads.findFirst({ where: eq(leads.id, first.leadId) });
      expect(after?.score).toBe(before?.score);
      expect(after?.responses).toEqual(before?.responses);
    });

    it('returns not_found for an unknown submission', async () => {
      expect(
        await addAxMigrationDetails(db, '00000000-0000-0000-0000-000000000000', { gaiji: 'none' })
      ).toEqual({ ok: false, reason: 'not_found' });
    });
  });
});
