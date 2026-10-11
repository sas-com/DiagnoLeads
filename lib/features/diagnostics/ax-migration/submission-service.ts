import type { db as defaultDb } from '@/lib/db/client';
import { type Lead, diagnosticSubmissions, leads } from '@/lib/db/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { validateAnswers } from '../engine';
import { type Tracking, compactTracking, inferInflowSource, trackingSchema } from '../tracking';
import type { AnswerValidationIssue, DiagnosticAnswers } from '../types';
import { AX_MIGRATION_CONFIG } from './config';
import { PHONE_PATTERN, normalizePhone } from './contact';
import { AX_MIGRATION_DIAGNOSTIC_KEY, axMigrationDefinition } from './definition';
import { type AxMigrationResult, evaluateAxMigration } from './evaluate';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** No control or format characters (line breaks, bidi overrides) in names shown to sales */
const PLAIN_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;
const plainText = (max: number) => z.string().trim().max(max).regex(PLAIN_TEXT);

export const axMigrationSubmissionSchema = z.object({
  answers: z.record(z.unknown()),
  contact: z.object({
    company: plainText(200).pipe(z.string().min(1)),
    name: plainText(100).pipe(z.string().min(1)),
    email: z.string().trim().email().max(254),
    phone: z
      .string()
      .max(30)
      .transform(normalizePhone)
      .pipe(z.string().regex(PHONE_PATTERN))
      .optional(),
    department: plainText(100).optional(),
  }),
  privacyConsent: z.literal(true),
  consultationRequested: z.boolean().default(false),
  tracking: trackingSchema,
  locale: z.enum(['ja', 'en']).default('ja'),
  /** Honeypot: people never fill it. The route answers a filled one with a fake success */
  website: z.string().max(500).optional(),
  /** Cloudflare Turnstile token (checked by the route when Turnstile is on) */
  turnstileToken: z.string().max(2048).optional(),
  /**
   * The first submission of this visit, sent when the respondent diagnoses another system from
   * the result screen. Trusted only after the checks in findContinuationOrigin.
   */
  continuedFrom: z.string().uuid().optional(),
});
export type AxMigrationSubmissionInput = z.infer<typeof axMigrationSubmissionSchema>;

/** The existing lead as stored in the DB (never taken from the unauthenticated request) */
export interface ExistingLeadSnapshot {
  name: string | null;
  company: string | null;
  email: string;
}

export type SubmitOutcome =
  | {
      ok: true;
      submissionId: string;
      leadId: string;
      leadCreated: boolean;
      /** Set when the email matched an existing lead */
      existingLead: ExistingLeadSnapshot | null;
      /**
       * The respondent who created that lead diagnosed another system in the same visit:
       * recorded on the lead, and not an unverified identity
       */
      continued: boolean;
      result: AxMigrationResult;
      answers: DiagnosticAnswers;
    }
  | { ok: false; issues: AnswerValidationIssue[] };

/** Another system diagnosed by the same respondent, kept on the lead next to the first one */
export interface OtherSystemEntry {
  submissionId: string;
  diagnosedAt: string;
  platform: AxMigrationResult['platform'];
  targetSystem: AxMigrationResult['targetSystem'];
  difficulty: AxMigrationResult['difficulty']['level'];
  urgency: AxMigrationResult['urgency']['level'];
  primaryChallenge: AxMigrationResult['challenges']['primary'];
  needsHearing: boolean;
  detailsAnsweredAt?: string;
}

/** The result screen (follow-up answers, "diagnose another system") is used for a day */
export const RESULT_SCREEN_WINDOW_MS = 24 * 60 * 60 * 1000;
/** "Diagnose another system" is offered on the result screen */
export const CONTINUATION_WINDOW_MS = RESULT_SCREEN_WINDOW_MS;

type LeadResponses = unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The lead's responses as an object (anything else, e.g. hand-edited data, counts as empty) */
function responsesOf(responses: LeadResponses): Record<string, unknown> {
  return isPlainObject(responses) ? responses : {};
}

