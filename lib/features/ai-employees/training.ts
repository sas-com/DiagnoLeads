/**
 * The training room (Epic #1187, decision 2026-11-14-training-room-grows-employees): the
 * onboarding of the AI employees (#1189), their monthly reviews and promotions (#1190) and their
 * notes. Every query is scoped by organizationId. The steps of a session are made by
 * agent/runtime.ts; this file starts the sessions and carries out the president's answers.
 *
 * What raises how much an employee is trusted (approving the onboarding, a promotion) is written
 * to the audit log, and is only done for the level it was asked from: a double send or an answer
 * to something that changed meanwhile changes nothing.
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  aiEmployeeReviews,
  aiEmployeeRuns,
  aiEmployeeSessions,
  aiEmployees,
  auditLogs,
} from '@/lib/db/schema';
import type Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  MEMORY_PATH,
  type MemoryNotes,
  refusedNoteContent,
  runMemoryCommand,
} from './agent/memory';
import { listNotes, loadNotes, saveNoteChanges } from './agent/memory-store';
import { correctionMessage, onboardingMessage, reviewMessage } from './agent/prompts';
import { agentEnabled } from './agent/runtime';
import {
  type ReviewFacts,
  type ReviewRecommendation,
  nextReviewAt,
  recommend,
  reviewFacts,
  reviewPeriodStart,
} from './grading';
import {
  type AiEmployeeLevel,
  PROBATION_LEVEL,
  TOP_LEVEL,
  TRAINING_LEVEL,
  toLevel,
} from './types/levels';
import { type AiEmployeeRole, isAiEmployeeRole } from './types/roles';
import type { AiEmployeeStatus } from './types/schemas';
import {
  type AiEmployeeSessionKind,
  type AiEmployeeSessionStatus,
  OPEN_SESSION_STATUSES,
} from './types/training';

type Database = typeof defaultDb;
type Locale = 'ja' | 'en';

export interface TrainingSession {
  id: string;
  kind: AiEmployeeSessionKind;
  status: AiEmployeeSessionStatus;
  /** What the employee handed in (checked by zod when it was handed in) */
  report: Record<string, unknown> | null;
  resultCode: string | null;
  steps: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainingReview {
  id: string;
  sessionId: string | null;
  periodStart: Date;
  periodEnd: Date;
  facts: ReviewFacts;
  recommendation: ReviewRecommendation;
  levelBefore: AiEmployeeLevel;
  levelAfter: AiEmployeeLevel | null;
  status: 'open' | 'decided';
  decidedAt: Date | null;
  createdAt: Date;
}

export interface TrainingEmployee {
  id: string;
  role: AiEmployeeRole;
  name: string;
  status: AiEmployeeStatus;
  level: AiEmployeeLevel;
  hiredAt: Date;
  onboardedAt: Date | null;
  levelChangedAt: Date | null;
  policy: string;
  /** The latest session (open or not) */
  session: TrainingSession | null;
  /** The latest review */
  review: TrainingReview | null;
  /** When the next review may be held; null while in training */
  nextReviewAt: Date | null;
  notes: { path: string; content: string; updatedAt: Date }[];
}

export type TrainingFailure =
  | 'not_found'
  | 'agent_disabled'
  | 'paused'
  | 'already_onboarded'
  | 'in_training'
  | 'open_session'
  | 'not_waiting'
  | 'review_not_due'
  | 'not_recommended'
  | 'level_changed'
  | 'self_review_running'
  | 'invalid_note';

type Result<T> = { ok: true; value: T } | { ok: false; failure: TrainingFailure };
const fail = <T>(failure: TrainingFailure): Result<T> => ({ ok: false, failure });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** Thrown inside a transaction to undo it and answer with a failure */
class Abort extends Error {
  constructor(readonly failure: TrainingFailure) {
    super(failure);
  }
}

/** Runs `work` in a transaction; an Abort undoes everything and becomes the failure */
async function inTransaction<T>(
  db: Database,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>
): Promise<Result<T>> {
  try {
    return ok(await db.transaction(work));
  } catch (error) {
    if (error instanceof Abort) return fail(error.failure);
    throw error;
  }
}

