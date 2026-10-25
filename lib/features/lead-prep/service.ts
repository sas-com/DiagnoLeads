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

/** Save the card (created on the first save); false when the lead is not found */
export async function savePrepCard(
  db: Database,
  input: { organizationId: string; leadId: string; userId: string; card: PrepCardFields },
  now: Date = new Date()
): Promise<boolean> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  if (!lead) return false;
  const values = { ...input.card, updatedBy: input.userId, updatedAt: now };
  await db
    .insert(leadPrepCards)
    .values({
      ...values,
      organizationId: input.organizationId,
      leadId: input.leadId,
      createdBy: input.userId,
      createdAt: now,
    })
    .onConflictDoUpdate({ target: leadPrepCards.leadId, set: values });
  return true;
}
