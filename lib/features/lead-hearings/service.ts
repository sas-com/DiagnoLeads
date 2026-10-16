/**
 * Lead hearing data access (Refs #84)
 *
 * Every query is scoped by organizationId. The lead (and a chosen diagnosis submission) must
 * belong to the same organization; a hearing of another organization is reported as not found.
 * Permission checks are done by the router.
 */

import type { db as defaultDb } from '@/lib/db/client';
import { diagnosisVersions, diagnosticSubmissions, leadHearings, leads } from '@/lib/db/schema';
import { DIAGNOSIS_SUBMISSION_KEY_PREFIX } from '@/lib/features/diagnosis-builder/public-diagnosis';
import { AX_MIGRATION_DIAGNOSTIC_KEY } from '@/lib/features/diagnostics/ax-migration/definition';
import { syncHearingNextAction } from '@/lib/features/lead-follow-up/service';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, like, lt, or, sql } from 'drizzle-orm';
import { HEARING_CATALOG_VERSION, LEAD_HEARINGS_MAX_PER_LEAD } from './catalog';
import { computeMissingItems } from './missing';
import { buildBuilderHearingPrefill, buildHearingPrefill, isVerifiedSubmission } from './prefill';
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
  // Only the columns the list shows; the diagnosis snapshot is reduced to whether there is one
  const rows = await db
    .select({
      id: leadHearings.id,
      heldOn: leadHearings.heldOn,
      fields: leadHearings.fields,
      fromDiagnosis: sql<boolean>`${leadHearings.prefill} is not null`,
      createdBy: leadHearings.createdBy,
      createdAt: leadHearings.createdAt,
      updatedAt: leadHearings.updatedAt,
    })
    .from(leadHearings)
    .where(leadScope(input.organizationId, input.leadId))
    .orderBy(desc(leadHearings.heldOn), desc(leadHearings.createdAt));
  return rows.map(({ fields: stored, ...row }) => {
    const { fields } = parseStoredHearingFields(stored);
    const missing = computeMissingItems(fields);
    const dealRating = fields.dealRating?.value;
    return {
      dealRating: typeof dealRating === 'string' ? dealRating : null,
      id: row.id,
      heldOn: row.heldOn,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      fromDiagnosis: row.fromDiagnosis,
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

/**
 * What the meeting summary (#97) reads: the hearing, the hearing of the same lead held just
 * before it (by heldOn, then createdAt) and the lead's name. Only the needed columns.
 */
export async function getLeadHearingSummarySource(
  db: Executor,
  input: { organizationId: string; id: string }
) {
  const [current] = await db
    .select({
      id: leadHearings.id,
      leadId: leadHearings.leadId,
      heldOn: leadHearings.heldOn,
      fields: leadHearings.fields,
      createdAt: leadHearings.createdAt,
    })
    .from(leadHearings)
    .where(hearingScope(input.organizationId, input.id))
    .limit(1);
  if (!current) throw notFound('hearing');

  const [previous] = await db
    .select({ id: leadHearings.id, heldOn: leadHearings.heldOn, fields: leadHearings.fields })
    .from(leadHearings)
    .where(
      and(
        leadScope(input.organizationId, current.leadId),
        or(
          lt(leadHearings.heldOn, current.heldOn),
          and(
            eq(leadHearings.heldOn, current.heldOn),
            lt(leadHearings.createdAt, current.createdAt)
          ),
          // Same date and creation time: the id decides, so exactly one is "previous"
          and(
            eq(leadHearings.heldOn, current.heldOn),
            eq(leadHearings.createdAt, current.createdAt),
            lt(leadHearings.id, current.id)
          )
        )
      )
    )
    .orderBy(desc(leadHearings.heldOn), desc(leadHearings.createdAt), desc(leadHearings.id))
    .limit(1);

  const [lead] = await db
    .select({ name: leads.name, company: leads.company })
    .from(leads)
    .where(and(eq(leads.id, current.leadId), eq(leads.organizationId, input.organizationId)))
    .limit(1);

  return {
    id: current.id,
    leadId: current.leadId,
    heldOn: current.heldOn,
    fields: parseStoredHearingFields(current.fields).fields,
    lead: lead ?? null,
    previous: previous
      ? {
          id: previous.id,
          heldOn: previous.heldOn,
          fields: parseStoredHearingFields(previous.fields).fields,
        }
      : null,
  };
}

/** The version a builder submission answered (same organization only) */
const submissionVersion = and(
  eq(diagnosisVersions.id, diagnosticSubmissions.diagnosisVersionId),
  eq(diagnosisVersions.organizationId, diagnosticSubmissions.organizationId)
);

/**
 * Submissions a hearing can start from: the AX diagnosis, and builder diagnoses whose answered
 * version maps at least one question to the hearing sheet (#121)
 */
const prefillSourceFilter = or(
  eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY),
  and(
    like(diagnosticSubmissions.diagnosticKey, `${DIAGNOSIS_SUBMISSION_KEY_PREFIX}%`),
    sql`exists (select 1 from jsonb_array_elements(${diagnosisVersions.definition}->'questions') as q where q->'hearingField' is not null)`
  )
);

/** The lead's diagnosis submissions a hearing can start from, newest first */
export async function listPrefillSources(
  db: Executor,
  input: { organizationId: string; leadId: string }
) {
  await assertLeadInOrganization(db, input.organizationId, input.leadId);
  const rows = await db
    .select({
      id: diagnosticSubmissions.id,
      diagnosticKey: diagnosticSubmissions.diagnosticKey,
      diagnosticVersion: diagnosticSubmissions.diagnosticVersion,
      answers: diagnosticSubmissions.answers,
      leadCreated: diagnosticSubmissions.leadCreated,
      continuedFromSubmissionId: diagnosticSubmissions.continuedFromSubmissionId,
      createdAt: diagnosticSubmissions.createdAt,
      diagnosisTitle: sql<string | null>`${diagnosisVersions.definition}->>'title'`,
    })
    .from(diagnosticSubmissions)
    .leftJoin(diagnosisVersions, submissionVersion)
    .where(
      and(
        eq(diagnosticSubmissions.organizationId, input.organizationId),
        eq(diagnosticSubmissions.leadId, input.leadId),
        prefillSourceFilter
      )
    )
    .orderBy(desc(diagnosticSubmissions.createdAt))
    .limit(PREFILL_SOURCES_LIMIT);
  return rows.map((row) => {
    const isAx = row.diagnosticKey === AX_MIGRATION_DIAGNOSTIC_KEY;
    return {
      id: row.id,
      submittedAt: row.createdAt,
      diagnosticVersion: row.diagnosticVersion,
      platform: isAx && typeof row.answers.platform === 'string' ? row.answers.platform : null,
      /** Builder diagnoses: the title of the answered version */
      diagnosisTitle: isAx ? null : row.diagnosisTitle,
      verified: isVerifiedSubmission(row),
    };
  });
}

async function findPrefillSubmission(
  db: Executor,
  organizationId: string,
  leadId: string,
  submissionId: string | undefined
) {
  const [submission] = await db
    .select({
      id: diagnosticSubmissions.id,
      diagnosticKey: diagnosticSubmissions.diagnosticKey,
      diagnosticVersion: diagnosticSubmissions.diagnosticVersion,
      answers: diagnosticSubmissions.answers,
      result: diagnosticSubmissions.result,
      leadCreated: diagnosticSubmissions.leadCreated,
      continuedFromSubmissionId: diagnosticSubmissions.continuedFromSubmissionId,
      createdAt: diagnosticSubmissions.createdAt,
      definition: diagnosisVersions.definition,
    })
    .from(diagnosticSubmissions)
    .leftJoin(diagnosisVersions, submissionVersion)
    .where(
      and(
        eq(diagnosticSubmissions.organizationId, organizationId),
        eq(diagnosticSubmissions.leadId, leadId),
        prefillSourceFilter,
        submissionId ? eq(diagnosticSubmissions.id, submissionId) : undefined
      )
    )
    .orderBy(desc(diagnosticSubmissions.createdAt))
    .limit(1);
  if (submissionId && !submission) throw notFound('submission');
  return submission;
}

/** The hearing values (and snapshot) a submission gives */
function prefillFrom(submission: NonNullable<Awaited<ReturnType<typeof findPrefillSubmission>>>) {
  if (submission.diagnosticKey === AX_MIGRATION_DIAGNOSTIC_KEY) {
    return buildHearingPrefill(submission);
  }
  // The filter only lets builder submissions with their version through
  if (!submission.definition) return null;
  return buildBuilderHearingPrefill({ ...submission, definition: submission.definition });
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
            .select({ fields: leadHearings.fields, prefill: leadHearings.prefill })
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
      const built = submission ? prefillFrom(submission) : null;
      if (built) {
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
    // A next meeting date copied from the previous hearing makes no second next action (#85)
    await syncHearingNextAction(tx, {
      organizationId,
      leadId,
      hearingId: row.id,
      fields,
      userId: input.userId,
      now,
    });
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
  const row = await db.transaction(async (tx) => {
    const [saved] = await tx
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
    // Saving a next meeting date keeps one next action at that date (#85)
    if (saved) {
      await syncHearingNextAction(tx, {
        organizationId: input.organizationId,
        leadId: saved.leadId,
        hearingId: saved.id,
        fields: input.fields,
        userId: input.userId,
        now: updatedAt,
      });
    }
    return saved;
  });
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