function toSession(row: typeof aiEmployeeSessions.$inferSelect): TrainingSession {
  return {
    id: row.id,
    kind: row.kind as AiEmployeeSessionKind,
    status: row.status as AiEmployeeSessionStatus,
    report: row.report ?? null,
    resultCode: row.resultCode,
    steps: row.steps,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toReview(row: typeof aiEmployeeReviews.$inferSelect): TrainingReview {
  return {
    id: row.id,
    sessionId: row.sessionId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    facts: row.facts as unknown as ReviewFacts,
    recommendation: row.recommendation as ReviewRecommendation,
    levelBefore: toLevel(row.levelBefore),
    levelAfter: row.levelAfter === null ? null : toLevel(row.levelAfter),
    status: row.status === 'decided' ? 'decided' : 'open',
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

async function employeeOf(db: Database, organizationId: string, employeeId: string) {
  const [employee] = await db
    .select()
    .from(aiEmployees)
    .where(and(eq(aiEmployees.id, employeeId), eq(aiEmployees.organizationId, organizationId)));
  return employee ?? null;
}

async function hasOpenSession(db: Database, organizationId: string, employeeId: string) {
  const [open] = await db
    .select({ id: aiEmployeeSessions.id })
    .from(aiEmployeeSessions)
    .where(
      and(
        eq(aiEmployeeSessions.organizationId, organizationId),
        eq(aiEmployeeSessions.employeeId, employeeId),
        inArray(aiEmployeeSessions.status, [...OPEN_SESSION_STATUSES])
      )
    );
  return Boolean(open);
}

async function lastReview(db: Database, organizationId: string, employeeId: string) {
  const [row] = await db
    .select()
    .from(aiEmployeeReviews)
    .where(
      and(
        eq(aiEmployeeReviews.organizationId, organizationId),
        eq(aiEmployeeReviews.employeeId, employeeId)
      )
    )
    .orderBy(desc(aiEmployeeReviews.createdAt))
    .limit(1);
  return row ?? null;
}

/** Everything the training room shows, for each hired employee in the catalog's roles */
export async function getTraining(
  db: Database,
  input: { organizationId: string }
): Promise<{ employees: TrainingEmployee[]; agentEnabled: boolean }> {
  const employees = await db
    .select()
    .from(aiEmployees)
    .where(eq(aiEmployees.organizationId, input.organizationId))
    .orderBy(aiEmployees.createdAt);
  const result: TrainingEmployee[] = [];
  for (const employee of employees) {
    if (!isAiEmployeeRole(employee.role)) continue;
    const [session] = await db
      .select()
      .from(aiEmployeeSessions)
      .where(
        and(
          eq(aiEmployeeSessions.organizationId, input.organizationId),
          eq(aiEmployeeSessions.employeeId, employee.id)
        )
      )
      .orderBy(desc(aiEmployeeSessions.createdAt))
      .limit(1);
    const review = await lastReview(db, input.organizationId, employee.id);
    const level = toLevel(employee.level);
    result.push({
      id: employee.id,
      role: employee.role,
      name: employee.name,
      status: employee.status as AiEmployeeStatus,
      level,
      hiredAt: employee.createdAt,
      onboardedAt: employee.onboardedAt,
      levelChangedAt: employee.levelChangedAt,
      policy: employee.policy,
      session: session ? toSession(session) : null,
      review: review ? toReview(review) : null,
      nextReviewAt: nextReviewAt({
        level,
        onboardedAt: employee.onboardedAt,
        lastReviewAt: review?.createdAt ?? null,
      }),
      notes: await listNotes(db, { organizationId: input.organizationId, employeeId: employee.id }),
    });
  }
  return { employees: result, agentEnabled: agentEnabled() };
}

function audit(
  db: Pick<Database, 'insert'>,
  input: {
    organizationId: string;
    userId: string;
    employeeId: string;
    event: string;
    before?: unknown;
    after?: unknown;
  }
) {
  return db.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.userId,
    action: 'update',
    resource: 'ai_employee',
    resourceId: input.employeeId,
    changes: { before: input.before, after: input.after },
    metadata: { event: input.event },
  });
}

/** What the president expects of an employee (read at its onboarding and its reviews) */
export async function setPolicy(
  db: Database,
  input: { organizationId: string; employeeId: string; policy: string; userId: string }
): Promise<Result<{ policy: string }>> {
  const employee = await employeeOf(db, input.organizationId, input.employeeId);
  if (!employee) return fail('not_found');
  await db.transaction(async (tx) => {
    await tx
      .update(aiEmployees)
      .set({ policy: input.policy, updatedAt: new Date() })
      .where(
        and(
          eq(aiEmployees.id, input.employeeId),
          eq(aiEmployees.organizationId, input.organizationId)
        )
      );
    await audit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      employeeId: input.employeeId,
      event: 'policy_changed',
      before: { policy: employee.policy },
      after: { policy: input.policy },
    });
  });
  return ok({ policy: input.policy });
}

