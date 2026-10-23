/**
 * Email Service
 *
 * Handles email sending via Resend
 */
import {
  EmailRecipientNotAllowedError,
  filterAllowedRecipients,
} from '@/lib/email/allowed-recipients';
import { safeUrl, sanitizeSubject } from '@/lib/email/templates/render';
import { Resend } from 'resend';

/**
 * Resend refused the request, or did not answer in time. `code` is Resend's error name, or
 * 'timeout'. The message is Resend's (or ours) and never carries the recipient.
 *
 * The two 409 errors of an idempotency key (#154), as Resend documents them
 * (https://resend.com/docs/dashboard/emails/idempotency-keys and
 * https://resend.com/docs/api-reference/errors; both names are in RESEND_ERROR_CODE_KEY of the
 * resend package's types):
 * - `invalid_idempotent_request`: "this idempotency key has already been used on a request that
 *   had a different payload" within the last 24 hours; "retrying this request is useless without
 *   changing the idempotency key or payload". An earlier request with this key reached Resend,
 *   so the mail is taken as delivered: `isIdempotentReplay`
 * - `concurrent_idempotent_requests`: "another request with the same idempotency key is in
 *   progress"; "it is safe to retry this request later". Nothing is known yet about the earlier
 *   request, so this is an ordinary, retryable failure and never taken as sent
 */
export class EmailProviderError extends Error {
  readonly code: string;
  readonly statusCode: number | null;

  constructor(code: string, statusCode: number | null, message: string) {
    super(`Failed to send email: ${message}`);
    this.name = 'EmailProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }

  /** An earlier request with the same idempotency key went through (see above) */
  get isIdempotentReplay(): boolean {
    return this.code === 'invalid_idempotent_request';
  }
}

/**
 * How long sendEmail waits for Resend (#154). A request holding a lock and database connections
 * must not wait for the whole maxDuration (30 s). A timeout is a failure; if the timed-out
 * request did go through, the idempotency key keeps a retry from delivering twice.
 */
export const EMAIL_SEND_TIMEOUT_MS = 10_000;

/**
 * Resend's SDK (6.x) takes no AbortSignal for emails.send, so the wait is cut with a race: the
 * request may still finish in the background, but nothing waits for it any more
 */
async function withTimeout<T>(request: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new EmailProviderError('timeout', null, `no answer from Resend in ${ms} ms`)),
      ms
    );
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Initialize Resend client (lazy to handle missing API key)
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/**
 * Send email options
 */
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  /**
   * One-click unsubscribe (RFC 8058, #154): the https URL that stops this recipient's mail.
   * sendEmail adds both List-Unsubscribe and List-Unsubscribe-Post. The URL carries a
   * per-recipient token, so the mail must have exactly one recipient.
   */
  listUnsubscribe?: { url: string };
  /**
   * Resend's Idempotency-Key: a retry with the same key within 24 hours does not send the mail
   * again (#154). Use a key derived from what is being sent, never the address.
   */
  idempotencyKey?: string;
}

/** The unsubscribe headers for one recipient, or an error before anything is sent */
function unsubscribeHeaders(
  listUnsubscribe: { url: string },
  recipients: string[]
): Record<string, string> {
  if (recipients.length !== 1) {
    throw new Error('A mail with an unsubscribe link must have exactly one recipient');
  }
  const url = safeUrl(listUnsubscribe.url);
  // safeUrl returns a normalised https URL: ASCII only, no line breaks or angle brackets
  if (!url) throw new Error('The unsubscribe link is not https');
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Send an email
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ id: string }> {
  const to = filterAllowedRecipients(options.to);
  if (to.length === 0) throw new EmailRecipientNotAllowedError();
  const headers = options.listUnsubscribe
    ? unsubscribeHeaders(options.listUnsubscribe, to)
    : undefined;
  const client = getResendClient();
  const from = options.from || process.env.EMAIL_FROM || 'DiagnoLeads <noreply@diagnoleads.com>';

  const payload = {
    from,
    to,
    // Header values must stay on one line, whatever a caller put in the subject
    subject: sanitizeSubject(options.subject),
    html: options.html,
    text: options.text,
    replyTo: options.replyTo,
    ...(headers ? { headers } : {}),
  };
  const request = options.idempotencyKey
    ? client.emails.send(payload, { idempotencyKey: options.idempotencyKey })
    : client.emails.send(payload);
  const result = await withTimeout(request, EMAIL_SEND_TIMEOUT_MS);

  if (result.error) {
    throw new EmailProviderError(
      result.error.name,
      result.error.statusCode ?? null,
      result.error.message
    );
  }

  return { id: result.data?.id || '' };
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
