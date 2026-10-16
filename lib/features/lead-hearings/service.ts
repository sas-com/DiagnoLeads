/**
 * Lead hearing data access (Refs #84)
 *
 * Every query is scoped by organizationId. The lead (and a chosen diagnosis submission) must
 * belong to the same organization; a hearing of another organization is reported as not found.
 * Permission checks are done by the router.
 */

import type { db as defaultDb } from '@/lib/db/client';
import { diagnosticSubmissions, leadHearings, leads } from '@/lib/db/schema';
import { AX_MIGRATION_DIAGNOSTIC_KEY } from '@/lib/features/diagnostics/ax-migration/definition';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq } from 'drizzle-orm';
import { HEARING_CATALOG_VERSION, LEAD_HEARINGS_MAX_PER_LEAD } from './catalog';
import { computeMissingItems } from './missing';
import { buildHearingPrefill, isVerifiedSubmission } from './prefill';
import {
  type CreateLeadHearingInput,
  type HearingFields,
  type HearingPrefillSnapshot,
  type UpdateLeadHearingInput,
  parseStoredHearingFields,
} from './types/schemas';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

/** Diagnosis submissions offered as prefill sources */
const PREFILL_SOURCES_LIMIT = 20;

const notFound = (what: 'lead' | 'hearing' | 'submission') =>
  new TRPCError({ code: 'NOT_FOUND', message: `The ${what} was not found` });

const leadScope = (organizationId: string, leadId: string) =>
  and(eq(leadHearings.organizationId, organizationId), eq(leadHearings.leadId, leadId));

const hearingScope = (organizationId: string, id: string) =>
  and(eq(leadHearings.organizationId, organizationId), eq(leadHearings.id, id));

async function assertLeadInOrganization(db: Executor, organizationId: string, leadId: string) {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  if (!lead) throw notFound('lead');
}

type HearingRow = typeof leadHearings.$inferSelect;

function toHearingView(row: HearingRow) {
  const { fields, droppedKeys } = parseStoredHearingFields(row.fields);
  return {
    id: row.id,
    leadId: row.leadId,
    heldOn: row.heldOn,
    catalogVersion: row.catalogVersion,
    fields,
    /** Stored keys the current catalog no longer accepts; the next save drops them */
    droppedKeys,
    prefill: row.prefill ?? null,
    missing: computeMissingItems(fields),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type LeadHearingView = ReturnType<typeof toHearingView>;

export async function listLeadHearings(
  db: Executor,
  input: { organizationId: string; leadId: string }
) {
  await assertLeadInOrganization(db, input.organizationId, input.leadId);
  const rows = await db
    .select()
    .from(leadHearings)
    .where(leadScope(input.organizationId, input.leadId))
    .orderBy(desc(leadHearings.heldOn), desc(leadHearings.createdAt));
  return rows.map((row) => {
    const { missing, droppedKeys, ...view } = toHearingView(row);
    return {
      id: view.id,
      heldOn: view.heldOn,
      createdBy: view.createdBy,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      fromDiagnosis: view.prefill !== null,
      missingCount: missing.missing.length,
      unconfirmedCount: missing.unconfirmed.length,
    };
  });
}

export async function getLeadHearing(db: Executor, input: { organizationId: string; id: string }) {
  const [row] = await db
    .select()
    .from(leadHearings)
    .where(hearingScope(input.organizationId, input.id))
    .limit(1);
  if (!row) throw notFound('hearing');
  return toHearingView(row);
}

/** The lead's AX diagnosis submissions, newest first */
export async function listPrefillSources(
  db: Executor,
  input: { organizationId: string; leadId: string }
) {
  await assertLeadInOrganization(db, input.organizationId, input.leadId);
  const rows = await db
    .select({
      id: diagnosticSubmissions.id,
      diagnosticVersion: diagnosticSubmissions.diagnosticVersion,
      answers: diagnosticSubmissions.answers,
      leadCreated: diagnosticSubmissions.leadCreated,
      continuedFromSubmissionId: diagnosticSubmissions.continuedFromSubmissionId,
      createdAt: diagnosticSubmissions.createdAt,
    })
    .from(diagnosticSubmissions)
    .where(
      and(
        eq(diagnosticSubmissions.organizationId, input.organizationId),
        eq(diagnosticSubmissions.leadId, input.leadId),
        eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY)
      )
    )
    .orderBy(desc(diagnosticSubmissions.createdAt))
    .limit(PREFILL_SOURCES_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    submittedAt: row.createdAt,
    diagnosticVersion: row.diagnosticVersion,
    platform: typeof row.answers.platform === 'string' ? row.answers.platform : null,
    verified: isVerifiedSubmission(row),
  }));
}

