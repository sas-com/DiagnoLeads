/**
 * Delivery review data access (Refs #159). Every query is scoped by organizationId; the router
 * checks permissions.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leadDeliveryReviews, leads, users } from '@/lib/db/schema';
import {
  latestAxSubmission,
  latestAxSubmissions,
} from '@/lib/features/diagnostics/ax-migration/lead-submissions';
import { and, eq, sql } from 'drizzle-orm';
import {
  DELIVERY_PHASES,
  type DiagnosisAccuracy,
  type PhaseProgress,
  diagnosisAccuracy,
  phaseProgress,
} from './report';
import {
  DIFFICULTY_LEVELS,
  type DeliveryReviewFields,
  type DifficultyLevel,
} from './types/schemas';

type Database = typeof defaultDb;

export interface LeadDiagnosisSummary {
  checkpoints: string[];
  difficulty: DifficultyLevel | null;
}

export interface DeliveryReviewView extends DeliveryReviewFields {
  updatedAt: Date;
  updatedByName: string | null;
}

/** Checkpoints and difficulty level of a stored AX diagnosis result */
export function readDiagnosisSummary(result: unknown): LeadDiagnosisSummary {
  const value = (result ?? {}) as { checkpoints?: unknown; difficulty?: { level?: unknown } };
  const level = value.difficulty?.level;
  return {
    checkpoints: Array.isArray(value.checkpoints)
      ? value.checkpoints.filter((key): key is string => typeof key === 'string')
      : [],
    difficulty: (DIFFICULTY_LEVELS as readonly unknown[]).includes(level)
      ? (level as DifficultyLevel)
      : null,
  };
}

/**
 * The lead's review (null when none was saved) and its latest AX diagnosis; undefined when the
 * lead is not found
 */
export async function getDeliveryReview(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<
  { review: DeliveryReviewView | null; diagnosis: LeadDiagnosisSummary | null } | undefined
> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  if (!lead) return undefined;
  const [[row], submission] = await Promise.all([
    db
      .select({
        checkpointOutcomes: leadDeliveryReviews.checkpointOutcomes,
        actualDifficulty: leadDeliveryReviews.actualDifficulty,
        estimatedEffort: leadDeliveryReviews.estimatedEffort,
        actualEffort: leadDeliveryReviews.actualEffort,
        note: leadDeliveryReviews.note,
        updatedAt: leadDeliveryReviews.updatedAt,
        updatedByName: sql<
          string | null
        >`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
      })
      .from(leadDeliveryReviews)
      .leftJoin(users, eq(users.id, leadDeliveryReviews.updatedBy))
      .where(
        and(
          eq(leadDeliveryReviews.leadId, input.leadId),
          eq(leadDeliveryReviews.organizationId, input.organizationId)
        )
      ),
    latestAxSubmission(db, input.organizationId, input.leadId),
  ]);
  return {
    review: row
      ? {
          ...row,
          checkpointOutcomes: row.checkpointOutcomes as DeliveryReviewFields['checkpointOutcomes'],
          actualDifficulty: (DIFFICULTY_LEVELS as readonly unknown[]).includes(row.actualDifficulty)
            ? (row.actualDifficulty as DifficultyLevel)
            : null,
        }
      : null,
    diagnosis: submission ? readDiagnosisSummary(submission.result) : null,
  };
}

/** Save the review (created on the first save); false when the lead is not found */
export async function saveDeliveryReview(
  db: Database,
  input: { organizationId: string; leadId: string; userId: string; review: DeliveryReviewFields },
  now: Date = new Date()
): Promise<boolean> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  if (!lead) return false;
  const values = { ...input.review, updatedBy: input.userId, updatedAt: now };
  await db
    .insert(leadDeliveryReviews)
    .values({
      ...values,
      organizationId: input.organizationId,
      leadId: input.leadId,
      createdBy: input.userId,
      createdAt: now,
    })
    .onConflictDoUpdate({ target: leadDeliveryReviews.leadId, set: values });
  return true;
}

export interface DeliveryReport {
  progress: PhaseProgress;
  accuracy: DiagnosisAccuracy;
}

/** Phase progress of the organization's deals and the diagnosis next to the reviews */
export async function getDeliveryReport(
  db: Database,
  organizationId: string
): Promise<DeliveryReport> {
  const [phaseRows, reviews] = await Promise.all([
    db
      .select({ dealPhaseReachedAt: leads.dealPhaseReachedAt })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, organizationId),
          sql`${leads.dealPhaseReachedAt} ?| array[${sql.join(
            DELIVERY_PHASES.map((phase) => sql`${phase}`),
            sql`, `
          )}]::text[]`
        )
      ),
    db
      .select({
        leadId: leadDeliveryReviews.leadId,
        checkpointOutcomes: leadDeliveryReviews.checkpointOutcomes,
        actualDifficulty: leadDeliveryReviews.actualDifficulty,
        estimatedEffort: leadDeliveryReviews.estimatedEffort,
        actualEffort: leadDeliveryReviews.actualEffort,
      })
      .from(leadDeliveryReviews)
      .where(eq(leadDeliveryReviews.organizationId, organizationId)),
  ]);
  const submissions =
    reviews.length === 0
      ? []
      : await latestAxSubmissions(
          db,
          organizationId,
          reviews.map((review) => review.leadId)
        );
  const diagnosisByLead = new Map(
    submissions.flatMap((row) =>
      row.leadId ? [[row.leadId, readDiagnosisSummary(row.result)] as const] : []
    )
  );
  return {
    progress: phaseProgress(phaseRows),
    accuracy: diagnosisAccuracy(
      reviews.map((review) => ({
        ...review,
        diagnosis: diagnosisByLead.get(review.leadId) ?? null,
      }))
    ),
  };
}
