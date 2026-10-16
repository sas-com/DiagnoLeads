/**
 * Diagnosis builder data access (Refs #114)
 *
 * Every query is scoped by organizationId; a diagnosis of another organization is reported as
 * not found. Permission checks are done by the router.
 *
 * Lifecycle: draft → published ⇄ paused → archived. Each publish copies the checked draft into
 * an immutable diagnosis_versions row (version 1, 2, ...). A diagnosis that was ever published
 * is archived, not deleted (also enforced by a trigger, see drizzle/0012_diagnoses.sql).
 *
 * Staff actions other than draft saves (create, publish, pause, resume, archive, delete) write an
 * audit_logs row in the same transaction, so a failed action leaves no log.
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  type Diagnosis,
  type DiagnosisChangeSummary,
  type DiagnosisStatus,
  auditLogs,
  diagnoses,
  diagnosisVersions,
} from '@/lib/db/schema';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ne } from 'drizzle-orm';
import { DEFINITION_LIMITS, emptyDiagnosisDefinition } from './definition';
import type {
  CreateDiagnosisInput,
  PublishDiagnosisInput,
  SaveDiagnosisDraftInput,
} from './types/schemas';
import { validateDefinition } from './validate';
import { hashDefinition, summarizeDefinitionChanges } from './versions';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export const DIAGNOSIS_AUDIT_RESOURCE = 'diagnosis';

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'The diagnosis was not found' });

const conflict = () =>
  new TRPCError({
    code: 'CONFLICT',
    message: 'The diagnosis was changed by someone else. Reload it and try again.',
  });

const badRequest = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

const scope = (organizationId: string, id: string) =>
  and(eq(diagnoses.organizationId, organizationId), eq(diagnoses.id, id));

/** Always move updatedAt forward, even within the same millisecond */
const nextUpdatedAt = (now: Date, previous: Date) =>
  new Date(Math.max(now.getTime(), previous.getTime() + 1));

function isUniqueViolation(error: unknown): boolean {
  const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return (
    codeOf(error) === '23505' || codeOf((error as { cause?: unknown } | null)?.cause) === '23505'
  );
}

interface CurrentVersion {
  id: string;
  version: number;
  publishedAt: Date;
}

function toDiagnosisView(row: Diagnosis, currentVersion: CurrentVersion | null) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    draftDefinition: row.draftDefinition,
    currentVersion,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type DiagnosisView = ReturnType<typeof toDiagnosisView>;

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type DiagnosisAuditEvent = 'publish' | 'pause' | 'resume' | 'archive';

type DiagnosisAuditEntry =
  | { action: 'create'; diagnosisId: string; after: { name: string; slug: string } }
  | {
      action: 'update';
      diagnosisId: string;
      event: DiagnosisAuditEvent;
      before: { status: DiagnosisStatus; version?: number | null };
      after: { status: DiagnosisStatus; version?: number };
      metadata?: Record<string, unknown>;
    }
  | { action: 'delete'; diagnosisId: string; before: { name: string; slug: string } };