/** The one open session of an employee is refused by the database: reads it as a failure */
function isOpenSessionConflict(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null) ?? null;
  return code?.code === '23505' || code?.cause?.code === '23505';
}

/** Starts the onboarding of an employee in training */
export async function startOnboarding(
  db: Database,
  input: {
    organizationId: string;
    organizationName: string;
    employeeId: string;
    userId: string;
    locale: Locale;
    now?: Date;
  }
): Promise<Result<{ sessionId: string }>> {
  if (!agentEnabled()) return fail('agent_disabled');
  const employee = await employeeOf(db, input.organizationId, input.employeeId);
  if (!employee || !isAiEmployeeRole(employee.role)) return fail('not_found');
  if (employee.status === 'paused') return fail('paused');
  if (employee.level !== TRAINING_LEVEL) return fail('already_onboarded');
  if (await hasOpenSession(db, input.organizationId, employee.id)) return fail('open_session');
  const now = input.now ?? new Date();
  const first: Anthropic.MessageParam = {
    role: 'user',
    content: onboardingMessage({
      name: employee.name,
      role: employee.role,
      organizationName: input.organizationName,
      policy: employee.policy,
      locale: input.locale,
    }),
  };
  try {
    const [session] = await db
      .insert(aiEmployeeSessions)
      .values({
        organizationId: input.organizationId,
        employeeId: employee.id,
        kind: 'onboarding',
        messages: [first],
        startedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: aiEmployeeSessions.id });
    if (!session) return fail('open_session');
    return ok({ sessionId: session.id });
  } catch (error) {
    if (isOpenSessionConflict(error)) return fail('open_session');
    throw error;
  }
}

async function sessionOf(db: Database, organizationId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(aiEmployeeSessions)
    .where(
      and(
        eq(aiEmployeeSessions.id, sessionId),
        eq(aiEmployeeSessions.organizationId, organizationId)
      )
    );
  return session ?? null;
}

/**
 * The president's answer to an onboarding report: approving it puts the employee on probation
 * (level 1); a correction is given back to the employee, which runs on and hands in again
 */
