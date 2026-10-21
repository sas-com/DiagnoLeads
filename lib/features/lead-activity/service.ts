/**
 * Lead activity timeline (Refs #101)
 *
 * Built from records that already exist; there is no table of its own. Every query is scoped by
 * organizationId AND leadId, and the lead must belong to the organization (NOT_FOUND
 * otherwise). Permission checks are done by the router.
 *
 * Where each kind comes from:
 * - lead_created: leads.created_at. Source "web_diagnosis" when a diagnosis submission created
 *   the lead, "staff" / "import" when an audit 'create' row exists (its actor), else "other"
 * - diagnosis_submitted: one per diagnostic_submissions row of the lead, whatever the identity.
 *   verified = it created the lead or continued (same screen) the submission that did (#67);
 *   other submissions with the same email address are shown as unverified
 * - consultation_requested: always its own event at consultation_requested_at, also when it was
 *   requested with the form (withSubmission = same moment as the submission)
 * - details_answered: its own event only when the time was recorded, which the diagnosis does
 *   on the lead for verified submissions (responses.axMigration[.otherSystems].detailsAnsweredAt).
 *   For the others the diagnosis event only says the follow-ups were answered
 * - hearing_recorded / hearing_updated: lead_hearings created_at / updated_at (only the latest
 *   update is known)
 * - comment: lead_comments of every type
 * - lead_updated: audit_logs 'update' rows of the lead (changed fields only, with the actor)
 * - contact_recorded: lead_contact_logs ("called", "emailed", "could not reach", #136); the
 *   earliest one is marked as the first contact
 * - mql_qualified / sql_decided / phase_reached: from the lead's own date columns, unless an
 *   audit row records the same change (MQL / SQL: an audit row with that value at exactly that
 *   time; phase: an audit row setting that phase on that day in Japan). Those are shown as
 *   lead_updated instead, so a judgement is never listed twice
 *
 * A lead has few events, so each source's newest rows (up to PER_SOURCE_LIMIT) are merged and
 * paginated in memory: newest first, ties broken by the event id (descending).
 */

import type { db as defaultDb } from '@/lib/db/client';
import {
  auditLogs,
  diagnosisVersions,
  diagnosticSubmissions,
  leadComments,
  leadContactLogs,
  leadHearings,
  leads,
  users,
} from '@/lib/db/schema';
import type { DiagnosisDefinition } from '@/lib/features/diagnosis-builder/definition';
import { DIAGNOSIS_SUBMISSION_KEY_PREFIX } from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  AX_MIGRATION_DIAGNOSTIC_KEY,
  axMigrationDefinition,
} from '@/lib/features/diagnostics/ax-migration/definition';
import type { LocalizedText } from '@/lib/features/diagnostics/types';
import {
  AUDITED_LEAD_FIELDS,
  LEAD_AUDIT_RESOURCE,
  type LeadAuditValue,
} from '@/lib/features/leads/audit';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  BuilderDiagnosisSummary,
  DiagnosisIdentity,
  DiagnosisMqlLevelView,
  DiagnosisSummary,
  LeadActivityActor,
  LeadActivityCursor,
  LeadActivityEvent,
  LeadActivityKind,
  LeadActivityPage,
  LeadFieldChange,
  SubmissionAnswerView,
} from './types/schemas';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

/** Newest rows read from each source (a lead has far fewer) */
export const PER_SOURCE_LIMIT = 1000;
const COMMENT_EXCERPT_LENGTH = 200;

const notFound = (what: 'lead' | 'submission') =>
  new TRPCError({ code: 'NOT_FOUND', message: `The ${what} was not found` });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const stringOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

