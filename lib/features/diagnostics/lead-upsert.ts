/**
 * Lead matching for public diagnosis submissions, shared by the AX diagnosis and the diagnoses
 * made in the builder.
 *
 * The public forms are unauthenticated, so an existing lead with the same email address is never
 * changed here: the caller only links the submission to it (and tells sales the identity is
 * unverified). Only when no lead matches is one created, with the values the caller gives.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { type Lead, type NewLead, leads } from '@/lib/db/schema';
import { type SQL, and, asc, eq, sql } from 'drizzle-orm';

type Database = typeof defaultDb;
export type SubmissionTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Values of a lead created by a submission (organization, email and dates are set here) */
export type NewSubmissionLead = Omit<
  NewLead,
  'id' | 'organizationId' | 'email' | 'createdAt' | 'updatedAt'
>;

export interface UpsertLeadFromSubmissionInput {
  organizationId: string;
  /** Compared case-insensitively; a created lead stores it in lower case */
  email: string;
  /** Used only when no lead of the organization has this email address */
  newLead: NewSubmissionLead;
  now: Date;
}

export interface UpsertLeadFromSubmissionResult {
  leadId: string;
  /** The matching lead as stored before this submission (undefined when one was created) */
  existing: Lead | undefined;
}

/**
 * The organization's leads with the email address, compared in lower case: the shape the index
 * leads_org_email_lower_idx serves (#433, checked in test/unit/integration/admin-indexes.db.test.ts)
 */
export function leadEmailMatch(organizationId: string, normalizedEmail: string): SQL | undefined {
  return and(
    eq(leads.organizationId, organizationId),
    sql`lower(${leads.email}) = ${normalizedEmail}`
  );
}

/**
 * Find the organization's lead for the email address, or create it. Must run inside the
 * transaction that also stores the submission: a transaction-scoped advisory lock on
 * (organization, email) serializes concurrent submissions for the same address, so a double
 * submit cannot create two leads. The oldest lead wins when several share the address.
 */
export async function upsertLeadFromSubmission(
  tx: SubmissionTransaction,
  { organizationId, email, newLead, now }: UpsertLeadFromSubmissionInput
): Promise<UpsertLeadFromSubmissionResult> {
  const normalized = email.toLowerCase();
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${normalized}`}, 0))`
  );

  const existing: Lead | undefined = await tx.query.leads.findFirst({
    where: leadEmailMatch(organizationId, normalized),
    orderBy: [asc(leads.createdAt)],
  });
  if (existing) return { leadId: existing.id, existing };

  const [created] = await tx
    .insert(leads)
    .values({
      ...newLead,
      organizationId,
      email: normalized,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: leads.id });
  return { leadId: created.id, existing: undefined };
}