export async function answerOnboarding(
  db: Database,
  input: {
    organizationId: string;
    sessionId: string;
    userId: string;
    answer: 'approve' | 'correct';
    correction?: string;
    now?: Date;
  }
): Promise<Result<{ level: AiEmployeeLevel | null }>> {
  const now = input.now ?? new Date();
  const session = await sessionOf(db, input.organizationId, input.sessionId);
  if (!session || session.kind !== 'onboarding') return fail('not_found');
  if (session.status !== 'waiting') return fail('not_waiting');

  if (input.answer === 'correct') {
    if (!agentEnabled()) return fail('agent_disabled');
    const messages = session.messages as Anthropic.MessageParam[];
    const [moved] = await db
      .update(aiEmployeeSessions)
      .set({
        status: 'running',
        report: null,
        messages: [
          ...messages,
          { role: 'user', content: correctionMessage(input.correction ?? '') },
        ],
        updatedAt: now,
      })
      .where(
        and(
          eq(aiEmployeeSessions.id, session.id),
          eq(aiEmployeeSessions.organizationId, input.organizationId),
          eq(aiEmployeeSessions.status, 'waiting')
        )
      )
      .returning({ id: aiEmployeeSessions.id });
    return moved ? ok({ level: null }) : fail('not_waiting');
  }

  return inTransaction(db, async (tx) => {
    const [closed] = await tx
      .update(aiEmployeeSessions)
      .set({ status: 'succeeded', finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(aiEmployeeSessions.id, session.id),
          eq(aiEmployeeSessions.organizationId, input.organizationId),
          eq(aiEmployeeSessions.status, 'waiting')
        )
      )
      .returning({ id: aiEmployeeSessions.id });
    if (!closed) throw new Abort('not_waiting');
    const [raised] = await tx
      .update(aiEmployees)
      .set({ level: PROBATION_LEVEL, onboardedAt: now, levelChangedAt: now, updatedAt: now })
      .where(
        and(
          eq(aiEmployees.id, session.employeeId),
          eq(aiEmployees.organizationId, input.organizationId),
          eq(aiEmployees.level, TRAINING_LEVEL)
        )
      )
      .returning({ id: aiEmployees.id });
    if (!raised) throw new Abort('already_onboarded');
    await audit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      employeeId: session.employeeId,
      event: 'onboarding_approved',
      before: { level: TRAINING_LEVEL },
      after: { level: PROBATION_LEVEL },
    });
    return { level: PROBATION_LEVEL as AiEmployeeLevel | null };
  });
}

/** Stops an open session (the president gives up on it); the notes written so far stay */
export async function cancelSession(
  db: Database,
  input: { organizationId: string; sessionId: string; now?: Date }
): Promise<Result<{ sessionId: string }>> {
  const now = input.now ?? new Date();
  const [cancelled] = await db
    .update(aiEmployeeSessions)
    .set({
      status: 'cancelled',
      resultCode: 'cancelled',
      lockedUntil: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiEmployeeSessions.id, input.sessionId),
        eq(aiEmployeeSessions.organizationId, input.organizationId),
        inArray(aiEmployeeSessions.status, [...OPEN_SESSION_STATUSES])
      )
    )
    .returning({ id: aiEmployeeSessions.id });
  return cancelled ? ok({ sessionId: cancelled.id }) : fail('not_waiting');
}

/** The counts of an employee's runs since a time */
async function runCounts(db: Database, organizationId: string, employeeId: string, since: Date) {
  const rows = await db
    .select({
      status: aiEmployeeRuns.status,
      runs: sql<number>`count(*)::int`,
      processed: sql<number>`coalesce(sum(${aiEmployeeRuns.processedCount}), 0)::int`,
    })
    .from(aiEmployeeRuns)
    .where(
      and(
        eq(aiEmployeeRuns.organizationId, organizationId),
        eq(aiEmployeeRuns.employeeId, employeeId),
        gte(aiEmployeeRuns.startedAt, since)
      )
    )
    .groupBy(aiEmployeeRuns.status);
  const counts = { succeeded: 0, failed: 0, other: 0, processed: 0 };
  for (const row of rows) {
    const runs = Number(row.runs);
    if (row.status === 'succeeded') {
      counts.succeeded += runs;
      counts.processed += Number(row.processed);
    } else if (row.status === 'failed') counts.failed += runs;
    else counts.other += runs;
  }
  return counts;
}

/**
 * Opens the monthly review of an employee: counts the facts of the period, recommends, lowers
 * the grade at once when the records call for it, and starts the employee's self-review
 */
