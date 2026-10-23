/**
 * Send one mail to a respondent (#154), generic over what the mail is for.
 *
 * Every mail gets a row in respondent_email_sends and its own unsubscribe token (only the hash
 * is stored). The suppression list is checked right before sending. Consent, its version and
 * expiry, rate limits and quotas are the caller's (the AX result mail counts with
 * consumeRateLimits before calling this).
 *
 * Nothing about the address or the token is logged: only the send id and a short error code.
 */
import type { Database } from '@/lib/db/client';
import { respondentEmailSends } from '@/lib/db/schema';
import { EmailRecipientNotAllowedError } from '@/lib/email/allowed-recipients';
import { EmailProviderError, type SendEmailOptions } from '@/lib/features/email/email-service';
import { eq } from 'drizzle-orm';
import { normaliseEmail } from './normalize';
import { isSuppressed } from './suppression';
import { newToken } from './tokens';

export type RespondentEmailKind = 'confirmation' | 'result';

/** What the caller's builder returns (the shape of the AX BuiltEmail) */
export interface RespondentEmailContent {
  subject: string;
  html: string;
  text: string;
  replyTo: string;
}

export interface RespondentEmailDeps {
  /** sendEmail of lib/features/email (test mode filtering and the unsubscribe headers) */
  sendEmail: (options: SendEmailOptions) => Promise<{ id: string }>;
}

export interface SendRespondentEmailInput {
  organizationId: string;
  email: string;
  kind: RespondentEmailKind;
  consentId?: string | null;
  leadId?: string | null;
  submissionId?: string | null;
  /**
   * The https URL of the unsubscribe page for this mail's token, linked from the footer (see
   * unsubscribeUrls: the token is in the fragment)
   */
  unsubscribePageUrlFor: (token: string) => string;
  /** The https URL of the one-click POST (RFC 8058) for the List-Unsubscribe header */
  oneClickUrlFor: (token: string) => string;
  /** Builds the mail with the unsubscribe page URL in its footer */
  build: (unsubscribePageUrl: string) => RespondentEmailContent;
  /** Passed to Resend so a retry of the same send does not deliver twice */
  idempotencyKey?: string;
}

export type SendRespondentEmailResult =
  | { outcome: 'sent'; sendId: string; messageId: string }
  /**
   * Resend refused a retry because the idempotency key was already used for another payload
   * (each attempt carries its own unsubscribe token): the earlier attempt went out. This
   * attempt's row is recorded as 'failed' with the error code 'idempotent_replay' (see
   * IDEMPOTENT_REPLAY); the earlier row keeps the token of the delivered mail, so its
   * unsubscribe link still works
   */
  | { outcome: 'already_sent'; sendId: string }
  | { outcome: 'suppressed'; sendId: string }
  | { outcome: 'failed'; sendId: string | null; errorCode: RespondentEmailErrorCode };

export type RespondentEmailErrorCode =
  | 'invalid_address'
  | 'build_failed'
  | 'recipient_not_allowed'
  | 'send_timeout'
  | 'send_failed';

/**
 * The error code of a send row whose attempt Resend refused as an idempotent replay: the row is
 * 'failed' (nothing was delivered by it) but an earlier attempt with the same key went out, so
 * a check for "a mail already went out" must count it like 'sent' and 'pending'
 */
export const IDEMPOTENT_REPLAY = 'idempotent_replay';
/**
 * Error code of an attempt that hit the send time limit: Resend may still have delivered it.
 * Callers whose retries would carry a different idempotency key (a new confirmation token)
 * must count it as possibly sent, or the respondent gets two mails and the first link breaks
 */
export const SEND_TIMEOUT = 'send_timeout';

/** The database or a transaction of it */
export type RespondentEmailDatabase = Pick<Database, 'select' | 'insert' | 'update'>;

export async function sendRespondentEmail(
  db: RespondentEmailDatabase,
  deps: RespondentEmailDeps,
  input: SendRespondentEmailInput
): Promise<SendRespondentEmailResult> {
  const email = normaliseEmail(input.email);
  if (!email) return { outcome: 'failed', sendId: null, errorCode: 'invalid_address' };

  const base = {
    organizationId: input.organizationId,
    consentId: input.consentId ?? null,
    leadId: input.leadId ?? null,
    submissionId: input.submissionId ?? null,
    kind: input.kind,
    email,
  };

  if (await isSuppressed(db, input.organizationId, email)) {
    const [row] = await db
      .insert(respondentEmailSends)
      .values({ ...base, status: 'suppressed' })
      .returning({ id: respondentEmailSends.id });
    return { outcome: 'suppressed', sendId: row.id };
  }

  const unsubscribe = newToken();
  const [row] = await db
    .insert(respondentEmailSends)
    .values({ ...base, status: 'pending', unsubscribeTokenHash: unsubscribe.hash })
    .returning({ id: respondentEmailSends.id });
  const sendId = row.id;

  let errorCode: RespondentEmailErrorCode = 'build_failed';
  let messageId: string;
  try {
    // The footer links to a page with a button (opening it changes nothing, so mail scanners
    // cannot unsubscribe anyone); the header points mail providers to the one-click POST
    const pageUrl = input.unsubscribePageUrlFor(unsubscribe.token);
    const oneClickUrl = input.oneClickUrlFor(unsubscribe.token);
    const content = input.build(pageUrl);
    errorCode = 'send_failed';
    const result = await deps.sendEmail({
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      replyTo: content.replyTo,
      listUnsubscribe: { url: oneClickUrl },
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    messageId = result.id;
  } catch (error) {
    if (input.idempotencyKey && error instanceof EmailProviderError && error.isIdempotentReplay) {
      // This attempt delivered nothing (its unsubscribe token never left the server), so its row
      // is 'failed'; the error code tells callers that an earlier attempt went out
      await db
        .update(respondentEmailSends)
        .set({ status: 'failed', errorCode: IDEMPOTENT_REPLAY })
        .where(eq(respondentEmailSends.id, sendId));
      return { outcome: 'already_sent', sendId };
    }
    if (error instanceof EmailRecipientNotAllowedError) errorCode = 'recipient_not_allowed';
    if (error instanceof EmailProviderError && error.code === 'timeout') errorCode = SEND_TIMEOUT;
    console.error('[respondent-email] send failed', { sendId, errorCode });
    await db
      .update(respondentEmailSends)
      .set({ status: 'failed', errorCode })
      .where(eq(respondentEmailSends.id, sendId));
    return { outcome: 'failed', sendId, errorCode };
  }

  // Outside the try: a mail that went out is never recorded as failed. If this update fails the
  // row stays 'pending' and the error reaches the caller (a retry with the same idempotency key
  // does not deliver twice).
  await db
    .update(respondentEmailSends)
    .set({ status: 'sent', resendMessageId: messageId || null, sentAt: new Date() })
    .where(eq(respondentEmailSends.id, sendId));
  return { outcome: 'sent', sendId, messageId };
}
