/**
 * Pre-meeting prep card data access (Refs #156). Every query is scoped by organizationId; the
 * router checks permissions. The draft source carries the organization's playbook questions, so
 * it is read only for those who may edit the card (see the router).
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leadPrepCards, leads, users } from '@/lib/db/schema';
import { readPlaybookContent } from '@/lib/features/ax-playbook/service';
import { latestAxSubmission } from '@/lib/features/diagnostics/ax-migration/lead-submissions';
import { readLeadDiagnosis } from '@/lib/features/leads/diagnosis-view';
import { and, eq, sql } from 'drizzle-orm';
import { type PrepDraftSource, toPrepChallenge } from './draft';
import { PREP_CHALLENGES, type PrepCardFields, type PrepChallenge } from './types/schemas';

type Database = typeof defaultDb;

export interface PrepCardView extends PrepCardFields {
  updatedAt: Date;
  updatedByName: string | null;
}

const reasonKeys = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];

/** The lead's card, or null when none was saved; undefined when the lead is not found */
export async function getPrepCard(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<PrepCardView | null | undefined> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  if (!lead) return undefined;
  const [row] = await db
    .select({
      estimatedSystem: leadPrepCards.estimatedSystem,
      estimatedSystemBasis: leadPrepCards.estimatedSystemBasis,
      recentNews: leadPrepCards.recentNews,
      hypotheses: leadPrepCards.hypotheses,
      firstQuestions: leadPrepCards.firstQuestions,
      updatedAt: leadPrepCards.updatedAt,
      updatedByName: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
    })
    .from(leadPrepCards)
    .leftJoin(users, eq(users.id, leadPrepCards.updatedBy))
    .where(
      and(
        eq(leadPrepCards.leadId, input.leadId),
        eq(leadPrepCards.organizationId, input.organizationId)
      )
    );
  if (!row) return null;
  return {
    ...row,
    hypotheses: Object.fromEntries(
      PREP_CHALLENGES.flatMap((key) => {
        const value = row.hypotheses[key];
        return typeof value === 'string' && value ? [[key, value]] : [];
      })
    ) as Partial<Record<PrepChallenge, string>>,
  };
}

/** What the draft is built from: the diagnosis on the lead, its latest AX answer and the playbook */
export async function getPrepDraftSource(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<PrepDraftSource> {
  const [[lead], submission, playbook] = await Promise.all([
    db
      .select({
        targetSystem: leads.targetSystem,
        responses: leads.responses,
        customFields: leads.customFields,
      })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId))),
    latestAxSubmission(db, input.organizationId, input.leadId),
    readPlaybookContent(db, input.organizationId),
  ]);

  const ax = lead ? readLeadDiagnosis(lead.responses, lead.customFields).ax : null;
  const diagnosisSystem = ax?.targetSystem ?? null;
  const targetSystem = diagnosisSystem ?? lead?.targetSystem ?? null;
  const reasons = (submission?.result as { reasons?: Record<string, unknown> } | undefined)
    ?.reasons;
  const playbookQuestions: Partial<Record<PrepChallenge, string[]>> = {};
  for (const key of PREP_CHALLENGES) {
    const questions = playbook?.challenges?.[key]?.questions;
    if (Array.isArray(questions) && questions.length > 0) playbookQuestions[key] = questions;
  }
  return {
    targetSystem,
    targetSystemFrom: diagnosisSystem ? 'diagnosis' : targetSystem ? 'lead' : null,
    primaryChallenge: toPrepChallenge(ax?.primaryChallenge),
    challenges: (ax?.challenges ?? []).flatMap((c) => {
      const challenge = toPrepChallenge(c);
      return challenge ? [challenge] : [];
    }),
    urgencyReasons: reasonKeys(reasons?.urgency),
    difficultyReasons: reasonKeys(reasons?.difficulty),
    playbookQuestions,
  };
}

export type SavePrepCardResult =
  /** The card's new `updatedAt`: what the next save of the same reader expects */
  | { status: 'saved'; updatedAt: Date }
  | { status: 'not_found' }
  /** Somebody else saved the card (or created it) after it was read: nothing was written */
  | { status: 'conflict' };

/**
 * Save the card, which replaces all its fields, only when it is still as the caller read it
 * (#1225, like the hearings): `expectedUpdatedAt` is the card's `updatedAt` as read, or null when
 * there was none. The check is part of the one statement that writes, so two saves at the same
 * moment cannot both go through: the update only matches the row with that `updatedAt`, and the
 * first save of a card only inserts when the lead has no row yet (the unique index on lead_id).
 */
export async function savePrepCard(
  db: Database,
  input: {
    organizationId: string;
    leadId: string;
    userId: string;
    card: PrepCardFields;
    expectedUpdatedAt: Date | null;
  },
  now: Date = new Date()
): Promise<SavePrepCardResult> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  if (!lead) return { status: 'not_found' };

  if (input.expectedUpdatedAt === null) {
    const [created] = await db
      .insert(leadPrepCards)
      .values({
        ...input.card,
        organizationId: input.organizationId,
        leadId: input.leadId,
        createdBy: input.userId,
        updatedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: leadPrepCards.leadId })
      .returning({ updatedAt: leadPrepCards.updatedAt });
    return created ? { status: 'saved', updatedAt: created.updatedAt } : { status: 'conflict' };
  }

  // Always move updatedAt forward, even within the same millisecond: an old token never matches
  // again. Written as a JS date (milliseconds), so that it comes back equal to what is compared
  const updatedAt = new Date(Math.max(now.getTime(), input.expectedUpdatedAt.getTime() + 1));
  const [saved] = await db
    .update(leadPrepCards)
    .set({ ...input.card, updatedBy: input.userId, updatedAt })
    .where(
      and(
        eq(leadPrepCards.leadId, input.leadId),
        eq(leadPrepCards.organizationId, input.organizationId),
        eq(leadPrepCards.updatedAt, input.expectedUpdatedAt)
      )
    )
    .returning({ updatedAt: leadPrepCards.updatedAt });
  return saved ? { status: 'saved', updatedAt: saved.updatedAt } : { status: 'conflict' };
}
