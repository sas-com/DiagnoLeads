/**
 * Rules shared by the public diagnoses: the AX diagnosis (ax-migration/) and the diagnoses made
 * in the builder (diagnosis-builder/) follow the same ones (decision
 * 2026-10-24-diagnosis-shared-rules, #481). Nothing here reads ax-migration/.
 *
 * - The inflow source of a new lead: an issued agency link (or an employee's own link) over the
 *   UTM parameters (#147, #265)
 * - A consultation request is taken for a day after the answer (#232), once per submission
 * - Who hears about a request: people of the submission's organization only, and the sales
 *   addresses (AX_DIAGNOSIS_SALES_EMAIL) only for the operator's organization
 * - Notification limits per organization: past the hourly one, consultation requests are still
 *   notified up to their own cap, and sales emails have hourly and daily caps (#232)
 * - A new lead from a scan of a QR campaign counts for the campaign of its organization, once
 *   (#700)
 */
import type { db as defaultDb } from '@/lib/db/client';
import { diagnosticSubmissions } from '@/lib/db/schema';
import { renderEmail } from '@/lib/email/templates/render';
import { env } from '@/lib/env';
import { findActiveAgencyLink } from '@/lib/features/agency-links/service';
import { MEMBER_REFERRAL_KIND } from '@/lib/features/agency-links/types/schemas';
import { countCampaignCompletion } from '@/lib/features/distribution/service';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import {
  type AssignmentExecutor,
  type ConsultationRecipients,
  consultationRecipients,
  splitAddresses,
} from '@/lib/features/leads/assignment';
import { notifyOrganizationMembers } from '@/lib/features/notifications/notification-service';
import { isDiagnosisOrganization } from '@/lib/multi-tenant/helpers/diagnosis-organization';
import { summarizeServerError } from '@/lib/ops/alert';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { resolveDiagnosisOrganizationId } from './organization';
import { type RateLimitRule, consumeRateLimit } from './rate-limit';
import { type InferredInflow, type Tracking, inferInflowSource } from './tracking';
import { CONSULTATION_WINDOW_MS } from './types/consultation';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------------------------
// Inflow source

export interface ResolvedInflow extends InferredInflow {
  /** The issued link the respondent came from (#147) */
  agencyLinkId: string | null;
  /** The employee whose own link it is (#265), to tell them about a new lead */
  referralMemberUserId: string | null;
}

/**
 * The inflow source of a lead created by a submission. An issued link of the organization
 * decides it over the UTM parameters (#147); an employee's own link (#265) names the employee as
 * the referrer, not as an agency, so agency contracts and appointment reviews do not pick the
 * lead up. A code that is unknown, disabled or of another organization attributes nothing.
 */
export async function resolveInflow(
  executor: Database | Transaction,
  organizationId: string,
  tracking: Tracking
): Promise<ResolvedInflow> {
  const link = await findActiveAgencyLink(executor, organizationId, tracking.agency);
  if (!link) {
    return { ...inferInflowSource(tracking), agencyLinkId: null, referralMemberUserId: null };
  }
  return link.kind === MEMBER_REFERRAL_KIND
    ? {
        inflowSource: link.kind,
        referrerName: link.agencyName,
        agencyName: null,
        agencyLinkId: link.id,
        referralMemberUserId: link.memberUserId,
      }
    : {
        inflowSource: link.kind,
        referrerName: null,
        agencyName: link.agencyName,
        agencyLinkId: link.id,
        referralMemberUserId: null,
      };
}

// ---------------------------------------------------------------------------------------------
// QR campaigns

/** What countQrCompletion reads of a submission, as it is stored */
export interface QrCompletionSubmission {
  organizationId: string;
  /** The submission created its lead (upsertLeadFromSubmission found none to link to) */
  leadCreated: boolean;
  /** A test answer of the builder's preview */
  isTest: boolean;
  tracking: Pick<Tracking, 'qr'>;
}

/**
 * The longest the count waits for the row of the campaign (held for a moment by a scan being
 * recorded or by an answer with the same code, and for as long as a deletion of the campaign
 * takes, #702). Past it the lead is kept without the count.
 */
export const QR_COMPLETION_LOCK_TIMEOUT = '3s';

/** A count that failed: the caller reports `error` after the response (the lead was kept) */
export interface QrCompletionFailure {
  error: unknown;
}

/** What countQrCompletion did. The submission goes on in every case */
export type QrCompletion =
  | { counted: boolean; failure: null }
  | { counted: false; failure: QrCompletionFailure };

const NOT_COUNTED: QrCompletion = { counted: false, failure: null };