function axSummaryOf(responses: LeadResponses): Record<string, unknown> {
  const summary = responsesOf(responses).axMigration;
  return isPlainObject(summary) ? summary : {};
}

function otherSystemsOf(summary: Record<string, unknown>): OtherSystemEntry[] {
  return Array.isArray(summary.otherSystems) ? (summary.otherSystems as OtherSystemEntry[]) : [];
}

/** Lead responses with another system added (and the consultation flag, when requested) */
export function withOtherSystem(
  responses: LeadResponses,
  entry: OtherSystemEntry,
  consultationRequested: boolean
): Record<string, unknown> {
  const summary = axSummaryOf(responses);
  return {
    ...responsesOf(responses),
    axMigration: {
      ...summary,
      ...(consultationRequested ? { consultationRequested: true } : {}),
      otherSystems: [...otherSystemsOf(summary), entry],
    },
  };
}

/** Lead responses with one recorded system changed, or null when it is not recorded there */
export function withOtherSystemUpdate(
  responses: LeadResponses,
  submissionId: string,
  changes: Partial<OtherSystemEntry>
): Record<string, unknown> | null {
  const summary = axSummaryOf(responses);
  const systems = otherSystemsOf(summary);
  if (!systems.some((system) => system?.submissionId === submissionId)) return null;
  return {
    ...responsesOf(responses),
    axMigration: {
      ...summary,
      otherSystems: systems.map((system) =>
        system?.submissionId === submissionId ? { ...system, ...changes } : system
      ),
    },
  };
}

/** Summary stored on a lead created by the diagnosis */
function buildLeadSummary(
  submissionId: string,
  result: AxMigrationResult,
  input: AxMigrationSubmissionInput,
  now: Date
) {
  return {
    submissionId,
    diagnosedAt: now.toISOString(),
    difficulty: result.difficulty.level,
    urgency: result.urgency.level,
    primaryChallenge: result.challenges.primary,
    challenges: result.challenges.selected,
    mqlCandidate: result.mql.candidate,
    sqlSignals: result.sqlSignals.candidate,
    needsHearing: result.needsHearing,
    consultationRequested: input.consultationRequested,
    platform: result.platform,
    department: input.contact.department ?? null,
  };
}

/**
 * Save an AX migration diagnosis and link it to a lead.
 *
 * - Scores are computed here on the server; nothing from the client is trusted.
 * - The endpoint is unauthenticated, so the identity and the diagnosis values of a matching
 *   existing lead are never changed: the submission is only linked to it and sales is told the
 *   identity is unverified. Only a lead created by this submission gets the diagnosis values.
 *   The one exception: another system diagnosed from the result screen of the submission that
 *   created the lead is added to its list of other systems (see findContinuationOrigin).
 * - A transaction-scoped advisory lock on (organization, email) serializes concurrent
 *   submissions for the same address, so a double submit cannot create two leads.
 */