async function findPrefillSubmission(
  db: Executor,
  organizationId: string,
  leadId: string,
  submissionId: string | undefined
) {
  const [submission] = await db
    .select()
    .from(diagnosticSubmissions)
    .where(
      and(
        eq(diagnosticSubmissions.organizationId, organizationId),
        eq(diagnosticSubmissions.leadId, leadId),
        eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY),
        submissionId ? eq(diagnosticSubmissions.id, submissionId) : undefined
      )
    )
    .orderBy(desc(diagnosticSubmissions.createdAt))
    .limit(1);
  if (submissionId && !submission) throw notFound('submission');
  return submission;
}

/**
 * Create a hearing. The first one of a lead starts from the diagnosis (the given submission or
 * the newest); later ones copy the latest hearing unless carryOver is false.
 */
export async function createLeadHearing(
  db: Database,
  input: CreateLeadHearingInput & { userId: string },
  options: { maxPerLead?: number; now?: Date } = {}
): Promise<LeadHearingView> {
  const maxPerLead = options.maxPerLead ?? LEAD_HEARINGS_MAX_PER_LEAD;
  const now = options.now ?? new Date();
  const { organizationId, leadId } = input;

  return db.transaction(async (tx) => {
    // Locks the lead so concurrent creates cannot pass the limit together
    const [lead] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
      .for('no key update');
    if (!lead) throw notFound('lead');

    const [{ total }] = await tx
      .select({ total: count() })
      .from(leadHearings)
      .where(leadScope(organizationId, leadId));
    if (total >= maxPerLead) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `A lead can have at most ${maxPerLead} hearings`,
      });
    }

    const [latest] =
      total > 0
        ? await tx
            .select()
            .from(leadHearings)
            .where(leadScope(organizationId, leadId))
            .orderBy(desc(leadHearings.heldOn), desc(leadHearings.createdAt))
            .limit(1)
        : [];
    const carryOver = latest !== undefined && (input.carryOver ?? true);
    if (carryOver && input.submissionId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Choose either carrying over the latest hearing or a diagnosis submission',
      });
    }

    let fields: HearingFields = {};
    let prefill: HearingPrefillSnapshot | null = null;
    if (carryOver) {
      fields = parseStoredHearingFields(latest.fields).fields;
      prefill = latest.prefill ?? null;
    } else {
      const submission = await findPrefillSubmission(
        tx,
        organizationId,
        leadId,
        input.submissionId
      );
      if (submission) {
        const built = buildHearingPrefill(submission);
        fields = built.fields;
        prefill = built.snapshot;
      }
    }

    const [row] = await tx
      .insert(leadHearings)
      .values({
        organizationId,
        leadId,
        heldOn: input.heldOn,
        catalogVersion: HEARING_CATALOG_VERSION,
        fields,
        prefill,
        createdBy: input.userId,
        updatedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toHearingView(row);
  });
}

/**
 * Replace a hearing's date and fields. Fails with CONFLICT when the row changed after the
 * client read it (expectedUpdatedAt).
 */
export async function updateLeadHearing(
  db: Executor,
  input: UpdateLeadHearingInput & { userId: string },
  now: Date = new Date()
): Promise<LeadHearingView> {
  // Always move updatedAt forward, even within the same millisecond
  const updatedAt = new Date(Math.max(now.getTime(), input.expectedUpdatedAt.getTime() + 1));
  const [row] = await db
    .update(leadHearings)
    .set({
      heldOn: input.heldOn,
      catalogVersion: HEARING_CATALOG_VERSION,
      fields: input.fields,
      updatedBy: input.userId,
      updatedAt,
    })
    .where(
      and(
        hearingScope(input.organizationId, input.id),
        eq(leadHearings.updatedAt, input.expectedUpdatedAt)
      )
    )
    .returning();
  if (row) return toHearingView(row);

  const [existing] = await db
    .select({ id: leadHearings.id })
    .from(leadHearings)
    .where(hearingScope(input.organizationId, input.id))
    .limit(1);
  if (!existing) throw notFound('hearing');
  throw new TRPCError({
    code: 'CONFLICT',
    message: 'The hearing was changed by someone else. Reload it and try again.',
  });
}

export async function deleteLeadHearing(
  db: Executor,
  input: { organizationId: string; id: string }
): Promise<{ id: string }> {
  const [row] = await db
    .delete(leadHearings)
    .where(hearingScope(input.organizationId, input.id))
    .returning({ id: leadHearings.id });
  if (!row) throw notFound('hearing');
  return row;
}