export async function startReview(
  db: Database,
  input: { organizationId: string; employeeId: string; userId: string; locale: Locale; now?: Date }
): Promise<Result<{ reviewId: string; sessionId: string; recommendation: ReviewRecommendation }>> {
  if (!agentEnabled()) return fail('agent_disabled');
  const now = input.now ?? new Date();
  const employee = await employeeOf(db, input.organizationId, input.employeeId);
  if (!employee || !isAiEmployeeRole(employee.role)) return fail('not_found');
  if (employee.status === 'paused') return fail('paused');
  const level = toLevel(employee.level);
  if (level === TRAINING_LEVEL || !employee.onboardedAt) return fail('in_training');
  if (await hasOpenSession(db, input.organizationId, employee.id)) return fail('open_session');
  const previous = await lastReview(db, input.organizationId, employee.id);
  const due = nextReviewAt({
    level,
    onboardedAt: employee.onboardedAt,
    lastReviewAt: previous?.createdAt ?? null,
  });
  if (!due || due.getTime() > now.getTime()) return fail('review_not_due');

  const periodStart = reviewPeriodStart({
    onboardedAt: employee.onboardedAt,
    lastReviewAt: previous?.createdAt ?? null,
  });
  const facts = reviewFacts({
    hiredAt: employee.createdAt,
    levelSince: employee.levelChangedAt ?? employee.onboardedAt,
    runs: await runCounts(db, input.organizationId, employee.id, periodStart),
    // The works hand in no proposals yet (#1103): no record to count
    proposals: null,
    now,
  });
  const recommendation = recommend(level, facts);
  const narrowed = recommendation === 'narrow' ? toLevel(level - 1) : null;

  try {
    return await db.transaction(async (tx) => {
      const [session] = await tx
        .insert(aiEmployeeSessions)
        .values({
          organizationId: input.organizationId,
          employeeId: employee.id,
          kind: 'review',
          messages: [
            {
              role: 'user',
              content: reviewMessage({
                name: employee.name,
                role: employee.role as AiEmployeeRole,
                level: narrowed ?? level,
                facts,
                recommendation,
                policy: employee.policy,
                locale: input.locale,
              }),
            },
          ],
          startedBy: input.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: aiEmployeeSessions.id });
      if (!session) throw new Error('The review session was not created');
      const [review] = await tx
        .insert(aiEmployeeReviews)
        .values({
          organizationId: input.organizationId,
          employeeId: employee.id,
          sessionId: session.id,
          periodStart,
          periodEnd: now,
          facts: facts as unknown as Record<string, unknown>,
          recommendation,
          levelBefore: level,
          levelAfter: narrowed,
          status: narrowed === null ? 'open' : 'decided',
          decidedAt: narrowed === null ? null : now,
          createdAt: now,
        })
        .returning({ id: aiEmployeeReviews.id });
      if (!review) throw new Error('The review was not created');
      if (narrowed !== null) {
        await tx
          .update(aiEmployees)
          .set({ level: narrowed, levelChangedAt: now, updatedAt: now })
          .where(
            and(
              eq(aiEmployees.id, employee.id),
              eq(aiEmployees.organizationId, input.organizationId),
              eq(aiEmployees.level, level)
            )
          );
        await audit(tx, {
          organizationId: input.organizationId,
          userId: input.userId,
          employeeId: employee.id,
          event: 'level_narrowed',
          before: { level },
          after: { level: narrowed, failureRate: facts.failureRate, runs: facts.runs },
        });
      }
      return ok({ reviewId: review.id, sessionId: session.id, recommendation });
    });
  } catch (error) {
    if (isOpenSessionConflict(error)) return fail('open_session');
    throw error;
  }
}

/**
 * The president's decision at a review: promote (only what the facts recommend, from the level
 * the president saw) or keep. Waits for the self-review to be handed in or to have ended.
 */