async function writeDiagnosisAuditLog(
  executor: Executor,
  context: { organizationId: string; userId: string; at: Date },
  entry: DiagnosisAuditEntry
) {
  await executor.insert(auditLogs).values({
    organizationId: context.organizationId,
    userId: context.userId,
    action: entry.action,
    resource: DIAGNOSIS_AUDIT_RESOURCE,
    resourceId: entry.diagnosisId,
    changes:
      entry.action === 'create'
        ? { after: entry.after }
        : entry.action === 'delete'
          ? { before: entry.before }
          : { before: entry.before, after: entry.after },
    metadata: entry.action === 'update' ? { event: entry.event, ...(entry.metadata ?? {}) } : null,
    createdAt: context.at,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listDiagnoses(db: Executor, input: { organizationId: string }) {
  return db
    .select({
      id: diagnoses.id,
      slug: diagnoses.slug,
      name: diagnoses.name,
      status: diagnoses.status,
      currentVersion: diagnosisVersions.version,
      publishedAt: diagnosisVersions.publishedAt,
      createdAt: diagnoses.createdAt,
      updatedAt: diagnoses.updatedAt,
    })
    .from(diagnoses)
    .leftJoin(diagnosisVersions, eq(diagnosisVersions.id, diagnoses.currentVersionId))
    .where(eq(diagnoses.organizationId, input.organizationId))
    .orderBy(desc(diagnoses.updatedAt));
}

async function findCurrentVersion(db: Executor, row: Diagnosis): Promise<CurrentVersion | null> {
  if (!row.currentVersionId) return null;
  const [version] = await db
    .select({
      id: diagnosisVersions.id,
      version: diagnosisVersions.version,
      publishedAt: diagnosisVersions.publishedAt,
    })
    .from(diagnosisVersions)
    .where(
      and(
        eq(diagnosisVersions.id, row.currentVersionId),
        eq(diagnosisVersions.organizationId, row.organizationId)
      )
    )
    .limit(1);
  return version ?? null;
}

export async function getDiagnosis(
  db: Executor,
  input: { organizationId: string; id: string }
): Promise<DiagnosisView> {
  const [row] = await db
    .select()
    .from(diagnoses)
    .where(scope(input.organizationId, input.id))
    .limit(1);
  if (!row) throw notFound();
  return toDiagnosisView(row, await findCurrentVersion(db, row));
}

/** The draft checked as publishing would check it (errors block publishing) */
export async function validateDiagnosisDraft(
  db: Executor,
  input: { organizationId: string; id: string }
) {
  const [row] = await db
    .select({ draftDefinition: diagnoses.draftDefinition })
    .from(diagnoses)
    .where(scope(input.organizationId, input.id))
    .limit(1);
  if (!row) throw notFound();
  const { errors, warnings } = validateDefinition(row.draftDefinition);
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createDiagnosis(
  db: Database,
  input: CreateDiagnosisInput & { userId: string },
  now: Date = new Date()
): Promise<DiagnosisView> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(diagnoses)
        .values({
          organizationId: input.organizationId,
          slug: input.slug,
          name: input.name,
          status: 'draft',
          draftDefinition: emptyDiagnosisDefinition(input.name),
          createdBy: input.userId,
          updatedBy: input.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await writeDiagnosisAuditLog(
        tx,
        { organizationId: input.organizationId, userId: input.userId, at: now },
        { action: 'create', diagnosisId: row.id, after: { name: row.name, slug: row.slug } }
      );
      return toDiagnosisView(row, null);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Another diagnosis of the organization already uses this URL name',
      });
    }
    throw error;
  }
}

/**
 * Replace the draft (and optionally the name). Fails with CONFLICT when the row changed after the
 * client read it (expectedUpdatedAt). The published version is not affected.
 */
export async function saveDiagnosisDraft(
  db: Executor,
  input: SaveDiagnosisDraftInput & { userId: string },
  now: Date = new Date()
): Promise<DiagnosisView> {
  const size = new TextEncoder().encode(JSON.stringify(input.definition)).length;
  if (size > DEFINITION_LIMITS.maxSerializedBytes) {
    throw badRequest('The diagnosis definition is too large');
  }
  const [row] = await db
    .update(diagnoses)
    .set({
      draftDefinition: input.definition,
      ...(input.name !== undefined ? { name: input.name } : {}),
      updatedBy: input.userId,
      updatedAt: nextUpdatedAt(now, input.expectedUpdatedAt),
    })
    .where(
      and(
        scope(input.organizationId, input.id),
        eq(diagnoses.updatedAt, input.expectedUpdatedAt),
        ne(diagnoses.status, 'archived')
      )
    )
    .returning();
  if (row) return toDiagnosisView(row, await findCurrentVersion(db, row));

  const [existing] = await db
    .select({ status: diagnoses.status })
    .from(diagnoses)
    .where(scope(input.organizationId, input.id))
    .limit(1);
  if (!existing) throw notFound();
  if (existing.status === 'archived') throw badRequest('An archived diagnosis cannot be edited');
  throw conflict();
}

/** Lock the diagnosis row for the rest of the transaction (serializes publish and state changes) */
async function lockDiagnosis(tx: Transaction, organizationId: string, id: string) {
  const [row] = await tx.select().from(diagnoses).where(scope(organizationId, id)).for('update');
  if (!row) throw notFound();
  return row;
}

/**
 * Publish the draft as the next version. The server checks the draft again and refuses when it
 * has errors. The row lock makes concurrent publishes take distinct version numbers (the unique
 * index on (diagnosis_id, version) is the last line of defence).
 */
export async function publishDiagnosis(
  db: Database,
  input: Omit<PublishDiagnosisInput, 'expectedUpdatedAt'> & {
    expectedUpdatedAt?: Date;
    userId: string;
  },
  now: Date = new Date()
) {
  return db.transaction(async (tx) => {
    const row = await lockDiagnosis(tx, input.organizationId, input.id);
    if (row.status === 'archived') throw badRequest('An archived diagnosis cannot be published');
    if (input.expectedUpdatedAt && row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw conflict();
    }

    const validation = validateDefinition(row.draftDefinition);
    if (validation.errors.length > 0 || !validation.definition) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `The diagnosis has ${validation.errors.length} error(s) and cannot be published`,
      });
    }
    const definition = validation.definition;
    const definitionHash = hashDefinition(definition);

    const [previous] = await tx
      .select({
        id: diagnosisVersions.id,
        version: diagnosisVersions.version,
        definition: diagnosisVersions.definition,
        definitionHash: diagnosisVersions.definitionHash,
      })
      .from(diagnosisVersions)
      .where(
        and(
          eq(diagnosisVersions.diagnosisId, row.id),
          eq(diagnosisVersions.organizationId, input.organizationId)
        )
      )
      .orderBy(desc(diagnosisVersions.version))
      .limit(1);
    if (previous && previous.definitionHash === definitionHash) {
      throw badRequest(`Nothing changed since version ${previous.version}`);
    }

    const version = (previous?.version ?? 0) + 1;
    const changeSummary: DiagnosisChangeSummary = summarizeDefinitionChanges(
      previous ?? null,
      definition,
      input.note
    );
    const [created] = await tx
      .insert(diagnosisVersions)
      .values({
        diagnosisId: row.id,
        organizationId: input.organizationId,
        version,
        definition,
        definitionHash,
        changeSummary,
        publishedBy: input.userId,
        publishedAt: now,
      })
      .returning({
        id: diagnosisVersions.id,
        version: diagnosisVersions.version,
        publishedAt: diagnosisVersions.publishedAt,
      });

    const [updated] = await tx
      .update(diagnoses)
      .set({
        currentVersionId: created.id,
        status: 'published',
        updatedBy: input.userId,
        updatedAt: nextUpdatedAt(now, row.updatedAt),
      })
      .where(scope(input.organizationId, row.id))
      .returning();

    await writeDiagnosisAuditLog(
      tx,
      { organizationId: input.organizationId, userId: input.userId, at: now },
      {
        action: 'update',
        diagnosisId: row.id,
        event: 'publish',
        before: { status: row.status, version: previous?.version ?? null },
        after: { status: 'published', version },
        metadata: { versionId: created.id, changeSummary },
      }
    );

    return {
      diagnosis: toDiagnosisView(updated, created),
      version: { ...created, definitionHash, changeSummary },
      warnings: validation.warnings,
    };
  });
}

