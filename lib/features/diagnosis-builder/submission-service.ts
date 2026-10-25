/**
 * Submissions of published builder diagnoses (Refs #116)
 *
 * Same rules as the AX diagnosis (lib/features/diagnostics/ax-migration/submission-service.ts;
 * the shared ones are in lib/features/diagnostics/service.ts, #481):
 * - Scores come from the definition of the answered version, computed here; points, scores or
 *   results sent by the respondent are not part of the schema and never read.
 * - The endpoint is unauthenticated: a lead with the same email address is never changed, the
 *   submission is only linked to it (upsertLeadFromSubmission). Only a lead created by this
 *   submission gets the diagnosis values (score, MQL, summary).
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  type DiagnosticSubmissionConsent,
  diagnosisVersions,
  diagnosticSubmissions,
  leads,
} from '@/lib/db/schema';
import { and, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import { upsertLeadFromSubmission } from '../diagnostics/lead-upsert';
import { claimConsultation, resolveInflow } from '../diagnostics/service';
import { type Tracking, compactTracking, trackingSchema } from '../diagnostics/tracking';
import type { AnswerValidationIssue } from '../diagnostics/types';
import { contactSchema } from '../diagnostics/types/contact';
import { type ValidatedAnswers, validateDiagnosisAnswers } from './answers';
import type { DiagnosisDefinition } from './definition';
import {
  type DiagnosisEvaluation,
  type DiagnosisMqlLevel,
  evaluate,
  withConsultationSignal,
} from './evaluate';
import {
  DIAGNOSIS_SUBMISSION_KEY_PREFIX,
  type PublicDiagnosis,
  type PublicDiagnosisVersion,
  diagnosisSubmissionKey,
} from './public-diagnosis';

type Database = typeof defaultDb;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the respondent's browser sends. Anything else in the body is dropped by the parse */
export const diagnosisSubmissionSchema = z.object({
  /** The published version the questions came from (see resolveSubmittedVersion) */
  versionId: z.string().uuid(),
  answers: z.record(z.unknown()),
  contact: contactSchema,
  privacyConsent: z.literal(true),
  /** consent.version of the definition shown to the respondent */
  consentVersion: z.string().trim().min(1).max(40),
  consultationRequested: z.boolean().default(false),
  tracking: trackingSchema,
  locale: z.enum(['ja', 'en']).default('ja'),
  /** Honeypot: people never fill it. The route answers a filled one with a fake success */
  website: z.string().max(500).optional(),
  /** Cloudflare Turnstile token: required for builder diagnoses (checked by the route) */
  turnstileToken: z.string().max(2048).optional(),
});
export type DiagnosisSubmissionInput = z.infer<typeof diagnosisSubmissionSchema>;

/** The existing lead as stored in the DB (never taken from the unauthenticated request) */
export interface ExistingLeadSnapshot {
  name: string | null;
  company: string | null;
  email: string;
}

export type DiagnosisSubmitOutcome =
  | {
      ok: true;
      submissionId: string;
      leadId: string;
      leadCreated: boolean;
      existingLead: ExistingLeadSnapshot | null;
      /** The employee whose own link brought the new lead, to tell them (#265) */
      referralMemberUserId: string | null;
      evaluation: DiagnosisEvaluation;
    }
  | { ok: false; issues: AnswerValidationIssue[] };

/** Name of the result type reached, from the definition */
export function resultTypeName(
  definition: DiagnosisDefinition,
  evaluation: Pick<DiagnosisEvaluation, 'resultTypeId'>
): string | null {
  return definition.resultTypes.find((t) => t.id === evaluation.resultTypeId)?.name ?? null;
}

/**
 * Why the respondent is (or is not) an MQL, as text for sales: the strong signals' own texts
 * and the score against the minimum. Reasons why the lead does not qualify are left out.
 */
export function mqlReasonTexts(
  definition: DiagnosisDefinition,
  evaluation: Pick<DiagnosisEvaluation, 'mql' | 'leadScore'>
): string[] {
  if (!evaluation.mql.qualified) return [];
  return evaluation.mql.reasons.flatMap((reason) => {
    if (reason.code === 'consultation') return ['相談申込'];
    if (reason.code === 'strong_signal') return [reason.reason];
    if (reason.code === 'min_score_reached') {
      return [
        `リードスコア ${evaluation.leadScore.points} 点（基準 ${definition.mql.minScore ?? 0} 点以上）`,
      ];
    }
    return [];
  });
}