/**
 * Count a new lead for the QR campaign whose code the answer carries (#700, owner decision of
 * 2026-10-25): the /q/ entry adds the campaign's short code to the address of the diagnosis, and
 * the answer keeps it in tracking like the UTM values (`qr`). Only a submission that created its
 * lead counts, never a test answer, and only for a campaign of the submission's organization
 * (countCampaignCompletion: another organization's code, or a code no campaign has, counts
 * nothing). Nothing is asked of the database for an answer without a code.
 *
 * Run it in the transaction that creates the lead, after the lead and the submission are
 * written: the count commits and rolls back with them, so an answer sent again (it finds the
 * lead) and a submission that failed and is sent once more count once in all. Exactly once per
 * lead, also for answers at the same moment.
 *
 * The lead comes first (2026-10-25 read-only review of PR #774): the count runs in a savepoint of
 * that transaction and waits at most QR_COMPLETION_LOCK_TIMEOUT for the campaign row. When it
 * fails (a policy or a grant of RLS, #51, the wait, ...) only the savepoint is rolled back
 * (ROLLBACK TO SAVEPOINT, which also undoes the lock timeout set in it), the submission and its
 * lead are saved, and the failure is logged by its name and code (never the message, which holds
 * the query and its values) and handed back for the caller to report. The lock timeout holds for
 * the count only: the previous value is set again as the savepoint's last statement.
 *
 * postgres-js (sql.savepoint, which drizzle's nested transaction uses) sends no RELEASE
 * SAVEPOINT: a savepoint that succeeds stays open and commits with the outer transaction, whose
 * last statement this is. A counted submission costs 4 more round trips (SAVEPOINT, setting the
 * lock timeout, the UPDATE, setting it back). A failed count costs 4 too, as it nearly always
 * fails in the UPDATE (a policy or a grant, the wait): ROLLBACK TO SAVEPOINT takes the place of
 * setting the timeout back; 5 only when setting it back is what fails. The campaign row is
 * locked from the UPDATE to the COMMIT (setting the timeout back, then the COMMIT: 2 round
 * trips).
 */
export async function countQrCompletion(
  tx: Transaction,
  submission: QrCompletionSubmission
): Promise<QrCompletion> {
  const shortCode = submission.tracking.qr;
  if (!submission.leadCreated || submission.isTest || !shortCode) return NOT_COUNTED;
  try {
    const counted = await tx.transaction(async (savepoint) => {
      // The value before, read before it is changed (the materialized CTE is evaluated first)
      const [timeout] = await savepoint.execute<{ previous: string }>(sql`
        with setting as materialized (select current_setting('lock_timeout') as previous)
        select previous, set_config('lock_timeout', ${QR_COMPLETION_LOCK_TIMEOUT}, true)
        from setting
      `);
      const done = await countCampaignCompletion(savepoint, {
        organizationId: submission.organizationId,
        shortCode,
      });
      await savepoint.execute(sql`select set_config('lock_timeout', ${timeout.previous}, true)`);
      return done;
    });
    return { counted, failure: null };
  } catch (error) {
    const { name, code } = summarizeServerError(error);
    console.error('QR completion not counted:', name, code ?? '');
    return { counted: false, failure: { error } };
  }
}

// ---------------------------------------------------------------------------------------------
// Consultation requests

/** What the caller needs of the submission a request is for */
export interface ConsultationSubmission {
  organizationId: string;
  leadId: string | null;
  leadCreated: boolean;
  continuedFromSubmissionId: string | null;
  diagnosisVersionId: string | null;
  result: Record<string, unknown>;
}

export type ConsultationClaim =
  /** This request recorded it (exactly one concurrent request does) */
  | { status: 'claimed'; submission: ConsultationSubmission }
  /** An earlier request did, at requestedAt */
  | { status: 'already_requested'; submission: ConsultationSubmission; requestedAt: Date }
  /** No request yet, and the day after the answer is over */
  | { status: 'closed' }
  | { status: 'not_found' };

const submissionColumns = {
  organizationId: diagnosticSubmissions.organizationId,
  leadId: diagnosticSubmissions.leadId,
  leadCreated: diagnosticSubmissions.leadCreated,
  continuedFromSubmissionId: diagnosticSubmissions.continuedFromSubmissionId,
  diagnosisVersionId: diagnosticSubmissions.diagnosisVersionId,
  result: diagnosticSubmissions.result,
};

/**
 * Record a consultation request on a submission of the diagnosis (diagnostic_key). A conditional
 * UPDATE, so exactly one concurrent request wins and sales are told once. Taken only while the
 * result screen can still be open (CONSULTATION_WINDOW_MS after the answer, #232); test answers
 * of the builder's preview never take one. Run it in the transaction that updates the lead.
 */