const TRANSITIONS: Record<
  Exclude<DiagnosisAuditEvent, 'publish'>,
  { from: readonly DiagnosisStatus[]; to: DiagnosisStatus }
> = {
  pause: { from: ['published'], to: 'paused' },
  resume: { from: ['paused'], to: 'published' },
  archive: { from: ['draft', 'published', 'paused'], to: 'archived' },
};

/** Pause, resume or archive. The diagnosis must be in a state the change starts from. */
export async function changeDiagnosisStatus(
  db: Database,
  input: {
    organizationId: string;
    id: string;
    userId: string;
    event: keyof typeof TRANSITIONS;
  },
  now: Date = new Date()
): Promise<DiagnosisView> {
  const transition = TRANSITIONS[input.event];
  return db.transaction(async (tx) => {
    const row = await lockDiagnosis(tx, input.organizationId, input.id);
    if (!transition.from.includes(row.status)) {
      throw badRequest(`A ${row.status} diagnosis cannot be changed with ${input.event}`);
    }
    if (transition.to === 'published' && !row.currentVersionId) {
      throw badRequest('The diagnosis has no published version');
    }
    const [updated] = await tx
      .update(diagnoses)
      .set({
        status: transition.to,
        updatedBy: input.userId,
        updatedAt: nextUpdatedAt(now, row.updatedAt),
      })
      .where(scope(input.organizationId, row.id))
      .returning();
    await writeDiagnosisAuditLog(
      tx,
      { organizationId: input.organizationId, userId: input.userId, at: now },
      {
        action: 'update',
        diagnosisId: row.id,
        event: input.event,
        before: { status: row.status },
        after: { status: transition.to },
      }
    );
    return toDiagnosisView(updated, await findCurrentVersion(tx, updated));
  });
}

/** Delete a diagnosis that was never published (otherwise it must be archived) */
export async function deleteDiagnosis(
  db: Database,
  input: { organizationId: string; id: string; userId: string },
  now: Date = new Date()
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const row = await lockDiagnosis(tx, input.organizationId, input.id);
    const [anyVersion] = await tx
      .select({ id: diagnosisVersions.id })
      .from(diagnosisVersions)
      .where(eq(diagnosisVersions.diagnosisId, row.id))
      .limit(1);
    if (row.currentVersionId || anyVersion) {
      throw badRequest('A published diagnosis cannot be deleted; archive it instead');
    }
    await tx.delete(diagnoses).where(scope(input.organizationId, row.id));
    await writeDiagnosisAuditLog(
      tx,
      { organizationId: input.organizationId, userId: input.userId, at: now },
      { action: 'delete', diagnosisId: row.id, before: { name: row.name, slug: row.slug } }
    );
    return { id: row.id };
  });
}