/** Summary kept on a lead created by a builder diagnosis (for the lead page) */
export interface DiagnosisLeadSummary {
  diagnosisId: string;
  slug: string;
  title: string;
  version: number;
  versionId: string;
  submissionId: string;
  diagnosedAt: string;
  resultTypeId: string | null;
  resultTypeName: string | null;
  overall: number;
  leadScore: number;
  /** Texts of the matched lead score rules */
  leadScoreReasons: string[];
  /** 関心あり（MQL） / 適合 / 対象外, the same levels as the AX diagnosis (#139) */
  mqlLevel: DiagnosisMqlLevel;
  mqlQualified: boolean;
  mqlReasons: string[];
  consultationRequested: boolean;
}

/** Key of the summary in leads.responses */
export const DIAGNOSIS_LEAD_RESPONSES_KEY = 'diagnosis';

function buildLeadSummary(
  diagnosis: PublicDiagnosis,
  version: PublicDiagnosisVersion,
  submissionId: string,
  evaluation: DiagnosisEvaluation,
  consultationRequested: boolean,
  now: Date
): DiagnosisLeadSummary {
  return {
    diagnosisId: diagnosis.id,
    slug: diagnosis.slug,
    title: version.definition.title,
    version: version.version,
    versionId: version.id,
    submissionId,
    diagnosedAt: now.toISOString(),
    resultTypeId: evaluation.resultTypeId,
    resultTypeName: resultTypeName(version.definition, evaluation),
    overall: evaluation.overall,
    leadScore: evaluation.leadScore.points,
    leadScoreReasons: evaluation.leadScore.reasons,
    mqlLevel: evaluation.mql.level,
    mqlQualified: evaluation.mql.qualified,
    mqlReasons: mqlReasonTexts(version.definition, evaluation),
    consultationRequested,
  };
}

/**
 * Save a submission of a published builder diagnosis and link it to a lead.
 * The organization is the diagnosis' own; the version is the one resolveSubmittedVersion
 * accepted. The full evaluation (lead score, MQL and their reasons) is stored with the
 * submission for the lead page; the respondent only gets toPublicResult of it.
 */
export async function submitBuilderDiagnosis(
  database: Database,
  diagnosis: PublicDiagnosis,
  version: PublicDiagnosisVersion,
  input: DiagnosisSubmissionInput,
  now: Date = new Date()
): Promise<DiagnosisSubmitOutcome> {
  const definition = version.definition;
  const validation = validateDiagnosisAnswers(definition, input.answers);
  if (!validation.success) return { ok: false, issues: validation.issues };
  const answers: ValidatedAnswers = validation.answers;
  const scored = evaluate(definition, answers);
  // A consultation request is a strong signal (as in the AX diagnosis, #139)
  const evaluation: DiagnosisEvaluation = input.consultationRequested
    ? { ...scored, mql: withConsultationSignal(scored.mql) }
    : scored;
  const tracking: Tracking = input.tracking ?? {};
  const organizationId = diagnosis.organizationId;
  const consent: DiagnosticSubmissionConsent = {
    // The version the server serves, not whatever the browser says it showed
    version: definition.consent?.version ?? input.consentVersion,
    agreedAt: now.toISOString(),
  };

  return database.transaction(async (tx) => {
    // An issued agency link of the organization decides the inflow source over the UTM
    // parameters, as in the AX diagnosis (#147, #481). Used only when the submission creates the
    // lead, like every value of newLead
    const inflow = await resolveInflow(tx, organizationId, tracking);
    const { leadId, existing } = await upsertLeadFromSubmission(tx, {
      organizationId,
      email: input.contact.email,
      newLead: {
        name: input.contact.name,
        company: input.contact.company,
        phone: input.contact.phone || null,
        status: 'new',
        score: evaluation.leadScore.points,
        source: 'website',
        inflowSource: inflow.inflowSource,
        referrerName: inflow.referrerName,
        // A ref code with an agency medium is the agency's name (#147)
        agencyName: inflow.agencyName,
        agencyLinkId: inflow.agencyLinkId,
        conversionPoint: input.consultationRequested ? 'consultation' : 'web_diagnosis',
        // MQL date: only 関心あり (#139); 適合 alone leaves it empty
        mqlQualifiedAt: evaluation.mql.qualified ? now : null,
      },
      now,
    });

    const [submission] = await tx
      .insert(diagnosticSubmissions)
      .values({
        organizationId,
        leadId,
        leadCreated: !existing,
        diagnosticKey: diagnosisSubmissionKey(diagnosis.id),
        diagnosticVersion: version.version,
        diagnosisVersionId: version.id,
        // Builder answers may also be numbers (scale, number_range); the column is JSON
        answers: { ...answers } as unknown as Record<string, string | string[]>,
        result: evaluation as unknown as Record<string, unknown>,
        tracking: compactTracking(tracking),
        locale: input.locale,
        consent,
        consultationRequestedAt: input.consultationRequested ? now : null,
        createdAt: now,
      })
      .returning({ id: diagnosticSubmissions.id });

    if (!existing) {
      const summary = buildLeadSummary(
        diagnosis,
        version,
        submission.id,
        evaluation,
        input.consultationRequested,
        now
      );
      await tx
        .update(leads)
        .set({ responses: { [DIAGNOSIS_LEAD_RESPONSES_KEY]: summary } })
        .where(eq(leads.id, leadId));
    }

    return {
      ok: true as const,
      submissionId: submission.id,
      leadId,
      leadCreated: !existing,
      existingLead: existing
        ? { name: existing.name, company: existing.company, email: existing.email }
        : null,
      referralMemberUserId: !existing ? inflow.referralMemberUserId : null,
      evaluation,
    };
  });
}