async function findLead(db: Executor, organizationId: string, leadId: string) {
  const [lead] = await db
    .select({
      id: leads.id,
      source: leads.source,
      responses: leads.responses,
      mqlQualifiedAt: leads.mqlQualifiedAt,
      sqlDecision: leads.sqlDecision,
      sqlDecidedAt: leads.sqlDecidedAt,
      dealPhaseReachedAt: leads.dealPhaseReachedAt,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  if (!lead) throw notFound('lead');
  return lead;
}

/** The version a builder submission answered (same organization only) */
const submissionVersion = and(
  eq(diagnosisVersions.id, diagnosticSubmissions.diagnosisVersionId),
  eq(diagnosisVersions.organizationId, diagnosticSubmissions.organizationId)
);

/** Follow-up questions asked after the AX result */
const AX_DETAIL_QUESTION_IDS = new Set(
  axMigrationDefinition.questions.filter((q) => q.detail).map((q) => q.id)
);

function identityOf(row: {
  id: string;
  leadCreated: boolean;
  continuedFromSubmissionId: string | null;
}): DiagnosisIdentity {
  const continuation = row.continuedFromSubmissionId != null;
  return { submissionId: row.id, verified: row.leadCreated || continuation, continuation };
}

const COMPANY_SIZE_FITS = ['fit', 'not_fit', 'unknown', 'not_configured'] as const;

function companySizeFitOf(mql: unknown): DiagnosisSummary['companySizeFit'] {
  const criteria = isPlainObject(mql) && isPlainObject(mql.criteria) ? mql.criteria : {};
  // A path that takes any size (Access, #292): no size badge, the size is not a condition there
  if (isPlainObject(mql) && Array.isArray(mql.waived) && mql.waived.includes('company_size')) {
    return null;
  }
  const fit = criteria.companySize;
  return COMPANY_SIZE_FITS.find((value) => value === fit) ?? null;
}

const MQL_LEVELS: readonly string[] = ['interest', 'fit', 'none'];

export const isBuilderDiagnosisKey = (key: string) =>
  key.startsWith(DIAGNOSIS_SUBMISSION_KEY_PREFIX);

/** The answered version of a builder submission, as far as the timeline needs it */
export interface BuilderVersionInfo {
  title: string | null;
  /** definition.resultTypes as stored (read defensively) */
  resultTypes: unknown;
}

function builderSummaryOf(
  version: number,
  result: Record<string, unknown>,
  info: BuilderVersionInfo | null
): BuilderDiagnosisSummary {
  const resultTypeId = stringOrNull(result.resultTypeId);
  const types = Array.isArray(info?.resultTypes) ? info.resultTypes.filter(isPlainObject) : [];
  const resultType = resultTypeId ? types.find((t) => t.id === resultTypeId) : undefined;
  const leadScore = isPlainObject(result.leadScore) ? result.leadScore.points : null;
  return {
    title: info?.title ?? null,
    version,
    resultTypeName: resultType ? stringOrNull(resultType.name) : null,
    leadScore: typeof leadScore === 'number' ? leadScore : null,
  };
}

function summaryOf(
  row: {
    diagnosticKey: string;
    diagnosticVersion?: number;
    answers: Record<string, unknown>;
    result: Record<string, unknown>;
  },
  builderVersion: BuilderVersionInfo | null = null
): DiagnosisSummary {
  const result = isPlainObject(row.result) ? row.result : {};
  const answers = isPlainObject(row.answers) ? row.answers : {};
  const level = (value: unknown) => (isPlainObject(value) ? stringOrNull(value.level) : null);
  const challenges = isPlainObject(result.challenges) ? result.challenges : {};
  const mqlLevel = level(result.mql);
  return {
    diagnosticKey: row.diagnosticKey,
    platform: stringOrNull(result.platform) ?? stringOrNull(answers.platform),
    difficulty: level(result.difficulty),
    urgency: level(result.urgency),
    primaryChallenge: stringOrNull(challenges.primary),
    needsHearing: result.needsHearing === true,
    companySizeFit: companySizeFitOf(result.mql),
    detailsAnswered:
      row.diagnosticKey === AX_MIGRATION_DIAGNOSTIC_KEY &&
      Object.keys(answers).some((id) => AX_DETAIL_QUESTION_IDS.has(id)),
    ...(mqlLevel && MQL_LEVELS.includes(mqlLevel)
      ? { mqlLevel: mqlLevel as DiagnosisMqlLevelView }
      : {}),
    ...(isBuilderDiagnosisKey(row.diagnosticKey)
      ? { builder: builderSummaryOf(row.diagnosticVersion ?? 0, result, builderVersion) }
      : {}),
  };
}

/** When the follow-ups were answered, as recorded on the lead (verified submissions only) */
function detailsAnsweredTimes(responses: unknown): Map<string, Date> {
  const times = new Map<string, Date>();
  const summary = isPlainObject(responses) ? responses.axMigration : null;
  if (!isPlainObject(summary)) return times;
  const add = (entry: unknown) => {
    if (!isPlainObject(entry)) return;
    const id = stringOrNull(entry.submissionId);
    const at = stringOrNull(entry.detailsAnsweredAt);
    const date = at ? new Date(at) : null;
    if (id && date && !Number.isNaN(date.getTime())) times.set(id, date);
  };
  add(summary);
  if (Array.isArray(summary.otherSystems)) summary.otherSystems.forEach(add);
  return times;
}

const auditValuesOf = (changes: unknown, side: 'before' | 'after') => {
  const values = isPlainObject(changes) ? changes[side] : null;
  return isPlainObject(values) ? values : {};
};

function changeListOf(changes: unknown): LeadFieldChange[] {
  const before = auditValuesOf(changes, 'before');
  const after = auditValuesOf(changes, 'after');
  const known = AUDITED_LEAD_FIELDS as readonly string[];
  const fields = [
    ...known.filter((field) => field in after || field in before),
    ...Object.keys(after).filter((field) => !known.includes(field)),
  ];
  const value = (v: unknown): LeadAuditValue =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
  return fields.map((field) => ({
    field,
    before: value(before[field]),
    after: value(after[field]),
  }));
}

/** Newest first; the id breaks ties so pages never overlap */
function compareEvents(a: LeadActivityEvent, b: LeadActivityEvent): number {
  const diff = b.at.getTime() - a.at.getTime();
  if (diff !== 0) return diff;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function isAfterCursor(event: LeadActivityEvent, cursor: LeadActivityCursor): boolean {
  const at = event.at.getTime();
  const cursorAt = cursor.at.getTime();
  return at < cursorAt || (at === cursorAt && event.id < cursor.id);
}

/** Midnight in Japan of a 'YYYY-MM-DD' date */
const jstMidnight = (date: string) => new Date(`${date}T00:00:00+09:00`);

export async function listLeadActivities(
  db: Executor,
  input: {
    organizationId: string;
    leadId: string;
    types?: LeadActivityKind[];
    limit: number;
    cursor?: LeadActivityCursor | null;
  }
): Promise<LeadActivityPage> {
  const { organizationId, leadId } = input;
  const lead = await findLead(db, organizationId, leadId);

  const [submissions, hearings, comments, audits, contacts] = await Promise.all([
    db
      .select({
        id: diagnosticSubmissions.id,
        diagnosticKey: diagnosticSubmissions.diagnosticKey,
        diagnosticVersion: diagnosticSubmissions.diagnosticVersion,
        leadCreated: diagnosticSubmissions.leadCreated,
        continuedFromSubmissionId: diagnosticSubmissions.continuedFromSubmissionId,
        consultationRequestedAt: diagnosticSubmissions.consultationRequestedAt,
        answers: diagnosticSubmissions.answers,
        result: diagnosticSubmissions.result,
        createdAt: diagnosticSubmissions.createdAt,
        // Builder diagnoses: only the parts of the answered version the timeline shows
        versionTitle: sql<string | null>`${diagnosisVersions.definition}->>'title'`,
        versionResultTypes: sql<unknown>`${diagnosisVersions.definition}->'resultTypes'`,
      })
      .from(diagnosticSubmissions)
      .leftJoin(diagnosisVersions, submissionVersion)
      .where(
        and(
          eq(diagnosticSubmissions.organizationId, organizationId),
          eq(diagnosticSubmissions.leadId, leadId)
        )
      )
      .orderBy(desc(diagnosticSubmissions.createdAt))
      .limit(PER_SOURCE_LIMIT),
    db
      .select({
        id: leadHearings.id,
        heldOn: leadHearings.heldOn,
        createdBy: leadHearings.createdBy,
        updatedBy: leadHearings.updatedBy,
        createdAt: leadHearings.createdAt,
        updatedAt: leadHearings.updatedAt,
      })
      .from(leadHearings)
      .where(and(eq(leadHearings.organizationId, organizationId), eq(leadHearings.leadId, leadId)))
      .orderBy(desc(leadHearings.updatedAt))
      .limit(PER_SOURCE_LIMIT),
    db
      .select({
        id: leadComments.id,
        type: leadComments.type,
        excerpt: sql<string>`left(${leadComments.content}, ${COMMENT_EXCERPT_LENGTH})`,
        parentId: leadComments.parentId,
        userId: leadComments.userId,
        createdAt: leadComments.createdAt,
      })
      .from(leadComments)
      .where(and(eq(leadComments.organizationId, organizationId), eq(leadComments.leadId, leadId)))
      .orderBy(desc(leadComments.createdAt))
      .limit(PER_SOURCE_LIMIT),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        userId: auditLogs.userId,
        changes: auditLogs.changes,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, organizationId),
          eq(auditLogs.resource, LEAD_AUDIT_RESOURCE),
          eq(auditLogs.resourceId, leadId),
          inArray(auditLogs.action, ['create', 'update'])
        )
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(PER_SOURCE_LIMIT),
    db
      .select({
        id: leadContactLogs.id,
        kind: leadContactLogs.kind,
        note: leadContactLogs.note,
        createdBy: leadContactLogs.createdBy,
        contactedAt: leadContactLogs.contactedAt,
      })
      .from(leadContactLogs)
      .where(
        and(eq(leadContactLogs.organizationId, organizationId), eq(leadContactLogs.leadId, leadId))
      )
      .orderBy(desc(leadContactLogs.contactedAt), desc(leadContactLogs.id))
      .limit(PER_SOURCE_LIMIT),
  ]);

  // Staff names, only for the people who did something on this lead
  const userIds = new Set<string>();
  for (const row of hearings) {
    if (row.createdBy) userIds.add(row.createdBy);
    if (row.updatedBy) userIds.add(row.updatedBy);
  }
  for (const row of comments) if (row.userId) userIds.add(row.userId);
  for (const row of audits) if (row.userId) userIds.add(row.userId);
  for (const row of contacts) if (row.createdBy) userIds.add(row.createdBy);
  const people =
    userIds.size === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, [...userIds]));
  const names = new Map(people.map((p) => [p.id, p.name?.trim() || p.email]));
  const actor = (id: string | null): LeadActivityActor | null =>
    id && names.has(id) ? { id, name: names.get(id) as string } : null;
  // Comments, hearings and lead audit rows are only written with the signed-in user's id, so a
  // null author there means the account was deleted (#164)
  const staffActor = (id: string | null): LeadActivityActor | null =>
    id === null ? { id: null, name: null, deleted: true } : actor(id);

  const events: LeadActivityEvent[] = [];

  // Lead creation
  const createAudit = audits.find((row) => row.action === 'create');
  const createdByDiagnosis = submissions.some((row) => row.leadCreated);
  events.push({
    id: `lead:${lead.id}:created`,
    kind: 'lead_created',
    at: lead.createdAt,
    actor: createAudit ? staffActor(createAudit.userId) : null,
    source: createdByDiagnosis
      ? 'web_diagnosis'
      : createAudit
        ? isPlainObject(createAudit.metadata) && createAudit.metadata.via === 'import'
          ? 'import'
          : 'staff'
        : 'other',
    channel: lead.source,
  });

  // Diagnoses, consultations and follow-up answers
  const detailsTimes = detailsAnsweredTimes(lead.responses);
  for (const row of submissions) {
    const identity = identityOf(row);
    events.push({
      id: `submission:${row.id}`,
      kind: 'diagnosis_submitted',
      at: row.createdAt,
      actor: null,
      ...identity,
      summary: summaryOf(
        row,
        isBuilderDiagnosisKey(row.diagnosticKey)
          ? { title: row.versionTitle, resultTypes: row.versionResultTypes }
          : null
      ),
    });
    if (row.consultationRequestedAt) {
      events.push({
        id: `submission:${row.id}:consultation`,
        kind: 'consultation_requested',
        at: row.consultationRequestedAt,
        actor: null,
        ...identity,
        withSubmission: row.consultationRequestedAt.getTime() === row.createdAt.getTime(),
      });
    }
    const detailsAt = identity.verified ? detailsTimes.get(row.id) : undefined;
    if (detailsAt) {
      events.push({
        id: `submission:${row.id}:details`,
        kind: 'details_answered',
        at: detailsAt,
        actor: null,
        ...identity,
      });
    }
  }

  // Hearings
  for (const row of hearings) {
    events.push({
      id: `hearing:${row.id}:created`,
      kind: 'hearing_recorded',
      at: row.createdAt,
      actor: staffActor(row.createdBy),
      hearingId: row.id,
      heldOn: row.heldOn,
    });
    if (row.updatedAt.getTime() > row.createdAt.getTime()) {
      events.push({
        id: `hearing:${row.id}:updated`,
        kind: 'hearing_updated',
        at: row.updatedAt,
        actor: staffActor(row.updatedBy),
        hearingId: row.id,
        heldOn: row.heldOn,
      });
    }
  }

  // Comments
  for (const row of comments) {
    events.push({
      id: `comment:${row.id}`,
      kind: 'comment',
      at: row.createdAt,
      actor: staffActor(row.userId),
      commentId: row.id,
      commentType: row.type,
      excerpt: row.excerpt,
      isReply: row.parentId != null,
    });
  }

  // Staff updates
  for (const row of audits) {
    if (row.action !== 'update') continue;
    const changes = changeListOf(row.changes);
    if (changes.length === 0) continue;
    events.push({
      id: `audit:${row.id}`,
      kind: 'lead_updated',
      at: row.createdAt,
      actor: staffActor(row.userId),
      changes,
    });
  }

  // Contact records (newest first, so the last one read is the first contact)
  contacts.forEach((row, index) => {
    events.push({
      id: `contact:${row.id}`,
      kind: 'contact_recorded',
      at: row.contactedAt,
      actor: actor(row.createdBy),
      contactId: row.id,
      contactKind: row.kind as 'call' | 'email' | 'no_answer',
      note: row.note,
      first: index === contacts.length - 1 && contacts.length < PER_SOURCE_LIMIT,
    });
  });

  // Dates on the lead, unless an audit row already shows the same change
  const recorded = (match: (after: Record<string, unknown>, at: Date) => boolean) =>
    audits.some((row) => match(auditValuesOf(row.changes, 'after'), row.createdAt));
  const mqlAt = lead.mqlQualifiedAt;
  if (
    mqlAt &&
    !recorded((after, at) => after.mqlQualified === true && at.getTime() === mqlAt.getTime())
  ) {
    events.push({ id: `lead:${lead.id}:mql`, kind: 'mql_qualified', at: mqlAt, actor: null });
  }
  const sqlAt = lead.sqlDecidedAt;
  if (
    sqlAt &&
    lead.sqlDecision &&
    !recorded(
      (after, at) => after.sqlDecision === lead.sqlDecision && at.getTime() === sqlAt.getTime()
    )
  ) {
    events.push({
      id: `lead:${lead.id}:sql`,
      kind: 'sql_decided',
      at: sqlAt,
      actor: null,
      decision: lead.sqlDecision,
    });
  }
  const phases = isPlainObject(lead.dealPhaseReachedAt) ? lead.dealPhaseReachedAt : {};
  for (const [phase, date] of Object.entries(phases)) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (recorded((after, at) => after.dealPhase === phase && jstDate(at) === date)) continue;
    events.push({
      id: `lead:${lead.id}:phase:${phase}`,
      kind: 'phase_reached',
      at: jstMidnight(date),
      actor: null,
      phase,
      dateOnly: true,
    });
  }

  const wanted = input.types ? new Set<LeadActivityKind>(input.types) : null;
  const cursor = input.cursor;
  const remaining = events
    .filter((event) => !wanted || wanted.has(event.kind))
    .filter((event) => !cursor || isAfterCursor(event, cursor))
    .sort(compareEvents);
  const items = remaining.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: remaining.length > input.limit && last ? { at: last.at, id: last.id } : null,
  };
}

