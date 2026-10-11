/**
 * "Diagnose another system" (continuation) and the durable rate limits, on a real PostgreSQL.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/ax-migration-continuation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { diagnosticSubmissions, leads, organizations, publicRateLimits } from '@/lib/db/schema';
import {
  type AxMigrationSubmissionInput,
  CONTINUATION_WINDOW_MS,
  addAxMigrationDetails,
  requestAxMigrationConsultation,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import {
  type RateLimitRule,
  consumeRateLimit,
  consumeRateLimits,
  pruneRateLimits,
  rateLimitKey,
} from '@/lib/features/diagnostics/rate-limit';
import { accessAnswers, as400Answers, otherAnswers } from '@/test/fixtures/ax-migration';
import { eq, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AX diagnosis: another system and rate limits (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof submitAxMigrationDiagnosis>[0];
  let organizationId: string;
  let otherOrganizationId: string;
  const now = new Date('2026-10-11T01:00:00Z');
  const later = (ms: number) => new Date(now.getTime() + ms);
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  /** Rate-limit rules of this run only, so reruns and other tests do not share counters */
  const ruleName = `test-${unique()}`;

  const input = (overrides: Partial<AxMigrationSubmissionInput> = {}): AxMigrationSubmissionInput => ({
    answers: as400Answers,
    contact: { company: '三田製作所', name: '山田 太郎', email: `cont-${unique()}@example.co.jp` },
    privacyConsent: true,
    consultationRequested: false,
    tracking: {},
    locale: 'ja',
    ...overrides,
  });

  const submit = async (data: AxMigrationSubmissionInput, at: Date = now, orgId = organizationId) => {
    const outcome = await submitAxMigrationDiagnosis(db, orgId, data, at);
    if (!outcome.ok) throw new Error(`submission failed: ${JSON.stringify(outcome.issues)}`);
    return outcome;
  };
  const leadById = (id: string) => pg.query.leads.findFirst({ where: eq(leads.id, id) });
  const submissionById = (id: string) =>
    pg.query.diagnosticSubmissions.findFirst({ where: eq(diagnosticSubmissions.id, id) });

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: 'AX continuation', slug: `ax-cont-${unique()}` },
        { name: 'AX continuation other', slug: `ax-cont-other-${unique()}` },
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
    await pg.delete(publicRateLimits).where(like(publicRateLimits.key, `${ruleName}%`));
    await client?.end();
  });

  describe('another system of the respondent who created the lead', () => {
    it('is recorded on the lead without changing who the lead is', async () => {
      const first = await submit(input({ answers: as400Answers }));
      const before = await leadById(first.leadId);
      const email = before?.email ?? '';

      const second = await submit(
        input({
          answers: accessAnswers,
          // The respondent may type the company differently the second time
          contact: { company: '別名 商事', name: '別名', email: email.toUpperCase() },
          continuedFrom: first.submissionId,
        }),
        later(10 * 60 * 1000)
      );

      expect(second.leadId).toBe(first.leadId);
      expect(second.leadCreated).toBe(false);
      expect(second.continued).toBe(true);
      // Sales are shown the identity stored on the lead
      expect(second.existingLead).toMatchObject({ company: '三田製作所', name: '山田 太郎' });

      const lead = await leadById(first.leadId);
      expect(lead).toMatchObject({
        company: '三田製作所',
        name: '山田 太郎',
        score: before?.score,
        targetSystem: 'as400',
        conversionPoint: 'web_diagnosis',
      });
      expect(lead?.responses).toMatchObject({
        axMigration: {
          submissionId: first.submissionId,
          platform: 'as400',
          otherSystems: [
            {
              submissionId: second.submissionId,
              platform: 'access',
              targetSystem: 'access',
              difficulty: second.result.difficulty.level,
              urgency: second.result.urgency.level,
              diagnosedAt: later(10 * 60 * 1000).toISOString(),
            },
          ],
        },
      });
      expect((await submissionById(second.submissionId))?.continuedFromSubmissionId).toBe(
        first.submissionId
      );
    });

    it('keeps adding systems with the same first submission', async () => {
      const first = await submit(input());
      const email = (await leadById(first.leadId))?.email ?? '';
      const contact = { company: '三田製作所', name: '山田 太郎', email };
      await submit(input({ answers: accessAnswers, contact, continuedFrom: first.submissionId }));
      const third = await submit(
        input({ answers: otherAnswers, contact, continuedFrom: first.submissionId })
      );
      expect(third.continued).toBe(true);
      const lead = await leadById(first.leadId);
      const systems = (lead?.responses as { axMigration: { otherSystems: { platform: string }[] } })
        .axMigration.otherSystems;
      expect(systems.map((system) => system.platform)).toEqual(['access', 'other']);
    });

    it('marks the lead as consultation and MQL when the other system calls for it', async () => {
      // A package system in a non-target industry: not an MQL
      const first = await submit(
        input({ answers: { ...otherAnswers, other_system: 'package', industry: 'other' } })
      );
      const before = await leadById(first.leadId);
      expect(before?.mqlQualifiedAt).toBeNull();

      const second = await submit(
        input({
          answers: as400Answers,
          contact: { company: '三田製作所', name: '山田 太郎', email: before?.email ?? '' },
          consultationRequested: true,
          continuedFrom: first.submissionId,
        }),
        later(60 * 1000)
      );
      expect(second.continued).toBe(true);
      const lead = await leadById(first.leadId);
      expect(lead?.conversionPoint).toBe('consultation');
      expect(lead?.mqlQualifiedAt).toEqual(later(60 * 1000));
      expect(lead?.responses).toMatchObject({ axMigration: { consultationRequested: true } });
    });

    it('lets a consultation request from the second result update the lead', async () => {
      const first = await submit(input());
      const email = (await leadById(first.leadId))?.email ?? '';
      const second = await submit(
        input({
          answers: accessAnswers,
          contact: { company: '三田製作所', name: '山田 太郎', email },
          continuedFrom: first.submissionId,
        })
      );

      const outcome = await requestAxMigrationConsultation(db, second.submissionId, now);
      expect(outcome).toMatchObject({ ok: true, alreadyRequested: false, continued: true });
      const lead = await leadById(first.leadId);
      expect(lead?.conversionPoint).toBe('consultation');
      expect(lead?.responses).toMatchObject({ axMigration: { consultationRequested: true } });
    });

    it('refines only that system on the lead with the follow-up answers', async () => {
      const first = await submit(input());
      const before = await leadById(first.leadId);
      const second = await submit(
        input({
          answers: as400Answers,
          contact: { company: '三田製作所', name: '山田 太郎', email: before?.email ?? '' },
          continuedFrom: first.submissionId,
        })
      );

      const refined = await addAxMigrationDetails(
        db,
        second.submissionId,
        { gaiji: 'many', as400_screens_forms: 'gte1000' },
        later(60 * 1000)
      );
      expect(refined.ok).toBe(true);
      if (!refined.ok) return;

      const lead = await leadById(first.leadId);
      const summary = (lead?.responses as { axMigration: Record<string, unknown> }).axMigration;
      // The first system and the score stay as they were
      expect(summary.difficulty).toBe(first.result.difficulty.level);
      expect(summary).not.toHaveProperty('detailsAnsweredAt');
      expect(lead?.score).toBe(before?.score);
      expect(summary.otherSystems).toEqual([
        expect.objectContaining({
          submissionId: second.submissionId,
          difficulty: refined.result.difficulty.level,
          detailsAnsweredAt: later(60 * 1000).toISOString(),
        }),
      ]);
    });
  });

  it('keeps a consultation recorded while another system is added (the lead row is locked)', async () => {
    const first = await submit(input());
    const email = (await leadById(first.leadId))?.email ?? '';
    // Another connection takes the lead row first, as the consultation request's UPDATE does
    const other = postgres(url as string, { max: 1 });
    let pending: Promise<unknown> = Promise.resolve();
    try {
      await other.begin(async (tx) => {
        await tx`select id from leads where id = ${first.leadId} for no key update`;
        pending = submit(
          input({
            answers: accessAnswers,
            contact: { company: '三田製作所', name: '山田 太郎', email },
            continuedFrom: first.submissionId,
          })
        );
        // Long enough for the submission to reach the lead row and wait for it
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx`
          update leads
          set conversion_point = 'consultation',
              responses = jsonb_set(responses, '{axMigration,consultationRequested}', 'true'::jsonb, true)
          where id = ${first.leadId}`;
      });
      await pending;
    } finally {
      await other.end();
    }
    const lead = await leadById(first.leadId);
    expect(lead?.conversionPoint).toBe('consultation');
    expect(lead?.responses).toMatchObject({
      axMigration: { consultationRequested: true, otherSystems: [{ platform: 'access' }] },
    });
  });

  describe('is not trusted', () => {
    it('when the first submission only matched a lead that was already there', async () => {
      const email = `known-${unique()}@example.co.jp`;
      await pg.insert(leads).values({ organizationId, email, name: '既存', company: '既存商事' });
      const contact = { company: '他人', name: '他人', email };
      const first = await submit(input({ contact }));
      expect(first.leadCreated).toBe(false);

      const second = await submit(
        input({ answers: accessAnswers, contact, continuedFrom: first.submissionId })
      );
      expect(second.continued).toBe(false);
      expect((await leadById(second.leadId))?.responses).toEqual({});
      expect((await submissionById(second.submissionId))?.continuedFromSubmissionId).toBeNull();
    });

    it('with the first submission of another lead', async () => {
      const someoneElse = await submit(input());
      const victim = await submit(input());
      const victimEmail = (await leadById(victim.leadId))?.email ?? '';

      const attempt = await submit(
        input({
          contact: { company: '偽', name: '偽', email: victimEmail },
          continuedFrom: someoneElse.submissionId,
        })
      );
      expect(attempt.continued).toBe(false);
      expect(attempt.existingLead).not.toBeNull();
      const lead = await leadById(victim.leadId);
      expect(lead?.responses).not.toHaveProperty('axMigration.otherSystems');
    });

    it('after the result screen has been left for more than a day', async () => {
      const first = await submit(input());
      const email = (await leadById(first.leadId))?.email ?? '';
      const second = await submit(
        input({
          answers: accessAnswers,
          contact: { company: '三田製作所', name: '山田 太郎', email },
          continuedFrom: first.submissionId,
        }),
        later(CONTINUATION_WINDOW_MS + 1000)
      );
      expect(second.continued).toBe(false);
    });

    it('with the first submission of a lead in another organization', async () => {
      const first = await submit(input());
      const email = (await leadById(first.leadId))?.email ?? '';
      await submit(input({ contact: { company: 'B社', name: 'B', email } }), now, otherOrganizationId);
      const second = await submit(
        input({
          answers: accessAnswers,
          contact: { company: 'B社', name: 'B', email },
          continuedFrom: first.submissionId,
        }),
        now,
        otherOrganizationId
      );
      expect(second.continued).toBe(false);
    });

    it('with an id that is not a submission', async () => {
      const first = await submit(input());
      const email = (await leadById(first.leadId))?.email ?? '';
      const second = await submit(
        input({
          answers: accessAnswers,
          contact: { company: '三田製作所', name: '山田 太郎', email },
          continuedFrom: '00000000-0000-4000-8000-000000000000',
        })
      );
      expect(second.continued).toBe(false);
    });
  });

  describe('durable rate limits', () => {
    const rule = (limit: number, windowMs = 60_000): RateLimitRule => ({
      name: `${ruleName}-${limit}-${windowMs}`,
      limit,
      windowMs,
    });

    it('allows up to the limit in a window, then refuses until it ends', async () => {
      const limit = rule(2);
      const id = `ip-${unique()}`;
      expect((await consumeRateLimit(db, limit, id, now)).allowed).toBe(true);
      expect((await consumeRateLimit(db, limit, id, later(1000))).allowed).toBe(true);
      const refused = await consumeRateLimit(db, limit, id, later(2000));
      expect(refused).toEqual({ allowed: false, count: 3, retryAfterSeconds: 58 });
      // Other identifiers count separately
      expect((await consumeRateLimit(db, limit, `ip-${unique()}`, later(2000))).allowed).toBe(true);
    });

    it('starts a full new window once the old one has ended', async () => {
      const limit = rule(2);
      const id = `window-${unique()}`;
      for (const at of [0, 1000, 2000]) await consumeRateLimit(db, limit, id, later(at));
      // The next window counts from one and ends a full window later
      const first = await consumeRateLimit(db, limit, id, later(60_000));
      expect(first).toEqual({ allowed: true, count: 1, retryAfterSeconds: 60 });
      expect((await consumeRateLimit(db, limit, id, later(61_000))).allowed).toBe(true);
      expect(await consumeRateLimit(db, limit, id, later(62_000))).toEqual({
        allowed: false,
        count: 3,
        retryAfterSeconds: 58,
      });
    });

    it('counts every concurrent request', async () => {
      const limit = rule(5);
      const id = `burst-${unique()}`;
      const results = await Promise.all(
        Array.from({ length: 12 }, () => consumeRateLimit(db, limit, id, now))
      );
      expect(results.filter((result) => result.allowed)).toHaveLength(5);
      const [row] = await pg
        .select()
        .from(publicRateLimits)
        .where(eq(publicRateLimits.key, rateLimitKey(limit, id)));
      expect(row.count).toBe(12);
    });

    it('stores keyed hashes, not the identifier', async () => {
      const limit = rule(3);
      const email = `private-${unique()}@example.co.jp`;
      await consumeRateLimit(db, limit, email, now);
      const rows = await pg
        .select()
        .from(publicRateLimits)
        .where(like(publicRateLimits.key, `${limit.name}:%`));
      expect(rows).toHaveLength(1);
      expect(rows[0].key).not.toContain(email);
      expect(rows[0].key).not.toContain('example');
    });

    it('stops at the first rule that refuses: later rules are not used up', async () => {
      const strict = rule(1);
      const wide = rule(10);
      const id = `multi-${unique()}`;
      await consumeRateLimits(db, [{ rule: strict, identifier: id }], now);
      const result = await consumeRateLimits(
        db,
        [
          { rule: strict, identifier: id },
          { rule: wide, identifier: id },
        ],
        later(1000)
      );
      expect(result).toEqual({ allowed: false, rule: strict.name, retryAfterSeconds: 59 });
      const wideRows = await pg
        .select()
        .from(publicRateLimits)
        .where(eq(publicRateLimits.key, rateLimitKey(wide, id)));
      expect(wideRows).toHaveLength(0);
      // Allowed requests count in every rule
      const other = `multi-${unique()}`;
      expect(
        await consumeRateLimits(db, [
          { rule: strict, identifier: other },
          { rule: wide, identifier: other },
        ])
      ).toEqual({ allowed: true });
    });

    it('deletes windows that ended more than a day ago', async () => {
      const limit = rule(3, 1000);
      const old = `old-${unique()}`;
      const recent = `recent-${unique()}`;
      await consumeRateLimit(db, limit, old, now);
      await consumeRateLimit(db, limit, recent, later(24 * 60 * 60 * 1000));
      await pruneRateLimits(db, later(24 * 60 * 60 * 1000 + 2000));
      const keys = (
        await pg
          .select({ key: publicRateLimits.key })
          .from(publicRateLimits)
          .where(like(publicRateLimits.key, `${limit.name}:%`))
      ).map((row) => row.key);
      expect(keys).toEqual([rateLimitKey(limit, recent)]);
    });
  });
});