export async function claimConsultation(
  tx: Transaction,
  { submissionId, diagnosticKey, now }: { submissionId: string; diagnosticKey: string; now: Date }
): Promise<ConsultationClaim> {
  const ofDiagnosis = and(
    eq(diagnosticSubmissions.id, submissionId),
    eq(diagnosticSubmissions.diagnosticKey, diagnosticKey),
    eq(diagnosticSubmissions.isTest, false)
  );
  const [claimed] = await tx
    .update(diagnosticSubmissions)
    .set({ consultationRequestedAt: now })
    .where(
      and(
        ofDiagnosis,
        isNull(diagnosticSubmissions.consultationRequestedAt),
        gte(diagnosticSubmissions.createdAt, new Date(now.getTime() - CONSULTATION_WINDOW_MS))
      )
    )
    .returning(submissionColumns);
  if (claimed) return { status: 'claimed', submission: claimed };

  const [submission] = await tx
    .select({
      ...submissionColumns,
      consultationRequestedAt: diagnosticSubmissions.consultationRequestedAt,
    })
    .from(diagnosticSubmissions)
    .where(ofDiagnosis)
    .limit(1);
  if (!submission) return { status: 'not_found' };
  // Not claimed and not requested yet: the window has closed
  if (submission.consultationRequestedAt === null) return { status: 'closed' };
  const { consultationRequestedAt, ...rest } = submission;
  return { status: 'already_requested', submission: rest, requestedAt: consultationRequestedAt };
}

// ---------------------------------------------------------------------------------------------
// Who hears about it

/**
 * The sales addresses (AX_DIAGNOSIS_SALES_EMAIL) for a submission of this organization: set only
 * for the operator's organization, the one that receives the AX diagnosis. Another organization
 * never mails them: the company, name and email of its respondents must not reach the
 * operator's sales.
 */
function operatorSalesEmail(organizationId: string): string | undefined {
  // The same comparison as the QR entry and the agency links (#698)
  return isDiagnosisOrganization(organizationId, resolveDiagnosisOrganizationId())
    ? env.AX_DIAGNOSIS_SALES_EMAIL
    : undefined;
}

/**
 * Who hears about a consultation request: people of the submission's organization only. Its
 * intake members (窓口) in-app and by email when it has any (#135); otherwise every member in-app,
 * and by email the sales addresses of the operator's organization (operatorSalesEmail).
 */
export async function diagnosisConsultationRecipients(
  executor: AssignmentExecutor,
  organizationId: string
): Promise<ConsultationRecipients> {
  return consultationRecipients(executor, organizationId, operatorSalesEmail(organizationId));
}

// ---------------------------------------------------------------------------------------------
// Notification limits

/**
 * Sales emails per organization, per hour and per day, the same count for every diagnosis of
 * the organization. The sending quota is shared with the sign-in emails (password reset), so
 * requests must not be able to use it up; past a limit sales still get the in-app notification.
 * The hourly one keeps a burst from using up a day
 */
export const SALES_EMAIL_LIMITS = {
  hourly: { name: 'ax-sales-email-org-hour', limit: 10, windowMs: HOUR },
  daily: { name: 'ax-sales-email-org', limit: 30, windowMs: DAY },
} as const satisfies Record<string, RateLimitRule>;

/** The limits of a diagnosis, and how its notices name it */
export interface DiagnosisNotificationLimits {
  /** Shown in the notices: 【AX診断】, 【診断】 */
  label: string;
  /** Sales notifications per organization and hour */
  notifications: RateLimitRule;
  /**
   * Past the limit above, consultation requests are still notified (a flood must not hide a real
   * one, #232), up to this separate cap, since each new submission can carry a request
   */
  consultationNotifications: RateLimitRule;
  /** Kept with the in-app notice, to tell the diagnoses apart */
  data: Record<string, unknown>;
}

const CHECK_THE_LIST =
  'この間に届いた相談申込は、リード一覧（コンバージョンポイント：相談申込）で確認してください。';

function limitNotice(
  limits: DiagnosisNotificationLimits,
  rule: RateLimitRule
): { title: string; message: string } {
  const { label } = limits;
  switch (rule.name) {
    case limits.notifications.name:
      return {
        title: `【${label}】通知を一時停止しました`,
        message: `${label}の通知が1時間に${rule.limit}件を超えたため、この1時間の残りの送信は通知しません（リードとしては保存しています）。相談申込は引き続き通知します（Webhook は除く）。いたずらによる大量の送信の可能性があります。`,
      };
    case limits.consultationNotifications.name:
      return {
        title: `【${label}】相談申込の通知を一時停止しました`,
        message: `相談申込の通知が1時間に${rule.limit}件を超えたため、この1時間の残りの相談申込は通知しません（リードとしては保存しています）。${CHECK_THE_LIST}いたずらによる大量の送信の可能性があります。`,
      };
    case SALES_EMAIL_LIMITS.hourly.name:
      return {
        title: `【${label}】営業宛てメールを一時停止しました`,
        message: `相談申込のメールが1時間に${rule.limit}通を超えたため、この1時間の残りの相談申込はアプリ内通知だけでお知らせします。${CHECK_THE_LIST}`,
      };
    default:
      return {
        title: `【${label}】営業宛てメールを一時停止しました`,
        message: `相談申込のメールが1日${rule.limit}通を超えたため、今日のこれ以降の相談申込はアプリ内通知だけでお知らせします。${CHECK_THE_LIST}`,
      };
  }
}