const rawText = (value: string): LocalizedText => ({ ja: value, en: value });

/** One diagnosis submission of the lead with its answers labelled for display */
export async function getSubmissionAnswers(
  db: Executor,
  input: { organizationId: string; leadId: string; submissionId: string }
) {
  await findLead(db, input.organizationId, input.leadId);
  const [row] = await db
    .select({
      id: diagnosticSubmissions.id,
      diagnosticKey: diagnosticSubmissions.diagnosticKey,
      diagnosticVersion: diagnosticSubmissions.diagnosticVersion,
      leadCreated: diagnosticSubmissions.leadCreated,
      continuedFromSubmissionId: diagnosticSubmissions.continuedFromSubmissionId,
      consultationRequestedAt: diagnosticSubmissions.consultationRequestedAt,
      answers: diagnosticSubmissions.answers,
      result: diagnosticSubmissions.result,
      createdAt: diagnosticSubmissions.createdAt,
      // Builder diagnoses are labelled from the version answered, never the current draft
      builderDefinition: diagnosisVersions.definition,
    })
    .from(diagnosticSubmissions)
    .leftJoin(diagnosisVersions, submissionVersion)
    .where(
      and(
        eq(diagnosticSubmissions.id, input.submissionId),
        eq(diagnosticSubmissions.organizationId, input.organizationId),
        eq(diagnosticSubmissions.leadId, input.leadId)
      )
    )
    .limit(1);
  if (!row) throw notFound('submission');

  const answers = isPlainObject(row.answers) ? row.answers : {};
  const builder = isBuilderDiagnosisKey(row.diagnosticKey);
  const view = builder
    ? builderAnswerView(answers, row.builderDefinition)
    : axAnswerView(row.diagnosticKey, answers);

  return {
    ...identityOf(row),
    diagnosticKey: row.diagnosticKey,
    diagnosticVersion: row.diagnosticVersion,
    submittedAt: row.createdAt,
    consultationRequestedAt: row.consultationRequestedAt,
    summary: summaryOf(
      row,
      builder
        ? {
            title: row.builderDefinition?.title ?? null,
            resultTypes: row.builderDefinition?.resultTypes ?? null,
          }
        : null
    ),
    answers: view,
  };
}