export type DiagnosisConsultationOutcome =
  | {
      ok: true;
      alreadyRequested: boolean;
      organizationId: string;
      leadId: string | null;
      leadCreated: boolean;
      /** When the consultation was requested: now, or the earlier request (#241) */
      requestedAt: Date;
    }
  | { ok: false; reason: 'not_found' | 'closed' };

/**
 * Record a consultation request made from the result page of a builder diagnosis.
 * Exactly one concurrent request wins (conditional UPDATE), so sales is notified once.
 * The lead is updated only when this submission created it (as in the AX diagnosis).
 */
export async function requestBuilderConsultation(
  database: Database,
  diagnosisId: string,
  submissionId: string,
  now: Date = new Date()
): Promise<DiagnosisConsultationOutcome> {
  return database.transaction(async (tx) => {
    // Only while the result screen can still be open: a day after the answer, as in the AX
    // diagnosis (#232, #481); test answers of the preview never take a request
    const claim = await claimConsultation(tx, {
      submissionId,
      diagnosticKey: diagnosisSubmissionKey(diagnosisId),
      now,
    });
    if (claim.status === 'not_found' || claim.status === 'closed') {
      return { ok: false as const, reason: claim.status };
    }
    const claimed = claim.submission;
    if (claim.status === 'already_requested') {
      return {
        ok: true as const,
        alreadyRequested: true,
        organizationId: claimed.organizationId,
        leadId: claimed.leadId,
        leadCreated: claimed.leadCreated,
        requestedAt: claim.requestedAt,
      };
    }

    // The request is a strong signal: the stored judgement is redone with it (#139), so the
    // notification and the lead page read it from the submission
    const evaluation = claimed.result as unknown as DiagnosisEvaluation;
    const mql = withConsultationSignal(evaluation.mql);
    await tx
      .update(diagnosticSubmissions)
      .set({ result: { ...claimed.result, mql } })
      .where(eq(diagnosticSubmissions.id, submissionId));

    if (claimed.leadId && claimed.leadCreated) {
      const [version] = claimed.diagnosisVersionId
        ? await tx
            .select({ definition: diagnosisVersions.definition })
            .from(diagnosisVersions)
            .where(eq(diagnosisVersions.id, claimed.diagnosisVersionId))
        : [];
      const [lead] = await tx
        .select({ responses: leads.responses, mqlQualifiedAt: leads.mqlQualifiedAt })
        .from(leads)
        .where(eq(leads.id, claimed.leadId))
        .for('no key update');
      if (lead) {
        const responses = isPlainObject(lead.responses) ? lead.responses : {};
        const summary = isPlainObject(responses[DIAGNOSIS_LEAD_RESPONSES_KEY])
          ? responses[DIAGNOSIS_LEAD_RESPONSES_KEY]
          : {};
        await tx
          .update(leads)
          .set({
            conversionPoint: 'consultation',
            responses: {
              ...responses,
              [DIAGNOSIS_LEAD_RESPONSES_KEY]: {
                ...summary,
                consultationRequested: true,
                mqlLevel: mql.level,
                mqlQualified: mql.qualified,
                ...(version
                  ? { mqlReasons: mqlReasonTexts(version.definition, { ...evaluation, mql }) }
                  : {}),
              },
            },
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
      requestedAt: now,
    };
  });
}

/** A builder submission with the definition of its version (for a notification after the fact) */
export async function findBuilderSubmission(database: Database, submissionId: string) {
  const [row] = await database
    .select({
      id: diagnosticSubmissions.id,
      result: diagnosticSubmissions.result,
      definition: diagnosisVersions.definition,
    })
    .from(diagnosticSubmissions)
    .innerJoin(
      diagnosisVersions,
      eq(diagnosisVersions.id, diagnosticSubmissions.diagnosisVersionId)
    )
    .where(
      and(
        eq(diagnosticSubmissions.id, submissionId),
        like(diagnosticSubmissions.diagnosticKey, `${DIAGNOSIS_SUBMISSION_KEY_PREFIX}%`)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    evaluation: row.result as unknown as DiagnosisEvaluation,
    definition: row.definition,
  };
}