/**
 * Tell the members (in-app) that a limit has stopped some notifications, and sales by one email
 * (outside the email caps: it is sent once per limit and window), only for the operator's
 * organization like the requests themselves (#481)
 */
async function noticeLimitReached(
  organizationId: string,
  limits: DiagnosisNotificationLimits,
  rule: RateLimitRule
): Promise<void> {
  const notice = limitNotice(limits, rule);
  const salesAddresses = splitAddresses(operatorSalesEmail(organizationId));
  const results = await Promise.allSettled([
    notifyOrganizationMembers(organizationId, 'system', notice.title, notice.message, {
      ...limits.data,
      limit: rule.name,
    }),
    ...(salesAddresses.length > 0 && isEmailConfigured()
      ? [
          sendEmail({
            to: salesAddresses,
            subject: notice.title,
            ...renderEmail({
              theme: 'internal',
              preheader: notice.message,
              blocks: [
                { type: 'badges', items: [{ label: '通知の上限', tone: 'warning' }] },
                { type: 'heading', text: notice.title },
                { type: 'paragraph', text: notice.message },
              ],
              footer: ['このメールは DiagnoLeads から自動で送信しています。'],
            }),
          }),
        ]
      : []),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`${limits.label}: limit notice failed:`, result.reason);
    }
  }
}

/** Count one against a limit of the organization; the first time it is over, say so */
async function withinOrganizationLimit(
  executor: AssignmentExecutor,
  organizationId: string,
  limits: DiagnosisNotificationLimits,
  rule: RateLimitRule
): Promise<boolean> {
  const quota = await consumeRateLimit(executor, rule, organizationId);
  if (quota.allowed) return true;
  console.warn(`${limits.label}: limit ${rule.name} reached`);
  if (quota.count === rule.limit + 1) await noticeLimitReached(organizationId, limits, rule);
  return false;
}

/** Hourly limit on notifications; when it cannot be checked, sales are notified as usual */
async function withinNotificationLimit(
  executor: AssignmentExecutor,
  organizationId: string,
  limits: DiagnosisNotificationLimits,
  rule: RateLimitRule
): Promise<boolean> {
  try {
    return await withinOrganizationLimit(executor, organizationId, limits, rule);
  } catch (error) {
    console.error(`${limits.label}: notification limit check failed:`, error);
    return true;
  }
}

export interface NotificationGate {
  /** Anything is sent at all */
  notify: boolean;
  /**
   * Within the hourly limit: webhooks and the notices of answers without a request go out. Past
   * it only a consultation request is notified (in-app and by email, not by webhook)
   */
  withinLimit: boolean;
}

/**
 * Count a submission or a request against the notification limits of the organization. Past the
 * hourly limit nothing is sent (the submission is saved all the same), except that a
 * consultation request still is, up to its own cap: a flood of submissions must not hide a real
 * request (#232).
 */
export async function checkNotificationLimits(
  executor: AssignmentExecutor,
  organizationId: string,
  consultationRequested: boolean,
  limits: DiagnosisNotificationLimits
): Promise<NotificationGate> {
  const withinLimit = await withinNotificationLimit(
    executor,
    organizationId,
    limits,
    limits.notifications
  );
  if (withinLimit) return { notify: true, withinLimit };
  const notify =
    consultationRequested &&
    (await withinNotificationLimit(
      executor,
      organizationId,
      limits,
      limits.consultationNotifications
    ));
  return { notify, withinLimit };
}

/**
 * Hourly and daily caps on sales emails (the daily one is not used up by emails the hourly one
 * refused); when they cannot be checked, no email (the sending quota is shared with the password
 * reset emails)
 */
export async function withinSalesEmailQuota(
  executor: AssignmentExecutor,
  organizationId: string,
  limits: DiagnosisNotificationLimits
): Promise<boolean> {
  try {
    return (
      (await withinOrganizationLimit(
        executor,
        organizationId,
        limits,
        SALES_EMAIL_LIMITS.hourly
      )) &&
      (await withinOrganizationLimit(executor, organizationId, limits, SALES_EMAIL_LIMITS.daily))
    );
  } catch (error) {
    console.error(`${limits.label}: sales email limit check failed:`, error);
    return false;
  }
}