export async function decideReview(
  db: Database,
  input: {
    organizationId: string;
    reviewId: string;
    userId: string;
    decision: 'promote' | 'keep';
    fromLevel?: number;
    now?: Date;
  }
): Promise<Result<{ level: AiEmployeeLevel }>> {
  const now = input.now ?? new Date();
  const [review] = await db
    .select()
    .from(aiEmployeeReviews)
    .where(
      and(
        eq(aiEmployeeReviews.id, input.reviewId),
        eq(aiEmployeeReviews.organizationId, input.organizationId)
      )
    );
  if (!review) return fail('not_found');
  if (review.status !== 'open') return fail('not_waiting');
  if (review.sessionId) {
    const session = await sessionOf(db, input.organizationId, review.sessionId);
    if (session?.status === 'running') return fail('self_review_running');
  }
  const levelBefore = toLevel(review.levelBefore);
  if (input.decision === 'promote') {
    if (review.recommendation !== 'promote') return fail('not_recommended');
    if (input.fromLevel !== levelBefore || levelBefore === TOP_LEVEL) return fail('level_changed');
  }
  const levelAfter = input.decision === 'promote' ? toLevel(levelBefore + 1) : levelBefore;

  return inTransaction(db, async (tx) => {
    const [decided] = await tx
      .update(aiEmployeeReviews)
      .set({ status: 'decided', levelAfter, decidedBy: input.userId, decidedAt: now })
      .where(
        and(
          eq(aiEmployeeReviews.id, review.id),
          eq(aiEmployeeReviews.organizationId, input.organizationId),
          eq(aiEmployeeReviews.status, 'open')
        )
      )
      .returning({ id: aiEmployeeReviews.id });
    if (!decided) throw new Abort('not_waiting');
    if (review.sessionId) {
      await tx
        .update(aiEmployeeSessions)
        .set({ status: 'succeeded', finishedAt: now, updatedAt: now })
        .where(
          and(
            eq(aiEmployeeSessions.id, review.sessionId),
            eq(aiEmployeeSessions.organizationId, input.organizationId),
            eq(aiEmployeeSessions.status, 'waiting')
          )
        );
    }
    if (input.decision === 'promote') {
      const [raised] = await tx
        .update(aiEmployees)
        .set({ level: levelAfter, levelChangedAt: now, updatedAt: now })
        .where(
          and(
            eq(aiEmployees.id, review.employeeId),
            eq(aiEmployees.organizationId, input.organizationId),
            eq(aiEmployees.level, levelBefore)
          )
        )
        .returning({ id: aiEmployees.id });
      if (!raised) throw new Abort('level_changed');
      await audit(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        employeeId: review.employeeId,
        event: 'level_promoted',
        before: { level: levelBefore },
        after: { level: levelAfter },
      });
    }
    return { level: levelAfter };
  });
}

/**
 * A manager fixes (content) or deletes (null) one note. Refused while a session runs, so that a
 * step does not write over it, and with the same checks as the employee's own writes.
 */
export async function editNote(
  db: Database,
  input: {
    organizationId: string;
    employeeId: string;
    path: string;
    content: string | null;
    userId: string;
    now?: Date;
  }
): Promise<Result<{ path: string }>> {
  const now = input.now ?? new Date();
  const employee = await employeeOf(db, input.organizationId, input.employeeId);
  if (!employee) return fail('not_found');
  if (!MEMORY_PATH.test(input.path)) return fail('invalid_note');
  const [running] = await db
    .select({ id: aiEmployeeSessions.id })
    .from(aiEmployeeSessions)
    .where(
      and(
        eq(aiEmployeeSessions.organizationId, input.organizationId),
        eq(aiEmployeeSessions.employeeId, employee.id),
        eq(aiEmployeeSessions.status, 'running')
      )
    );
  if (running) return fail('open_session');
  const scope = { organizationId: input.organizationId, employeeId: employee.id };
  const notes: MemoryNotes = await loadNotes(db, scope);
  if (input.content === null) {
    if (!notes.has(input.path)) return fail('not_found');
  } else if (refusedNoteContent(input.content)) {
    return fail('invalid_note');
  }
  const outcome =
    input.content === null
      ? runMemoryCommand(notes, { command: 'delete', path: input.path })
      : runMemoryCommand(notes, { command: 'create', path: input.path, file_text: input.content });
  if (outcome.isError) return fail('invalid_note');
  await db.transaction(async (tx) => {
    await saveNoteChanges(tx, scope, outcome.changes, { kind: 'user', userId: input.userId }, now);
  });
  return ok({ path: input.path });
}
