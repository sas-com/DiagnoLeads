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
import type { SendEmailOptions } from '@/lib/features/email/email-service';
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
  /** The https URL of the unsubscribe page (and one-click POST) for this mail's token */
  unsubscribeUrlFor: (token: string) => string;
  /** Builds the mail with the unsubscribe URL in its footer */
  build: (unsubscribeUrl: string) => RespondentEmailContent;
  /** Passed to Resend so a retry of the same send does not deliver twice */
  idempotencyKey?: string;
}

export type SendRespondentEmailResult =
  | { outcome: 'sent'; sendId: string; messageId: string }
  | { outcome: 'suppressed'; sendId: string }
  | { outcome: 'failed'; sendId: string | null; errorCode: RespondentEmailErrorCode };

export type RespondentEmailErrorCode =
  | 'invalid_address'
  | 'build_failed'
  | 'recipient_not_allowed'
  | 'send_failed';

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
    // The same URL serves the footer link (a page with a button) and the one-click POST
    // (RFC 8058): the route tells them apart by method
    const unsubscribeUrl = input.unsubscribeUrlFor(unsubscribe.token);
    const content = input.build(unsubscribeUrl);
    errorCode = 'send_failed';
    const result = await deps.sendEmail({
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      replyTo: content.replyTo,
      listUnsubscribe: { url: unsubscribeUrl },
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    messageId = result.id;
  } catch (error) {
    if (error instanceof EmailRecipientNotAllowedError) errorCode = 'recipient_not_allowed';
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
