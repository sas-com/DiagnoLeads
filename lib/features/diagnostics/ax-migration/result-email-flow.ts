/**
 * The AX result by email (#154): the request from the result screen and the confirmation of the
 * double opt-in.
 *
 * - The recipient is the address of the lead the submission belongs to, read here. The request
 *   carries only the submission id (known to the browser that sent the diagnosis), so this is no
 *   way to mail an address of one's choosing (the reason #67 had rejected sending the result)
 * - The first mail is the fixed-text confirmation; the result goes out only after its button
 *   (on the confirm page, by POST) is pressed. One confirmation per address and 24 hours
 * - Whether a mail went out, the address was suppressed, a confirmation was sent in the last
 *   24 hours, test mode refused the address or this submission had already asked, the API
 *   answers the same 'accepted' (the outcome below tells them apart for tests and logs only)
 * - A confirmation that could not be sent keeps its consent: pressing the button again sends a
 *   new confirmation (with a new link) for the same consent
 *
 * Neither the address nor a token is logged.
 */
import type { Database } from '@/lib/db/client';
import {
  diagnosticSubmissions,
  leads,
  respondentEmailConsents,
  respondentEmailSends,
} from '@/lib/db/schema';
import { isAllowedEmail as defaultIsAllowedEmail } from '@/lib/email/allowed-recipients';
import { axConsultationUrl } from '@/lib/features/ax-site/contact';
import type { AxMailLocale } from '@/lib/features/ax-site/sender-identity';
import {
  IDEMPOTENT_REPLAY,
  type RespondentEmailDeps,
  SEND_TIMEOUT,
  hashToken,
  newToken,
  normaliseEmail,
  sendRespondentEmail,
  suppress,
  unsubscribeUrls,
} from '@/lib/features/respondent-email';
import { and, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { consumeRateLimits } from '../rate-limit';
import { AX_MIGRATION_DIAGNOSTIC_KEY } from './definition';
import { type AxMigrationResult, toPublicResult } from './evaluate';
import { AX_RATE_LIMITS } from './limits';
import { buildAxResultConfirmationEmail, buildAxResultEmail } from './result-email';
import {
  AX_RESULT_EMAIL_CONFIRM_TTL_HOURS,
  AX_RESULT_EMAIL_CONSENT_VERSION,
} from './result-email-config';
import { RESULT_SCREEN_WINDOW_MS } from './submission-service';

const HOUR = 60 * 60 * 1000;
const PURPOSE = 'ax_result_copy';
/** One confirmation mail per address (and organization) in this rolling window */
export const CONFIRMATION_INTERVAL_MS = 24 * HOUR;
/** Confirm tokens are 32 random bytes in base64url (43 characters) */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export interface AxResultEmailDeps {
  sendEmail: RespondentEmailDeps['sendEmail'];
  /** The app's base URL for the links; NEXT_PUBLIC_APP_URL by default */
  baseUrl?: string;
  /** The booking page of the consultation button; axConsultationUrl() by default, none hides it */
  consultationUrl?: string | null;
  /** Test mode (lib/email/allowed-recipients) by default */
  isAllowedEmail?: (email: string) => boolean;
}

function baseUrlOf(deps: AxResultEmailDeps): string {
  return (deps.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
}

/**
 * A send that went out or may have: 'sent', 'pending' (the outcome was never recorded), or an
 * attempt Resend refused as the replay of one that went out (see IDEMPOTENT_REPLAY)
 */
const wentOut = () =>
  or(
    inArray(respondentEmailSends.status, ['sent', 'pending']),
    eq(respondentEmailSends.errorCode, IDEMPOTENT_REPLAY)
  );

/**
 * For confirmations only: also an attempt that hit the time limit. A retry issues a new token,
 * so its idempotency key differs and Resend would not stop a second mail; a timed-out
 * confirmation therefore counts as sent for the 24-hour rule. Result mail keeps one key per
 * consent across attempts, so a timeout there stays retryable (wentOut)
 */
const confirmationWentOut = () => or(wentOut(), eq(respondentEmailSends.errorCode, SEND_TIMEOUT));

const BUSY = Symbol('busy');

/**
 * Lock-holding operations running at once in this server instance. Each holds one connection
 * for its lock and needs another for its work, so without a cap a burst could take every
 * connection of this instance's pool (10, lib/db/client) for locks and wait forever for the
 * work. The cap protects that pool only, not the connections of Supabase as a whole (other
 * instances have their own pools). Past the cap the request answers 'unavailable' and the
 * confirm page 'busy' (both ask to try again).
 */
const MAX_IN_FLIGHT = 4;
let inFlight = 0;

/**
 * Run `work` while holding a transaction-scoped advisory lock on `key`. The transaction only
 * holds the lock: `work` writes through `db` itself, so its rows are kept whatever happens later
 * (a mail that went out keeps the row with its unsubscribe token, as sendRespondentEmail
 * intends). 'try' gives up at once when another request holds the lock; 'wait' waits up to 10
 * seconds.
 */
async function holdingLock<T>(
  db: Database,
  key: string,
  mode: 'wait' | 'try',
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>
): Promise<T | typeof BUSY> {
  if (inFlight >= MAX_IN_FLIGHT) return BUSY;
  inFlight += 1;
  try {
    return await db.transaction(async (tx) => {
      if (mode === 'wait') {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      } else {
        const rows = await tx.execute<{ locked: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as locked`
        );
        if (!rows[0]?.locked) return BUSY;
      }
      return work(tx);
    });
  } finally {
    inFlight -= 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Request (the button of the result screen)
// ---------------------------------------------------------------------------------------------

/**
 * What the request did. The API answers 'accepted' for 'accepted' and 'already_requested' alike
 * (the browser must not tell them apart); the delivery and 'already_requested' say what actually
 * happened, for tests and logs, never the response.
 */
export type RequestAxResultEmailResult =
  | {
      outcome: 'accepted';
      delivery: 'sent' | 'suppressed' | 'recent_confirmation' | 'not_allowed';
    }
  /**
   * This submission already asked, and its confirmation went out (or may have), was suppressed
   * or refused by test mode, or the request was confirmed or withdrawn: nothing more is sent
   */
  | { outcome: 'already_requested' }
  | { outcome: 'closed' }
  | { outcome: 'not_found' }
  /** The organization's quota of respondent mail is used up, or the mail could not be sent */
  | { outcome: 'unavailable' };

export async function requestAxResultEmail(
  db: Database,
  deps: AxResultEmailDeps,
  input: { submissionId: string; locale: AxMailLocale; now?: Date }
): Promise<RequestAxResultEmailResult> {
  const now = input.now ?? new Date();
  const locale: AxMailLocale = input.locale === 'en' ? 'en' : 'ja';

  const [submission] = await db
    .select({
      id: diagnosticSubmissions.id,
      organizationId: diagnosticSubmissions.organizationId,
      leadId: diagnosticSubmissions.leadId,
      createdAt: diagnosticSubmissions.createdAt,
      leadEmail: leads.email,
    })
    .from(diagnosticSubmissions)
    .leftJoin(leads, eq(leads.id, diagnosticSubmissions.leadId))
    .where(
      and(
        eq(diagnosticSubmissions.id, input.submissionId),
        eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY)
      )
    )
    .limit(1);
  if (!submission) return { outcome: 'not_found' };
  // Only while the result screen can still be open, like the other actions of the result
  if (now.getTime() - submission.createdAt.getTime() > RESULT_SCREEN_WINDOW_MS) {
    return { outcome: 'closed' };
  }
  // The lead was deleted: there is no address to send to
  if (!submission.leadId || !submission.leadEmail) return { outcome: 'not_found' };

  const email = normaliseEmail(submission.leadEmail);
  const isAllowed = deps.isAllowedEmail ?? ((address: string) => defaultIsAllowedEmail(address));
  // Test mode, or an address no mail can go to: nothing is recorded or sent, and the answer is
  // the same as for a mail that went out
  if (!email || !isAllowed(email)) return { outcome: 'accepted', delivery: 'not_allowed' };

  const organizationId = submission.organizationId;
  const leadId = submission.leadId;
  const result = await holdingLock(
    db,
    `respondent-email:${organizationId}:${email}`,
    'wait',
    async (): Promise<RequestAxResultEmailResult> => {
      const [existing] = await db
        .select({
          id: respondentEmailConsents.id,
          confirmedAt: respondentEmailConsents.confirmedAt,
          withdrawnAt: respondentEmailConsents.withdrawnAt,
        })
        .from(respondentEmailConsents)
        .where(
          and(
            eq(respondentEmailConsents.submissionId, submission.id),
            eq(respondentEmailConsents.purpose, PURPOSE)
          )
        )
        .limit(1);
      if (existing) {
        if (existing.confirmedAt || existing.withdrawnAt) return { outcome: 'already_requested' };
        // Its confirmation went out (or may have), was suppressed or was refused by test mode.
        // Only a consent whose every confirmation failed to send gets another one
        const [handled] = await db
          .select({ id: respondentEmailSends.id })
          .from(respondentEmailSends)
          .where(
            and(
              eq(respondentEmailSends.consentId, existing.id),
              eq(respondentEmailSends.kind, 'confirmation'),
              or(
                confirmationWentOut(),
                eq(respondentEmailSends.status, 'suppressed'),
                eq(respondentEmailSends.errorCode, 'recipient_not_allowed')
              )
            )
          )
          .limit(1);
        if (handled) return { outcome: 'already_requested' };
      }

      // One confirmation per address in 24 hours, whichever submission asked for it
      const [recent] = await db
        .select({ id: respondentEmailSends.id })
        .from(respondentEmailSends)
        .where(
          and(
            eq(respondentEmailSends.organizationId, organizationId),
            eq(respondentEmailSends.email, email),
            eq(respondentEmailSends.kind, 'confirmation'),
            confirmationWentOut(),
            gte(respondentEmailSends.createdAt, new Date(now.getTime() - CONFIRMATION_INTERVAL_MS))
          )
        )
        .limit(1);
      if (recent) return { outcome: 'accepted', delivery: 'recent_confirmation' };

      // Counted before every attempt, suppressed addresses included (sendRespondentEmail writes
      // a row for those too). The quota is the organization's, so refusing tells nothing about
      // this address
      const quota = await consumeRateLimits(
        db,
        [
          { rule: AX_RATE_LIMITS.respondentEmailPerOrganizationHourly, identifier: organizationId },
          { rule: AX_RATE_LIMITS.respondentEmailPerOrganization, identifier: organizationId },
        ],
        now
      );
      if (!quota.allowed) return { outcome: 'unavailable' };

      // A new link every time: only its hash is stored, so the link of a confirmation that was
      // not sent cannot be sent again (and it never left the server)
      const confirm = newToken();
      const request = {
        consentVersion: AX_RESULT_EMAIL_CONSENT_VERSION,
        consentedAt: now,
        locale,
        confirmTokenHash: confirm.hash,
        confirmExpiresAt: new Date(now.getTime() + AX_RESULT_EMAIL_CONFIRM_TTL_HOURS * HOUR),
      };
      const [consent] = existing
        ? await db
            .update(respondentEmailConsents)
            .set(request)
            .where(eq(respondentEmailConsents.id, existing.id))
            .returning({ id: respondentEmailConsents.id })
        : await db
            .insert(respondentEmailConsents)
            .values({
              organizationId,
              leadId,
              submissionId: submission.id,
              email,
              purpose: PURPOSE,
              ...request,
            })
            .returning({ id: respondentEmailConsents.id });

      const base = baseUrlOf(deps);
      // The token is in the fragment: browsers never send it, so it reaches no server log
      const confirmUrl = `${base}/${locale}/ax-diagnosis/email/confirm#t=${encodeURIComponent(confirm.token)}`;
      const sent = await sendRespondentEmail(
        db,
        { sendEmail: deps.sendEmail },
        {
          organizationId,
          email,
          kind: 'confirmation',
          consentId: consent.id,
          leadId,
          submissionId: submission.id,
          ...unsubscribeUrls({ locale, baseUrl: base }),
          build: (unsubscribeUrl) =>
            buildAxResultConfirmationEmail({ locale, confirmUrl, unsubscribeUrl }),
          // Per link, not per consent: a retry after a failed send carries a new link (and a new
          // unsubscribe token), so with the consent's key alone Resend would answer
          // invalid_idempotent_request whenever it had recorded the failed attempt, and a mail
          // that never went out would be taken as sent. The prefix of the link's hash is fixed
          // for this attempt and tells nothing about the link (SHA-256 of 256 random bits)
          idempotencyKey: `ax-confirm:${consent.id}:${confirm.hash.slice(0, 16)}`,
        }
      );

      if (sent.outcome === 'sent' || sent.outcome === 'already_sent') {
        return { outcome: 'accepted', delivery: 'sent' };
      }
      if (sent.outcome === 'suppressed') return { outcome: 'accepted', delivery: 'suppressed' };
      if (sent.errorCode === 'recipient_not_allowed') {
        return { outcome: 'accepted', delivery: 'not_allowed' };
      }
      // Not sent (Resend failed, timed out or the build failed): the consent and the failed send
      // row stay as the record of the request; pressing the button again sends a new link
      return { outcome: 'unavailable' };
    }
  );
  // Too many at once in this instance
  return result === BUSY ? { outcome: 'unavailable' } : result;
}

// ---------------------------------------------------------------------------------------------
// Confirm page
// ---------------------------------------------------------------------------------------------

export type ConfirmAxResultEmailOutcome =
  | 'sent'
  /** A result mail for this request went out (or may have: an earlier attempt is pending) */
  | 'already_sent'
  /** Unknown, used, withdrawn or expired token, or the diagnosis or lead is gone */
  | 'expired_or_invalid'
  /**
   * Another press of the same link is being handled, or this server instance already runs as
   * many lock-holding operations as it allows (MAX_IN_FLIGHT); either way, try again shortly
   */
  | 'busy'
  /** The address was unsubscribed after the confirmation mail: nothing is sent */
  | 'unsubscribed'
  /** The mail could not be sent; the link stays valid for another try */
  | 'failed';

/**
 * The "receive the result" button of the confirm page. Presses of the same link are handled one
 * at a time (the second answers 'busy'), and a request yields at most one result mail: a result
 * send already recorded (sent, pending, or an idempotent replay) answers 'already_sent', and
 * Resend's idempotency key (`ax-result:<consent>`, the same for every attempt) stops a retry
 * after an unrecorded success or a timeout.
 */
export async function confirmAxResultEmail(
  db: Database,
  deps: AxResultEmailDeps,
  input: { token: string; now?: Date }
): Promise<ConfirmAxResultEmailOutcome> {
  if (typeof input.token !== 'string' || !TOKEN.test(input.token)) return 'expired_or_invalid';
  const now = input.now ?? new Date();
  const hash = hashToken(input.token);

  const outcome = await holdingLock(
    db,
    `ax-result-confirm:${hash}`,
    'try',
    async (): Promise<ConfirmAxResultEmailOutcome> => {
      const [consent] = await db
        .update(respondentEmailConsents)
        .set({
          confirmedAt: sql`coalesce(${respondentEmailConsents.confirmedAt}, ${now.toISOString()}::timestamptz)`,
        })
        .where(
          and(
            eq(respondentEmailConsents.confirmTokenHash, hash),
            eq(respondentEmailConsents.purpose, PURPOSE),
            gt(respondentEmailConsents.confirmExpiresAt, now),
            isNull(respondentEmailConsents.withdrawnAt)
          )
        )
        .returning({
          id: respondentEmailConsents.id,
          organizationId: respondentEmailConsents.organizationId,
          leadId: respondentEmailConsents.leadId,
          submissionId: respondentEmailConsents.submissionId,
          email: respondentEmailConsents.email,
          locale: respondentEmailConsents.locale,
        });
      if (!consent) return 'expired_or_invalid';

      /** The link is used up: a copy of it can no longer confirm */
      const consumeToken = () =>
        db
          .update(respondentEmailConsents)
          .set({ confirmTokenHash: null })
          .where(eq(respondentEmailConsents.id, consent.id));

      const [previous] = await db
        .select({ id: respondentEmailSends.id })
        .from(respondentEmailSends)
        .where(
          and(
            eq(respondentEmailSends.consentId, consent.id),
            eq(respondentEmailSends.kind, 'result'),
            wentOut()
          )
        )
        .limit(1);
      if (previous) {
        await consumeToken();
        return 'already_sent';
      }

      // A deleted lead (perhaps at the person's request) or diagnosis: nothing to send
      const submission =
        consent.leadId && consent.submissionId
          ? await db.query.diagnosticSubmissions.findFirst({
              columns: { result: true, createdAt: true },
              where: eq(diagnosticSubmissions.id, consent.submissionId),
            })
          : undefined;
      if (!submission) {
        await consumeToken();
        return 'expired_or_invalid';
      }

      // Rebuilt from the stored diagnosis (the follow-up answers may have refined it), never
      // from anything the browser sends
      const result = toPublicResult(submission.result as unknown as AxMigrationResult);
      const locale: AxMailLocale = consent.locale === 'en' ? 'en' : 'ja';
      const base = baseUrlOf(deps);
      const consultationUrl =
        deps.consultationUrl === undefined ? (axConsultationUrl() ?? null) : deps.consultationUrl;

      const sent = await sendRespondentEmail(
        db,
        { sendEmail: deps.sendEmail },
        {
          organizationId: consent.organizationId,
          email: consent.email,
          kind: 'result',
          consentId: consent.id,
          leadId: consent.leadId,
          submissionId: consent.submissionId,
          ...unsubscribeUrls({ locale, baseUrl: base }),
          build: (unsubscribeUrl) =>
            buildAxResultEmail({
              locale,
              result,
              links: { consultationUrl, rediagnoseUrl: `${base}/${locale}/ax-diagnosis` },
              unsubscribeUrl,
              diagnosedAt: submission.createdAt,
            }),
          idempotencyKey: `ax-result:${consent.id}`,
        }
      );

      switch (sent.outcome) {
        case 'sent':
          await consumeToken();
          return 'sent';
        case 'already_sent':
          await consumeToken();
          return 'already_sent';
        case 'suppressed':
          await consumeToken();
          return 'unsubscribed';
        default:
          return 'failed';
      }
    }
  );
  return outcome === BUSY ? 'busy' : outcome;
}

export type DeclineAxResultEmailOutcome = 'declined' | 'expired_or_invalid' | 'busy';

/**
 * "I did not ask for this / do not send me mail" on the confirm page: the request is withdrawn,
 * its link stops working and the address goes on the organization's suppression list. Works
 * after the link has expired too (the person may only see the mail later).
 */
export async function declineAxResultEmail(
  db: Database,
  input: { token: string; now?: Date }
): Promise<DeclineAxResultEmailOutcome> {
  if (typeof input.token !== 'string' || !TOKEN.test(input.token)) return 'expired_or_invalid';
  const now = input.now ?? new Date();
  const hash = hashToken(input.token);

  const outcome = await holdingLock(
    db,
    `ax-result-confirm:${hash}`,
    'try',
    async (tx): Promise<DeclineAxResultEmailOutcome> => {
      // Both writes in the lock's transaction: no withdrawal without the suppression
      const [consent] = await tx
        .update(respondentEmailConsents)
        .set({
          withdrawnAt: sql`coalesce(${respondentEmailConsents.withdrawnAt}, ${now.toISOString()}::timestamptz)`,
          confirmTokenHash: null,
        })
        .where(
          and(
            eq(respondentEmailConsents.confirmTokenHash, hash),
            eq(respondentEmailConsents.purpose, PURPOSE)
          )
        )
        .returning({
          organizationId: respondentEmailConsents.organizationId,
          email: respondentEmailConsents.email,
        });
      if (!consent) return 'expired_or_invalid';

      await suppress(tx, {
        organizationId: consent.organizationId,
        email: consent.email,
        reason: 'not_requested',
        source: 'confirm_page',
      });
      return 'declined';
    }
  );
  return outcome === BUSY ? 'busy' : outcome;
}
