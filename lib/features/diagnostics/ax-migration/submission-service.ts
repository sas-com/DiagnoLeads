import type { db as defaultDb } from '@/lib/db/client';
import { diagnosticSubmissions, leads } from '@/lib/db/schema';
import { readPlaybookContent } from '@/lib/features/ax-playbook/service';
import { axTargetCompanySchema } from '@/lib/features/ax-playbook/types/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { validateAnswers } from '../engine';
import { upsertLeadFromSubmission } from '../lead-upsert';
import {
  type QrCompletionFailure,
  claimConsultation,
  countQrCompletion,
  resolveInflow,
} from '../service';
import { type Tracking, compactTracking, trackingSchema } from '../tracking';
import type { AnswerValidationIssue, DiagnosticAnswers } from '../types';
import { contactSchema, plainText } from '../types/contact';
import type { AxAccessPath } from './access-path';
import type { AxTargetCompany } from './company-size';
import { AX_MIGRATION_CONFIG } from './config';
import { AX_MIGRATION_DIAGNOSTIC_KEY, axMigrationDefinition } from './definition';
import { type AxMigrationResult, evaluateAxMigration } from './evaluate';
import { type AxLeadMql, mergeLeadMql, toLeadMql, withConsultationSignal } from './mql';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const axMigrationSubmissionSchema = z.object({
  answers: z.record(z.unknown()),
  contact: contactSchema.extend({ department: plainText(100).optional() }),
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
      /** The QR campaign's count failed and the lead was kept (#700): report it after the response */
      qrCompletionFailure: QrCompletionFailure | null;
      referralMemberUserId: string | null;
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
  /** Access only (#303): the recommended way forward */
  accessPath?: AxAccessPath;
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

/**
 * Lead responses with another system added (and the consultation flag, when requested).
 * `mql` is that system's judgement; the lead keeps the higher of it and its own (mergeLeadMql).
 */
export function withOtherSystem(
  responses: LeadResponses,
  entry: OtherSystemEntry,
  consultationRequested: boolean,
  mql?: AxLeadMql
): Record<string, unknown> {
  const summary = axSummaryOf(responses);
  return {
    ...responsesOf(responses),
    axMigration: {
      ...summary,
      ...(consultationRequested ? { consultationRequested: true } : {}),
      ...withLeadMql(summary, mql),
      otherSystems: [...otherSystemsOf(summary), entry],
    },
  };
}

/**
 * The lead's MQL judgement after another one (nothing to change without one). A lead created
 * before #139 has no judgement stored; it then takes this one, and its MQL date stays as it was.
 */
function withLeadMql(
  summary: Record<string, unknown>,
  mql: AxLeadMql | undefined
): { mql?: AxLeadMql } {
  return mql ? { mql: mergeLeadMql(summary.mql, mql) } : {};
}

/** Lead responses after a consultation request (the flag, and the MQL judgement with it) */
export function withConsultation(
  responses: LeadResponses,
  mql: AxLeadMql
): Record<string, unknown> {
  const summary = axSummaryOf(responses);
  return {
    ...responsesOf(responses),
    axMigration: { ...summary, consultationRequested: true, ...withLeadMql(summary, mql) },
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

/**
 * Target company size ranges of the organization, from its sales playbook (#150).
 * A missing playbook or a stored value that no longer parses means "no condition".
 */
async function loadTargetCompany(
  database: Database | Transaction,
  organizationId: string
): Promise<AxTargetCompany | null> {
  const content = await readPlaybookContent(database, organizationId);
  const parsed = axTargetCompanySchema.safeParse(
    (content as { targetCompany?: unknown } | null)?.targetCompany
  );
  return parsed.success ? parsed.data : null;
}

/** The recommended Access path for the lead summary (#303); nothing for other systems */
function accessPathSummary(result: AxMigrationResult): { accessPath?: AxAccessPath } {
  return result.accessPath ? { accessPath: result.accessPath.path } : {};
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
    /** 適合 (kept under its first name for older readers) */
    mqlCandidate: result.mql.candidate,
    /** 適合 / 関心あり（MQL） and why (#139) */
    mql: toLeadMql(result.mql),
    companySizeFit: result.companySize.fit,
    sqlSignals: result.sqlSignals.candidate,
    needsHearing: result.needsHearing,
    consultationRequested: input.consultationRequested,
    platform: result.platform,
    ...accessPathSummary(result),
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
 * - Leads are matched and created by upsertLeadFromSubmission (shared with the builder's
 *   diagnoses), which serializes concurrent submissions for the same address.
 * - A lead it creates from a scan of a QR campaign counts for the campaign, in the same
 *   transaction (countQrCompletion, #700).
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
  const targetCompany = await loadTargetCompany(database, organizationId);
  const result = evaluateAxMigration(
    answers,
    AX_MIGRATION_CONFIG,
    now,
    { consultationRequested: input.consultationRequested },
    targetCompany
  );
  const tracking: Tracking = input.tracking ?? {};
  const email = input.contact.email.toLowerCase();

  return database.transaction(async (tx) => {
    // An issued agency link decides the inflow source over the UTM parameters (#147). Like every
    // value of newLead, it is used only when the submission creates the lead
    const inflow = await resolveInflow(tx, organizationId, tracking);

    const { leadId, existing } = await upsertLeadFromSubmission(tx, {
      organizationId,
      email,
      newLead: {
        name: input.contact.name,
        company: input.contact.company,
        phone: input.contact.phone || null,
        status: 'new',
        score: result.leadScore,
        source: 'website',
        inflowSource: inflow.inflowSource,
        referrerName: inflow.referrerName,
        agencyName: inflow.agencyName,
        agencyLinkId: inflow.agencyLinkId,
        conversionPoint: input.consultationRequested ? 'consultation' : 'web_diagnosis',
        targetSystem: result.targetSystem,
        // MQL date: only 関心あり (#139). 適合 alone leaves it empty
        mqlQualifiedAt: result.mql.qualified ? now : null,
      },
      now,
    });

    let continuedFrom: string | null = null;
    if (existing && input.continuedFrom) {
      continuedFrom = await findContinuationOrigin(
        tx,
        organizationId,
        existing.id,
        input.continuedFrom,
        now
      );
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
      .returning({ id: diagnosticSubmissions.id, isTest: diagnosticSubmissions.isTest });

    if (!existing) {
      await tx
        .update(leads)
        .set({ responses: { axMigration: buildLeadSummary(submission.id, result, input, now) } })
        .where(eq(leads.id, leadId));
    } else if (continuedFrom) {
      await recordOtherSystem(tx, leadId, submission.id, result, input.consultationRequested, now);
    }

    // A new lead from a scan of the organization's QR campaign counts for it, with the lead (#700)
    // A count that fails keeps the lead; the route reports it after the response
    const qrCompletion = await countQrCompletion(tx, {
      organizationId,
      leadCreated: !existing,
      isTest: submission.isTest,
      tracking,
    });

    return {
      ok: true as const,
      submissionId: submission.id,
      leadId,
      leadCreated: !existing,
      existingLead: existing
        ? { name: existing.name, company: existing.company, email: existing.email }
        : null,
      qrCompletionFailure: qrCompletion.failure,
      continued: continuedFrom !== null,
      // The employee whose link brought a new lead, to tell them (#265)
      referralMemberUserId: !existing ? inflow.referralMemberUserId : null,
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
    ...accessPathSummary(result),
  };
  await tx
    .update(leads)
    .set({
      responses: withOtherSystem(
        lead.responses,
        entry,
        consultationRequested,
        toLeadMql(result.mql)
      ),
      ...(consultationRequested ? { conversionPoint: 'consultation' } : {}),
      // MQL belongs to the lead: a system of interest makes it one, an earlier date stays
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
      /** When the consultation was requested: now, or the earlier request (#241) */
      requestedAt: Date;
    }
  | { ok: false; reason: 'not_found' | 'closed' }
> {
  return database.transaction(async (tx) => {
    // Only while the result screen can still be open (a day, the same rule as the builder's
    // diagnoses): a submission id seen later (or leaked) cannot place a request (#232, #481)
    const claim = await claimConsultation(tx, {
      submissionId,
      diagnosticKey: AX_MIGRATION_DIAGNOSTIC_KEY,
      now,
    });
    if (claim.status === 'not_found' || claim.status === 'closed') {
      return { ok: false as const, reason: claim.status };
    }
    const { submission } = claim;
    if (claim.status === 'already_requested') {
      return {
        ok: true as const,
        alreadyRequested: true,
        organizationId: submission.organizationId,
        leadId: submission.leadId,
        leadCreated: submission.leadCreated,
        continued: submission.continuedFromSubmissionId !== null,
        requestedAt: claim.requestedAt,
      };
    }
    const claimed = submission;

    // The request is a strong signal: the submission's judgement is redone with it (#139), so the
    // notification read from the stored result shows it
    const mql = withConsultationSignal(
      isPlainObject(claimed.result) ? claimed.result.mql : undefined,
      AX_MIGRATION_CONFIG.mql
    );
    if (isPlainObject(claimed.result)) {
      await tx
        .update(diagnosticSubmissions)
        .set({ result: { ...claimed.result, mql } })
        .where(eq(diagnosticSubmissions.id, submissionId));
    }

    const continued = claimed.continuedFromSubmissionId !== null;
    if (claimed.leadId && (claimed.leadCreated || continued)) {
      const [lead] = await tx
        .select({ responses: leads.responses, mqlQualifiedAt: leads.mqlQualifiedAt })
        .from(leads)
        .where(eq(leads.id, claimed.leadId))
        .for('no key update');
      if (lead) {
        await tx
          .update(leads)
          .set({
            conversionPoint: 'consultation',
            responses: withConsultation(lead.responses, toLeadMql(mql)),
            // MQL date only when there is none yet (a date set by marketing stays)
            ...(mql.qualified && !lead.mqlQualifiedAt ? { mqlQualifiedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(leads.id, claimed.leadId));
      }
    }

    return {
      ok: true as const,
      alreadyRequested: false,
      organizationId: claimed.organizationId,
      leadId: claimed.leadId,
      leadCreated: claimed.leadCreated,
      continued,
      requestedAt: now,
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

/** Points documents and seminars requested by the lead added to its score (#153) */
// Table names written out: drizzle leaves them off the columns of a single-table update, and the
// subquery's lead_id must not be read against the wrong table
const offerPointsSql = sql`(select coalesce(sum(r.score_points + r.attendance_points), 0)::int from lead_offer_requests r where r.lead_id = "leads"."id")`;

/**
 * Add the optional follow-up answers given after the result and evaluate again.
 * Only `detail` questions of the submission's path are accepted; the answers the result was
 * based on stay as submitted. The lead is updated only when this submission created it, or
 * (for another system of the same respondent) only that system's entry on the lead.
 * The follow-ups can raise the lead's MQL (e.g. the impact that qualifies the Access support
 * end, #292); like another system, they never lower it.
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
    const targetCompany = await loadTargetCompany(tx, submission.organizationId);
    const result = evaluateAxMigration(
      validation.answers,
      AX_MIGRATION_CONFIG,
      now,
      { consultationRequested: submission.consultationRequestedAt !== null },
      targetCompany
    );
    const previousScore = (submission.result as Partial<AxMigrationResult> | null)?.leadScore;

    await tx
      .update(diagnosticSubmissions)
      .set({
        answers: validation.answers,
        result: result as unknown as Record<string, unknown>,
      })
      .where(eq(diagnosticSubmissions.id, submissionId));

    if (submission.leadId && submission.leadCreated) {
      const [lead] = await tx
        .select({ responses: leads.responses, mqlQualifiedAt: leads.mqlQualifiedAt })
        .from(leads)
        .where(eq(leads.id, submission.leadId))
        .for('no key update');
      const summary = {
        difficulty: result.difficulty.level,
        urgency: result.urgency.level,
        needsHearing: result.needsHearing,
        ...accessPathSummary(result),
        detailsAnsweredAt: now.toISOString(),
        ...(lead ? withLeadMql(axSummaryOf(lead.responses), toLeadMql(result.mql)) : {}),
      };
      await tx
        .update(leads)
        .set({
          ...(lead && result.mql.qualified && !lead.mqlQualifiedAt ? { mqlQualifiedAt: now } : {}),
          // Keep a score sales have already changed. Documents and seminars requested from the
          // result (#153) added their points on top: those are not a change by sales
          score:
            typeof previousScore === 'number'
              ? sql`case when ${leads.score} = ${previousScore} + ${offerPointsSql} then least(100, ${result.leadScore} + ${offerPointsSql}) else ${leads.score} end`
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
        .select({ responses: leads.responses, mqlQualifiedAt: leads.mqlQualifiedAt })
        .from(leads)
        .where(eq(leads.id, submission.leadId))
        .for('no key update');
      const updated =
        lead &&
        withOtherSystemUpdate(lead.responses, submissionId, {
          difficulty: result.difficulty.level,
          urgency: result.urgency.level,
          needsHearing: result.needsHearing,
          ...accessPathSummary(result),
          detailsAnsweredAt: now.toISOString(),
        });
      if (lead && updated) {
        const summary = axSummaryOf(updated);
        const responses = {
          ...updated,
          axMigration: { ...summary, ...withLeadMql(summary, toLeadMql(result.mql)) },
        };
        await tx
          .update(leads)
          .set({
            responses,
            ...(result.mql.qualified && !lead.mqlQualifiedAt ? { mqlQualifiedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(leads.id, submission.leadId));
      }
    }

    return { ok: true as const, result };
  });
}