export async function submitAxMigrationDiagnosis(
  database: Database,
  organizationId: string,
  input: AxMigrationSubmissionInput,
  now: Date = new Date()
): Promise<SubmitOutcome> {
  const validation = validateAnswers(axMigrationDefinition, input.answers);
  if (!validation.success) {
    return { ok: false, issues: validation.issues };
  }
  const answers = validation.answers;
  const result = evaluateAxMigration(answers, AX_MIGRATION_CONFIG, now);
  const tracking: Tracking = input.tracking ?? {};
  const inflow = inferInflowSource(tracking);
  const email = input.contact.email.toLowerCase();

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${email}`}, 0))`
    );

    const existing: Lead | undefined = await tx.query.leads.findFirst({
      where: and(eq(leads.organizationId, organizationId), sql`lower(${leads.email}) = ${email}`),
      orderBy: [asc(leads.createdAt)],
    });

    let leadId: string;
    let continuedFrom: string | null = null;
    if (existing) {
      leadId = existing.id;
      if (input.continuedFrom) {
        continuedFrom = await findContinuationOrigin(
          tx,
          organizationId,
          existing.id,
          input.continuedFrom,
          now
        );
      }
    } else {
      const [created] = await tx
        .insert(leads)
        .values({
          organizationId,
          email,
          name: input.contact.name,
          company: input.contact.company,
          phone: input.contact.phone || null,
          status: 'new',
          score: result.leadScore,
          source: 'website',
          inflowSource: inflow.inflowSource,
          referrerName: inflow.referrerName,
          conversionPoint: input.consultationRequested ? 'consultation' : 'web_diagnosis',
          targetSystem: result.targetSystem,
          mqlQualifiedAt: result.mql.qualified ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: leads.id });
      leadId = created.id;
    }

    const [submission] = await tx
      .insert(diagnosticSubmissions)
      .values({
        organizationId,
        leadId,
        leadCreated: !existing,
        diagnosticKey: AX_MIGRATION_DIAGNOSTIC_KEY,
        diagnosticVersion: axMigrationDefinition.version,
        answers,
        result: result as unknown as Record<string, unknown>,
        tracking: compactTracking(tracking),
        locale: input.locale,
        consultationRequestedAt: input.consultationRequested ? now : null,
        continuedFromSubmissionId: continuedFrom,
        createdAt: now,
      })
      .returning({ id: diagnosticSubmissions.id });

    if (!existing) {
      await tx
        .update(leads)
        .set({ responses: { axMigration: buildLeadSummary(submission.id, result, input, now) } })
        .where(eq(leads.id, leadId));
    } else if (continuedFrom) {
      await recordOtherSystem(tx, leadId, submission.id, result, input.consultationRequested, now);
    }

    return {
      ok: true as const,
      submissionId: submission.id,
      leadId,
      leadCreated: !existing,
      existingLead: existing
        ? { name: existing.name, company: existing.company, email: existing.email }
        : null,
      continued: continuedFrom !== null,
      result,
      answers,
    };
  });
}

/**
 * The earlier submission that a "diagnose another system" submission continues, or null.
 * Trusted only when that submission created this very lead, in this organization, within the
 * last day. Its id is known only to the browser that sent it (and to sales), so someone who
 * types another person's email address cannot pass as that person.
 */
async function findContinuationOrigin(
  tx: Transaction,
  organizationId: string,
  leadId: string,
  submissionId: string,
  now: Date
): Promise<string | null> {
  const origin = await tx.query.diagnosticSubmissions.findFirst({
    columns: { id: true, createdAt: true },
    where: and(
      eq(diagnosticSubmissions.id, submissionId),
      eq(diagnosticSubmissions.organizationId, organizationId),
      eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY),
      eq(diagnosticSubmissions.leadId, leadId),
      eq(diagnosticSubmissions.leadCreated, true)
    ),
  });
  if (!origin) return null;
  return now.getTime() - origin.createdAt.getTime() <= CONTINUATION_WINDOW_MS ? origin.id : null;
}

/**
 * Record another system on the lead the respondent created. The name, company and score stay
 * as they are; the row is locked so a concurrent update of the responses in the database is not
 * lost (the lead edit form does not send the responses back, so it cannot undo this either).
 */
