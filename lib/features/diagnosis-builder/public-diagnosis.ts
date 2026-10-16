/**
 * Published diagnoses as respondents reach them: /d/[slug] (Refs #116)
 *
 * The organization comes from the diagnosis row (never from env or the request). Only a
 * diagnosis in the `published` state with a current version is public; a paused, archived or
 * draft one is not found.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { diagnoses, diagnosisVersions } from '@/lib/db/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { DiagnosisDefinition } from './definition';
import { diagnosisSlugSchema } from './types/schemas';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

/**
 * A respondent who started on the previous version may still send it for this long after the
 * new version was published (owner decision 6 in the builder plan). Later they start again.
 */
export const VERSION_GRACE_MS = 24 * 60 * 60 * 1000;

export interface PublicDiagnosisVersion {
  id: string;
  version: number;
  definition: DiagnosisDefinition;
  publishedAt: Date;
}

export interface PublicDiagnosis {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  current: PublicDiagnosisVersion;
}

/** Key of the builder's submissions in diagnostic_submissions.diagnostic_key */
export const diagnosisSubmissionKey = (diagnosisId: string) => `d:${diagnosisId}`;
export const DIAGNOSIS_SUBMISSION_KEY_PREFIX = 'd:';

/**
 * The published diagnosis with this slug and its current version, or null.
 * Slugs are unique within an organization only: when two organizations publish the same slug,
 * the public URL cannot tell them apart, so neither is served (and the clash is logged).
 */
export async function findPublicDiagnosis(
  db: Executor,
  slug: string
): Promise<PublicDiagnosis | null> {
  if (!diagnosisSlugSchema.safeParse(slug).success) return null;
  const rows = await db
    .select({
      id: diagnoses.id,
      organizationId: diagnoses.organizationId,
      slug: diagnoses.slug,
      name: diagnoses.name,
      versionId: diagnosisVersions.id,
      version: diagnosisVersions.version,
      definition: diagnosisVersions.definition,
      publishedAt: diagnosisVersions.publishedAt,
    })
    .from(diagnoses)
    .innerJoin(
      diagnosisVersions,
      and(
        eq(diagnosisVersions.id, diagnoses.currentVersionId),
        eq(diagnosisVersions.organizationId, diagnoses.organizationId)
      )
    )
    .where(
      and(
        eq(diagnoses.slug, slug),
        eq(diagnoses.status, 'published'),
        isNotNull(diagnoses.currentVersionId)
      )
    )
    .limit(2);
  if (rows.length !== 1) {
    if (rows.length > 1) {
      console.error(`Diagnosis: slug "${slug}" is published by more than one organization`);
    }
    return null;
  }
  const [row] = rows;
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    current: {
      id: row.versionId,
      version: row.version,
      definition: row.definition,
      publishedAt: row.publishedAt,
    },
  };
}

export type SubmittedVersionResult =
  | { ok: true; diagnosis: PublicDiagnosis; version: PublicDiagnosisVersion }
  | { ok: false; reason: 'not_found' }
  /** Not the current version, nor one replaced within VERSION_GRACE_MS: start again */
  | { ok: false; reason: 'outdated' };

/**
 * The version a respondent answered: the current one, or the one before it while the
 * replacement is younger than VERSION_GRACE_MS. Any other version id is outdated.
 */
export async function resolveSubmittedVersion(
  db: Executor,
  slug: string,
  versionId: string,
  now: Date = new Date()
): Promise<SubmittedVersionResult> {
  const diagnosis = await findPublicDiagnosis(db, slug);
  if (!diagnosis) return { ok: false, reason: 'not_found' };
  if (diagnosis.current.id === versionId) {
    return { ok: true, diagnosis, version: diagnosis.current };
  }

  const [answered] = await db
    .select({
      id: diagnosisVersions.id,
      version: diagnosisVersions.version,
      definition: diagnosisVersions.definition,
      publishedAt: diagnosisVersions.publishedAt,
    })
    .from(diagnosisVersions)
    .where(
      and(
        eq(diagnosisVersions.id, versionId),
        eq(diagnosisVersions.diagnosisId, diagnosis.id),
        eq(diagnosisVersions.organizationId, diagnosis.organizationId)
      )
    )
    .limit(1);
  if (!answered || answered.version >= diagnosis.current.version) {
    return { ok: false, reason: 'outdated' };
  }

  // Replaced when the next version was published
  const [replacement] = await db
    .select({ publishedAt: diagnosisVersions.publishedAt })
    .from(diagnosisVersions)
    .where(
      and(
        eq(diagnosisVersions.diagnosisId, diagnosis.id),
        eq(diagnosisVersions.version, answered.version + 1)
      )
    )
    .limit(1);
  if (!replacement || now.getTime() - replacement.publishedAt.getTime() > VERSION_GRACE_MS) {
    return { ok: false, reason: 'outdated' };
  }
  return { ok: true, diagnosis, version: answered };
}
