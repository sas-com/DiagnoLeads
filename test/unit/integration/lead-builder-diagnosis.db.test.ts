/**
 * Builder diagnoses on the lead (#121) against a real PostgreSQL: hearing prefill from the
 * newest builder submission (questions mapped to hearing fields), the prefill sources, the
 * answers labelled from the answered version and the timeline summary.
 * Only a fictional diagnosis is used (the repository is public).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_builder121 \
 *     bunx vitest --run test/unit/integration/lead-builder-diagnosis.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  diagnosticSubmissions,
  leads,
  organizations,
  users,
} from '@/lib/db/schema';
import type { DiagnosisDefinition } from '@/lib/features/diagnosis-builder/definition';
import type { PublicDiagnosis } from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  type DiagnosisSubmissionInput,
  submitBuilderDiagnosis,
} from '@/lib/features/diagnosis-builder/submission-service';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import { getSubmissionAnswers, listLeadActivities } from '@/lib/features/lead-activity/service';
import { createLeadHearing, listPrefillSources } from '@/lib/features/lead-hearings/service';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('builder diagnosis on the lead (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof submitBuilderDiagnosis>[0];
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let organizationId: string;
  let userId: string;

  /** The fixture with two questions mapped to the hearing */
  function mappedDefinition(): DiagnosisDefinition {
    const def = cloudReadiness();
    for (const question of def.questions) {
      if (question.id === 'migration_plan') {
        question.hearingField = {
          key: 'directionTiming',
          values: { none: 'undecided', later: '1_2y', this_year: 'within_1y' },
        };
      }
      if (question.id === 'notes') question.hearingField = { key: 'challengeNotes' };
    }
    return def;
  }

  /** A published diagnosis with one version per definition (the last one is current) */
  async function publish(name: string, definitions: DiagnosisDefinition[]) {
    const slug = `cloud-${unique()}`;
    const [row] = await pg
      .insert(diagnoses)
      .values({
        organizationId,
        slug,
        name,
        status: 'published',
        draftDefinition: definitions[definitions.length - 1],
      })
      .returning({ id: diagnoses.id });
    const versions: PublicDiagnosis['current'][] = [];
    for (const [index, definition] of definitions.entries()) {
      const publishedAt = new Date(Date.UTC(2026, 9, 1 + index));
      const [version] = await pg
        .insert(diagnosisVersions)
        .values({
          diagnosisId: row.id,
          organizationId,
          version: index + 1,
          definition,
          definitionHash: hashDefinition(definition),
          changeSummary: {
            previousVersion: index === 0 ? null : index,
            questionsAdded: [],
            questionsRemoved: [],
            questionsChanged: [],
            partsChanged: [],
          },
          publishedAt,
        })
        .returning({ id: diagnosisVersions.id });
      versions.push({ id: version.id, version: index + 1, definition, publishedAt });
    }
    const current = versions[versions.length - 1];
    await pg.update(diagnoses).set({ currentVersionId: current.id }).where(eq(diagnoses.id, row.id));
    const diagnosis: PublicDiagnosis = { id: row.id, organizationId, slug, name, current };
    return { diagnosis, versions };
  }

  const input = (
    versionId: string,
    email: string,
    answers: Record<string, unknown>
  ): DiagnosisSubmissionInput => ({
    versionId,
    answers,
    contact: { company: '架空商事', name: '試験 太郎', email },
    privacyConsent: true,
    consentVersion: '2026-10-01',
    consultationRequested: false,
    tracking: {},
    locale: 'ja',
  });

  const answers = {
    hosting: 'onprem',
    team_size: 150,
    migration_plan: 'this_year',
    confidence: 4,
    notes: '担当者が退職予定',
  };

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '架空ビルダー株式会社', slug: `builder121-${unique()}` })
      .returning();
    organizationId = org.id;
    const [user] = await pg
      .insert(users)
      .values({ email: `builder121-${unique()}@example.com`, name: '営業 一郎' })
      .returning();
    userId = user.id;
  });

  afterAll(async () => {
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    if (userId) await pg.delete(users).where(eq(users.id, userId));
    await client?.end();
  });

  it('prefills the hearing from the newest builder submission with mappings', async () => {
    const { diagnosis, versions } = await publish('架空のクラウド準備度', [mappedDefinition()]);
    const email = `taro-${unique()}@example.co.jp`;
    const first = await submitBuilderDiagnosis(
      db,
      diagnosis,
      versions[0],
      input(versions[0].id, email, answers),
      new Date('2026-10-10T01:00:00Z')
    );
    if (!first.ok) throw new Error('submission failed');
    const leadId = first.leadId;

    // An older AX submission of the same lead, and a newer builder one without mappings
    await pg.insert(diagnosticSubmissions).values({
      organizationId,
      leadId,
      leadCreated: false,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 2,
      answers: { platform: 'as400', timeline: '2_3y' },
      result: {},
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    const plain = await publish('架空の対応なし診断', [cloudReadiness()]);
    const unmapped = await submitBuilderDiagnosis(
      db,
      plain.diagnosis,
      plain.versions[0],
      input(plain.versions[0].id, email, answers),
      new Date('2026-10-12T01:00:00Z')
    );
    if (!unmapped.ok) throw new Error('submission failed');

    const sources = await listPrefillSources(pg, { organizationId, leadId });
    expect(sources.map((s) => [s.id, s.diagnosisTitle, s.platform, s.verified])).toEqual([
      [first.submissionId, 'クラウド準備度チェック（テスト用）', null, true],
      [expect.any(String), null, 'as400', false],
    ]);

    const hearing = await createLeadHearing(pg, {
      organizationId,
      leadId,
      heldOn: '2026-10-16',
      userId,
    });
    expect(hearing.prefill).toMatchObject({
      submissionId: first.submissionId,
      diagnosticKey: `d:${diagnosis.id}`,
      diagnosticVersion: 1,
      verified: true,
      diagnosisTitle: 'クラウド準備度チェック（テスト用）',
      hints: { directionTiming: ['migration_plan'], challengeNotes: ['notes'] },
    });
    expect(hearing.fields).toEqual({
      directionTiming: { value: 'within_1y', status: 'not_yet', source: 'prefilled' },
      challengeNotes: { value: '担当者が退職予定', status: 'not_yet', source: 'prefilled' },
    });

    // The AX submission can still be chosen and is unchanged
    const fromAx = await createLeadHearing(pg, {
      organizationId,
      leadId,
      heldOn: '2026-10-17',
      submissionId: sources[1].id,
      carryOver: false,
      userId,
    });
    expect(fromAx.fields.targetSystem?.value).toBe('as400');
    expect(fromAx.fields.directionTiming?.value).toBe('2_3y');
    // A builder submission without mappings is no prefill source
    await expect(
      createLeadHearing(pg, {
        organizationId,
        leadId,
        heldOn: '2026-10-18',
        submissionId: unmapped.submissionId,
        carryOver: false,
        userId,
      })
    ).rejects.toThrow('The submission was not found');
  });

  it('marks a builder submission matched by email only as unverified', async () => {
    const { diagnosis, versions } = await publish('架空のクラウド準備度', [mappedDefinition()]);
    const email = `hanako-${unique()}@example.co.jp`;
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId, email, name: '山田 花子' })
      .returning({ id: leads.id });
    const matched = await submitBuilderDiagnosis(
      db,
      diagnosis,
      versions[0],
      input(versions[0].id, email, { ...answers, migration_plan: 'later' })
    );
    if (!matched.ok) throw new Error('submission failed');
    expect(matched.leadId).toBe(lead.id);

    const hearing = await createLeadHearing(pg, {
      organizationId,
      leadId: lead.id,
      heldOn: '2026-10-16',
      userId,
    });
    expect(hearing.prefill?.verified).toBe(false);
    expect(hearing.fields.directionTiming?.value).toBe('1_2y');
  });

  it('labels answers and the timeline from the version answered, not the newer one', async () => {
    const v1 = mappedDefinition();
    const v2 = mappedDefinition();
    v2.title = 'クラウド準備度チェック（改訂版）';
    v2.questions[0] = { ...v2.questions[0], label: '改訂後の設問文' };
    const { diagnosis, versions } = await publish('架空のクラウド準備度', [v1, v2]);
    const submitted = await submitBuilderDiagnosis(
      db,
      diagnosis,
      versions[0],
      input(versions[0].id, `jiro-${unique()}@example.co.jp`, answers)
    );
    if (!submitted.ok) throw new Error('submission failed');

    const view = await getSubmissionAnswers(pg, {
      organizationId,
      leadId: submitted.leadId,
      submissionId: submitted.submissionId,
    });
    expect(view.answers.slice(0, 2)).toEqual([
      {
        questionId: 'hosting',
        question: { ja: 'システムはどこで動いていますか', en: 'システムはどこで動いていますか' },
        detail: false,
        values: [{ value: 'onprem', label: { ja: '自社設備', en: '自社設備' } }],
      },
      {
        questionId: 'team_size',
        question: { ja: '担当者の人数', en: '担当者の人数' },
        detail: false,
        values: [{ value: '150', label: { ja: '150人', en: '150人' } }],
      },
    ]);
    expect(view.summary.builder).toEqual({
      title: 'クラウド準備度チェック（テスト用）',
      version: 1,
      resultTypeName: '計画型',
      leadScore: 70,
    });

    const page = await listLeadActivities(pg, {
      organizationId,
      leadId: submitted.leadId,
      types: ['diagnosis_submitted'],
      limit: 10,
    });
    const event = page.items[0];
    if (event.kind !== 'diagnosis_submitted') throw new Error('unexpected event');
    expect(event.summary).toMatchObject({
      mqlLevel: 'interest',
      builder: { title: 'クラウド準備度チェック（テスト用）', version: 1, resultTypeName: '計画型' },
    });
  });
});