async function recordOtherSystem(
  tx: Transaction,
  leadId: string,
  submissionId: string,
  result: AxMigrationResult,
  consultationRequested: boolean,
  now: Date
): Promise<void> {
  const [lead] = await tx
    .select({ responses: leads.responses, mqlQualifiedAt: leads.mqlQualifiedAt })
    .from(leads)
    .where(eq(leads.id, leadId))
    .for('no key update');
  if (!lead) return;

  const entry: OtherSystemEntry = {
    submissionId,
    diagnosedAt: now.toISOString(),
    platform: result.platform,
    targetSystem: result.targetSystem,
    difficulty: result.difficulty.level,
    urgency: result.urgency.level,
    primaryChallenge: result.challenges.primary,
    needsHearing: result.needsHearing,
  };
  await tx
    .update(leads)
    .set({
      responses: withOtherSystem(lead.responses, entry, consultationRequested),
      ...(consultationRequested ? { conversionPoint: 'consultation' } : {}),
      // MQL belongs to the lead: a qualifying system makes it one, an earlier date stays
      ...(result.mql.qualified && !lead.mqlQualifiedAt ? { mqlQualifiedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(leads.id, leadId));
}

/**
 * Record a consultation request made from the result page.
 * Exactly one concurrent request wins (conditional UPDATE), so sales is notified once.
 * The lead is updated only when this submission created it or continued the one that did.
 */
export async function requestAxMigrationConsultation(
  database: Database,
  submissionId: string,
  now: Date = new Date()
): Promise<
  | {
      ok: true;
      alreadyRequested: boolean;
      organizationId: string;
      leadId: string | null;
      leadCreated: boolean;
      /** A "diagnose another system" submission of the respondent who created the lead */
      continued: boolean;
    }
  | { ok: false; reason: 'not_found' }
> {
  return database.transaction(async (tx) => {
    const [claimed] = await tx
      .update(diagnosticSubmissions)
      .set({ consultationRequestedAt: now })
      .where(
        and(
          eq(diagnosticSubmissions.id, submissionId),
          eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY),
          isNull(diagnosticSubmissions.consultationRequestedAt)
        )
      )
      .returning({
        organizationId: diagnosticSubmissions.organizationId,
        leadId: diagnosticSubmissions.leadId,
        leadCreated: diagnosticSubmissions.leadCreated,
        continuedFrom: diagnosticSubmissions.continuedFromSubmissionId,
      });

    if (!claimed) {
      const submission = await tx.query.diagnosticSubmissions.findFirst({
        where: and(
          eq(diagnosticSubmissions.id, submissionId),
          eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY)
        ),
      });
      if (!submission) return { ok: false as const, reason: 'not_found' as const };
      return {
        ok: true as const,
        alreadyRequested: true,
        organizationId: submission.organizationId,
        leadId: submission.leadId,
        leadCreated: submission.leadCreated,
        continued: submission.continuedFromSubmissionId !== null,
      };
    }

    const continued = claimed.continuedFrom !== null;
    if (claimed.leadId && (claimed.leadCreated || continued)) {
      await tx
        .update(leads)
        .set({
          conversionPoint: 'consultation',
          responses: sql`jsonb_set(
            coalesce(${leads.responses}, '{}'::jsonb),
            '{axMigration}',
            coalesce(${leads.responses} -> 'axMigration', '{}'::jsonb) || '{"consultationRequested": true}'::jsonb,
            true
          )`,
          updatedAt: now,
        })
        .where(eq(leads.id, claimed.leadId));
    }

    return {
      ok: true as const,
      alreadyRequested: false,
      organizationId: claimed.organizationId,
      leadId: claimed.leadId,
      leadCreated: claimed.leadCreated,
      continued,
    };
  });
}

/** Optional follow-up questions (asked after the result) */
const DETAIL_QUESTION_IDS = new Set(
  axMigrationDefinition.questions.filter((q) => q.detail).map((q) => q.id)
);
/** Follow-ups are answered on the result screen, so they are accepted for a day */
export const DETAILS_WINDOW_MS = RESULT_SCREEN_WINDOW_MS;

export const axMigrationDetailsSchema = z.object({
  submissionId: z.string().uuid(),
  answers: z.record(z.unknown()).refine((answers) => {
    const count = Object.keys(answers).length;
    return count >= 1 && count <= DETAIL_QUESTION_IDS.size;
  }),
});

/**
 * Add the optional follow-up answers given after the result and evaluate again.
 * Only `detail` questions of the submission's path are accepted; the answers the result was
 * based on stay as submitted. The lead is updated only when this submission created it, or
 * (for another system of the same respondent) only that system's entry on the lead.
 */
export async function addAxMigrationDetails(
  database: Database,
  submissionId: string,
  details: Record<string, unknown>,
  now: Date = new Date()
): Promise<
  | { ok: true; result: AxMigrationResult }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'outdated' }
  | { ok: false; reason: 'closed' }
  | { ok: false; reason: 'invalid'; issues: AnswerValidationIssue[] }
