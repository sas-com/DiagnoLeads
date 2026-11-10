/**
 * utm_medium values that name a member of Object.prototype (#804) against PostgreSQL. The visitor
 * writes utm_medium in the address of the diagnosis, and inferInflowSource used to find
 * `constructor` and `__proto__` in its plain-object table: `constructor` put
 * "function Object() { [native code] }" in the lead's inflow_source, and `__proto__` failed the
 * save of the answer. Both diagnoses (the AX diagnosis and a builder diagnosis, /d/<slug>) share
 * the lookup (resolveInflow): the answer is saved and the new lead's inflow source stays empty,
 * as for any other medium the table does not know, while the media it knows still map.
 * Only fictional names are used (the repository is public).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/diagnostics-inflow-own-keys.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  diagnosticSubmissions,
  leads,
  organizations,
} from '@/lib/db/schema';
import { resolveSubmittedVersion } from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  diagnosisSubmissionSchema,
  submitBuilderDiagnosis,
} from '@/lib/features/diagnosis-builder/submission-service';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import {
  axMigrationSubmissionSchema,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('utm_medium naming an Object.prototype member (PostgreSQL, #804)', () => {
  const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof submitAxMigrationDiagnosis>[0];
  const now = new Date('2026-11-08T01:00:00Z');
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let organizationId: string;
  let slug: string;
  let versionId: string;

  const email = () => `Inflow-${unique()}@Example.co.jp`;

  /** Answer the AX diagnosis as its route does (the request body through the route's schema) */
  async function answerAx(utmMedium: string) {
    const input = axMigrationSubmissionSchema.parse({
      answers: as400Answers,
      contact: { company: '架空製作所', name: '試験 太郎', email: email() },
      privacyConsent: true,
      tracking: { utmSource: 'newsletter', utmMedium },
      locale: 'ja',
    });
    return submitAxMigrationDiagnosis(db, organizationId, input, now);
  }

  /** Answer the builder diagnosis (/d/<slug>) as its route does */
  async function answerBuilder(utmMedium: string) {
    const resolved = await resolveSubmittedVersion(db, slug, versionId, now);
    if (!resolved.ok) throw new Error(`version not accepted: ${resolved.reason}`);
    const input = diagnosisSubmissionSchema.parse({
      versionId,
      answers: { hosting: 'onprem', team_size: 150, migration_plan: 'this_year', confidence: 4 },
      contact: { company: '架空商事', name: '試験 花子', email: email() },
      privacyConsent: true,
      consentVersion: '2026-10-01',
      tracking: { utmSource: 'newsletter', utmMedium },
      locale: 'ja',
    });
    return submitBuilderDiagnosis(db, resolved.diagnosis, resolved.version, input, now);
  }

  const answer = { ax: answerAx, builder: answerBuilder } as const;

  /** The new lead's inflow source and the tracking stored with the answer */
  async function saved(leadId: string, submissionId: string) {
    const [lead] = await pg
      .select({
        inflowSource: leads.inflowSource,
        referrerName: leads.referrerName,
        agencyName: leads.agencyName,
      })
      .from(leads)
      .where(eq(leads.id, leadId));
    const [submission] = await pg
      .select({ leadId: diagnosticSubmissions.leadId, tracking: diagnosticSubmissions.tracking })
      .from(diagnosticSubmissions)
      .where(eq(diagnosticSubmissions.id, submissionId));
    return { lead, submission };
  }

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '流入元の表のキー', slug: `inflow-own-keys-${unique()}` })
      .returning({ id: organizations.id });
    organizationId = org.id;

    // A published builder diagnosis of the organization, as /d/<slug> serves it
    const definition = cloudReadiness();
    slug = `inflow-keys-${Math.random().toString(36).slice(2, 8)}`;
    const [row] = await pg
      .insert(diagnoses)
      .values({
        organizationId,
        slug,
        name: '架空の診断',
        status: 'published',
        draftDefinition: definition,
      })
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
        publishedAt: new Date(now.getTime() - 60 * 60 * 1000),
      })
      .returning({ id: diagnosisVersions.id });
    versionId = version.id;
    await pg.update(diagnoses).set({ currentVersionId: versionId }).where(eq(diagnoses.id, row.id));
  });

  afterAll(async () => {
    if (organizationId) {
      await pg.delete(organizations).where(eq(organizations.id, organizationId));
    }
    await client?.end();
  });

  describe.each(['ax', 'builder'] as const)('the %s diagnosis', (kind) => {
    it.each(['constructor', '__proto__', 'Constructor'])(
      'saves the answer with utm_medium=%s and leaves the new lead without an inflow source',
      async (utmMedium) => {
        const outcome = await answer[kind](utmMedium);
        if (!outcome.ok) throw new Error('submission rejected');
        expect(outcome.leadCreated).toBe(true);

        const { lead, submission } = await saved(outcome.leadId, outcome.submissionId);
        expect(lead).toEqual({ inflowSource: null, referrerName: null, agencyName: null });
        // The answer is stored with the medium as sent, for sales to see
        expect(submission).toEqual({
          leadId: outcome.leadId,
          tracking: { utmSource: 'newsletter', utmMedium },
        });
      }
    );

    it.each([
      ['cpc', 'advertising'],
      ['seminar', 'seminar'],
    ])('still maps utm_medium=%s to %s', async (utmMedium, inflowSource) => {
      const outcome = await answer[kind](utmMedium);
      if (!outcome.ok) throw new Error('submission rejected');
      expect(outcome.leadCreated).toBe(true);
      const { lead } = await saved(outcome.leadId, outcome.submissionId);
      expect(lead.inflowSource).toBe(inflowSource);
    });
  });
});
