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
 * Resend refused the request. `code` is Resend's error name (e.g. 'invalid_idempotent_request':
 * the idempotency key was already used with another payload, so the first request went through;
 * #154). The message is Resend's and never carries the recipient.
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
  const result = options.idempotencyKey
    ? await client.emails.send(payload, { idempotencyKey: options.idempotencyKey })
    : await client.emails.send(payload);

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