> {
  const notDetail = Object.keys(details).filter((id) => !DETAIL_QUESTION_IDS.has(id));
  if (notDetail.length > 0) {
    return {
      ok: false,
      reason: 'invalid',
      issues: notDetail.map((questionId) => ({ questionId, code: 'not_applicable' as const })),
    };
  }

  return database.transaction(async (tx) => {
    const [submission] = await tx
      .select()
      .from(diagnosticSubmissions)
      .where(
        and(
          eq(diagnosticSubmissions.id, submissionId),
          eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY)
        )
      )
      .for('no key update');
    if (!submission) return { ok: false as const, reason: 'not_found' as const };
    if (submission.diagnosticVersion !== axMigrationDefinition.version) {
      return { ok: false as const, reason: 'outdated' as const };
    }
    // Answered once, on the result screen: later calls (or a leaked id) change nothing
    const submitted = submission.answers as Record<string, unknown>;
    const answeredBefore = Object.keys(submitted).some((id) => DETAIL_QUESTION_IDS.has(id));
    if (answeredBefore || now.getTime() - submission.createdAt.getTime() > DETAILS_WINDOW_MS) {
      return { ok: false as const, reason: 'closed' as const };
    }

    const validation = validateAnswers(axMigrationDefinition, { ...submitted, ...details });
    if (!validation.success) {
      return { ok: false as const, reason: 'invalid' as const, issues: validation.issues };
    }
    const result = evaluateAxMigration(validation.answers, AX_MIGRATION_CONFIG, now);
    const previousScore = (submission.result as Partial<AxMigrationResult> | null)?.leadScore;

    await tx
      .update(diagnosticSubmissions)
      .set({
        answers: validation.answers,
        result: result as unknown as Record<string, unknown>,
      })
      .where(eq(diagnosticSubmissions.id, submissionId));

    if (submission.leadId && submission.leadCreated) {
      const summary = {
        difficulty: result.difficulty.level,
        urgency: result.urgency.level,
        needsHearing: result.needsHearing,
        detailsAnsweredAt: now.toISOString(),
      };
      await tx
        .update(leads)
        .set({
          // Keep a score sales have already changed
          score:
            typeof previousScore === 'number'
              ? sql`case when ${leads.score} = ${previousScore} then ${result.leadScore} else ${leads.score} end`
              : leads.score,
          responses: sql`jsonb_set(
            coalesce(${leads.responses}, '{}'::jsonb),
            '{axMigration}',
            coalesce(${leads.responses} -> 'axMigration', '{}'::jsonb) || ${JSON.stringify(summary)}::jsonb,
            true
          )`,
          updatedAt: now,
        })
        .where(eq(leads.id, submission.leadId));
    } else if (submission.leadId && submission.continuedFromSubmissionId) {
      const [lead] = await tx
        .select({ responses: leads.responses })
        .from(leads)
        .where(eq(leads.id, submission.leadId))
        .for('no key update');
      const responses =
        lead &&
        withOtherSystemUpdate(lead.responses, submissionId, {
          difficulty: result.difficulty.level,
          urgency: result.urgency.level,
          needsHearing: result.needsHearing,
          detailsAnsweredAt: now.toISOString(),
        });
      if (responses) {
        await tx
          .update(leads)
          .set({ responses, updatedAt: now })
          .where(eq(leads.id, submission.leadId));
      }
    }

    return { ok: true as const, result };
  });
}