/** Questions in the order of the definition, then anything it no longer knows */
function orderedIds(questionIds: string[], answers: Record<string, unknown>): string[] {
  return [
    ...questionIds.filter((id) => id in answers),
    ...Object.keys(answers).filter((id) => !questionIds.includes(id)),
  ];
}

function axAnswerView(
  diagnosticKey: string,
  answers: Record<string, unknown>
): SubmissionAnswerView[] {
  const definition = diagnosticKey === AX_MIGRATION_DIAGNOSTIC_KEY ? axMigrationDefinition : null;
  const questions = definition?.questions ?? [];
  return orderedIds(
    questions.map((q) => q.id),
    answers
  ).map((id) => {
    const question = questions.find((q) => q.id === id);
    const raw = answers[id];
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (value): value is string => typeof value === 'string'
    );
    return {
      questionId: id,
      question: question?.label ?? rawText(id),
      detail: question?.detail === true,
      values: values.map((value) => ({
        value,
        label: question?.options.find((o) => o.value === value)?.label ?? rawText(value),
      })),
    };
  });
}

/**
 * Answers of a builder diagnosis labelled with the definition of the version answered (the
 * labels are plain text in the definition, the same in every locale). Numbers keep their unit.
 */
export function builderAnswerView(
  answers: Record<string, unknown>,
  definition: DiagnosisDefinition | null
): SubmissionAnswerView[] {
  const questions = definition?.questions ?? [];
  return orderedIds(
    questions.map((q) => q.id),
    answers
  ).map((id) => {
    const question = questions.find((q) => q.id === id);
    const raw = answers[id];
    const values = (Array.isArray(raw) ? raw : [raw]).flatMap((value) =>
      typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
        ? [String(value)]
        : []
    );
    const label = (value: string): string => {
      if (!question) return value;
      switch (question.type) {
        case 'single':
        case 'multiple':
          return question.options.find((o) => o.value === value)?.label ?? value;
        case 'number_range':
          return `${value}${question.unit ?? ''}`;
        case 'scale':
          return `${value}（${question.min}〜${question.max}）`;
        case 'text':
          return value;
      }
    };
    return {
      questionId: id,
      question: rawText(question?.label ?? id),
      detail: false,
      values: values.map((value) => ({ value, label: rawText(label(value)) })),
    };
  });
}
