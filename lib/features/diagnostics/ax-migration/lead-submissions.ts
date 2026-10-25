/**
 * The latest AX diagnosis answer of leads, read by other features (the act timing, the prep
 * card, the delivery reviews): the one query for it (#480), so they need not know the AX key or
 * how submissions are stored. Scoped by organizationId.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { diagnosticSubmissions } from '@/lib/db/schema';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { AX_MIGRATION_DIAGNOSTIC_KEY } from './definition';

type Database = typeof defaultDb;

export interface LatestAxSubmission {
  leadId: string;
  answers: Record<string, string | string[]>;
  /** The stored AxMigrationResult (older ones may lack later fields) */
  result: Record<string, unknown>;
  createdAt: Date;
}

/** The newest AX answer of each lead that has one (leads without one are left out) */
export async function latestAxSubmissions(
  db: Pick<Database, 'selectDistinctOn'>,
  organizationId: string,
  leadIds: string[]
): Promise<LatestAxSubmission[]> {
  if (leadIds.length === 0) return [];
  const rows = await db
    .selectDistinctOn([diagnosticSubmissions.leadId], {
      leadId: diagnosticSubmissions.leadId,
      answers: diagnosticSubmissions.answers,
      result: diagnosticSubmissions.result,
      createdAt: diagnosticSubmissions.createdAt,
    })
    .from(diagnosticSubmissions)
    .where(
      and(
        eq(diagnosticSubmissions.organizationId, organizationId),
        eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY),
        inArray(diagnosticSubmissions.leadId, leadIds)
      )
    )
    .orderBy(asc(diagnosticSubmissions.leadId), desc(diagnosticSubmissions.createdAt));
  return rows.flatMap((row) => (row.leadId ? [{ ...row, leadId: row.leadId }] : []));
}

/** The newest AX answer of one lead, or null (the same pick as latestAxSubmissions) */
export async function latestAxSubmission(
  db: Pick<Database, 'select'>,
  organizationId: string,
  leadId: string
): Promise<LatestAxSubmission | null> {
  const [row] = await db
    .select({
      answers: diagnosticSubmissions.answers,
      result: diagnosticSubmissions.result,
      createdAt: diagnosticSubmissions.createdAt,
    })
    .from(diagnosticSubmissions)
    .where(
      and(
        eq(diagnosticSubmissions.leadId, leadId),
        eq(diagnosticSubmissions.organizationId, organizationId),
        eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY)
      )
    )
    .orderBy(desc(diagnosticSubmissions.createdAt))
    .limit(1);
  return row ? { leadId, ...row } : null;
}
